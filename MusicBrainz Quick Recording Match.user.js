// ==UserScript==
// @name        MusicBrainz Quick Recording Match
// @namespace   https://github.com/Aerozol/metabrainz-userscripts
// @description Select the first recording search result for each track, in the release editor Recordings tab.
// @version     5.16
// @downloadURL https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Recording%20Match.user.js
// @updateURL   https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Recording%20Match.user.js
// @license     MIT
// @author      Google Gemini
// @match       *://*.musicbrainz.org/release/*/edit*
// @match       *://*.beta.musicbrainz.org/release/add*
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    let isCancelled = false;
    let currentIndex = 0;
    let editButtons;
    let mainButtons;
    let currentTrackRow = null;
    let ignoredConfidenceLevel = 'none'; // Default to ignoring nothing
    let matchingMethod = 'suggested'; // Default to 'suggested'
    const confidenceColors = {
        'yellow': '#fff176',
        'orange': '#ffc778',
        'dark-orange': '#ffb74d',
        'red': '#d32f2f'
    };

    function parseLengthToMs(lengthText) {
        const match = lengthText.match(/(\d+):(\d+)/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            return (minutes * 60 + seconds) * 1000;
        }
        return null;
    }

    /**
     * Determines the confidence level of a track match.
     * @param {HTMLElement} trackRow The <tr> element of the track.
     * @returns {string|null} The confidence level as a string ('yellow', 'orange', 'dark-orange', 'red'), or null if no differences.
     */
    function getConfidenceLevel(trackRow) {
        const artistRow = trackRow.nextElementSibling;
        const nameCells = trackRow.querySelectorAll('td.name');
        const trackTitleCell = nameCells[0];
        const recordingTitleCell = nameCells[1];
        const trackLengthCell = trackRow.querySelector('td.length');
        const recordingLengthCell = trackRow.querySelector('td.length[data-bind*="recording().formattedLength"]');
        const trackArtistCell = artistRow?.querySelector('td[colspan="2"]:first-of-type > span');
        const recordingArtistCell = artistRow?.querySelector('td[colspan="2"]:last-of-type > span');

        const trackTitle = trackTitleCell?.querySelector('bdi')?.textContent.trim().toLowerCase();
        const recordingTitle = recordingTitleCell?.querySelector('bdi')?.textContent.trim().toLowerCase();
        const trackArtists = trackArtistCell?.textContent.trim().toLowerCase();
        const recordingArtists = recordingArtistCell?.textContent.trim().toLowerCase();

        if (!recordingTitle) return null;

        let lengthDiff = 0;
        if (trackLengthCell && recordingLengthCell) {
            const trackLengthMs = parseLengthToMs(trackLengthCell.textContent.trim());
            const recordingLengthMs = parseLengthToMs(recordingLengthCell.textContent.trim());
            if (trackLengthMs !== null && recordingLengthMs !== null) {
                lengthDiff = Math.abs(trackLengthMs - recordingLengthMs);
            }
        }

        const differences = [];
        if (recordingTitle && trackTitle && trackTitle !== recordingTitle) {
            differences.push('Title');
        }
        if (recordingArtists && trackArtists && trackArtists !== recordingArtists) {
            differences.push('Artist');
        }
        if (lengthDiff > 0) {
            differences.push(`Length (${Math.floor(lengthDiff / 1000)}s)`);
        }

        if (differences.length >= 3 && lengthDiff > 10000) {
            return 'red';
        } else if (lengthDiff > 15000) {
            return 'dark-orange';
        } else if (differences.length >= 2 && lengthDiff <= 15000) {
            return 'orange';
        } else if (differences.length === 1 || lengthDiff > 3000) {
            return 'yellow';
        }

        return null;
    }

    /**
     * Checks for differences and highlights the edit button for a single track row.
     * @param {HTMLElement} trackRow The <tr> element of the track to check.
     */
    function highlightSingleTrack(trackRow) {
        if (!trackRow) return;
        const editButton = trackRow.querySelector('.edit-track-recording');
        if (!editButton) return;

        editButton.style.backgroundColor = '';
        editButton.title = '';

        const isUnlinked = trackRow.querySelector('.edit-track-recording.negative') !== null;
        if (isUnlinked) {
            return;
        }

        const confidence = getConfidenceLevel(trackRow);
        if (confidence) {
            const differences = [];
            const artistRow = trackRow.nextElementSibling;
            const nameCells = trackRow.querySelectorAll('td.name');
            const trackTitleCell = nameCells[0];
            const recordingTitleCell = nameCells[1];
            const trackArtistCell = artistRow?.querySelector('td[colspan="2"]:first-of-type > span');
            const recordingArtistCell = artistRow?.querySelector('td[colspan="2"]:last-of-type > span');

            const trackTitle = trackTitleCell?.querySelector('bdi')?.textContent.trim().toLowerCase();
            const recordingTitle = recordingTitleCell?.querySelector('bdi')?.textContent.trim().toLowerCase();
            const trackArtists = trackArtistCell?.textContent.trim().toLowerCase();
            const recordingArtists = recordingArtistCell?.textContent.trim().toLowerCase();

            let lengthDiff = 0;
            const trackLengthCell = trackRow.querySelector('td.length');
            const recordingLengthCell = trackRow.querySelector('td.length[data-bind*="recording().formattedLength"]');
            if (trackLengthCell && recordingLengthCell) {
                 const trackLengthMs = parseLengthToMs(trackLengthCell.textContent.trim());
                 const recordingLengthMs = parseLengthToMs(recordingLengthCell.textContent.trim());
                 if (trackLengthMs !== null && recordingLengthMs !== null) {
                    lengthDiff = Math.abs(trackLengthMs - recordingLengthMs);
                }
            }

            if (recordingTitle && trackTitle && trackTitle !== recordingTitle) {
                differences.push('Title');
            }
            if (recordingArtists && trackArtists && trackArtists !== recordingArtists) {
                differences.push('Artist');
            }
            if (lengthDiff > 0) {
                differences.push(`Length (${Math.floor(lengthDiff / 1000)}s)`);
            }
            const tooltipText = differences.length > 0 ? differences.join(', ') + ' difference' : '';

            editButton.style.backgroundColor = confidenceColors[confidence];
            editButton.title = tooltipText;
        }
    }

    function highlightAllDifferences() {
        console.log("MusicBrainz Quick Tools: Starting difference highlighting for all tracks.");
        const trackRows = document.querySelectorAll('#track-recording-assignation tr.track');
        trackRows.forEach(highlightSingleTrack);
    }

    function createButton(text, onClickHandler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.className = 'musicbrainz-quick-tool-button';
        button.style.cssText = `
            font-size: 1em;
            padding: 4px 10px;
            cursor: pointer;
            background-color: #f8f8f8;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-right: 5px;
        `;
        button.onclick = onClickHandler;
        return button;
    }

    function createConfidenceDropdown() {
        const container = document.createElement('span');
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';

        const separator = document.createElement('span');
        separator.textContent = '|';
        separator.style.margin = '0 10px 0 5px';
        separator.style.color = '#ccc';
        container.appendChild(separator);

        const label = document.createElement('span');
        label.textContent = 'Ignore:';
        label.style.fontWeight = 'bold';
        label.style.marginRight = '5px';
        container.appendChild(label);

        const select = document.createElement('select');
        select.id = 'confidence-level-dropdown';
        select.style.cssText = `
            padding: 4px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1em;
        `;

        const options = {
            'none': 'Nothing',
            'yellow_and_above': 'Low confidence',
            'orange_and_above': 'Very low confidence',
            'red': 'Extremely low confidence',
        };

        for (const [value, text] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        }

        select.addEventListener('change', (event) => {
            ignoredConfidenceLevel = event.target.value;
            console.log(`Ignoring confidence level set to: ${ignoredConfidenceLevel}`);
        });

        container.appendChild(select);
        return container;
    }

    function createMethodDropdown() {
        const container = document.createElement('span');
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';

        const separator = document.createElement('span');
        separator.textContent = '|';
        separator.style.margin = '0 10px 0 5px';
        separator.style.color = '#ccc';
        container.appendChild(separator);

        const label = document.createElement('span');
        label.textContent = 'Method:';
        label.style.fontWeight = 'bold';
        label.style.marginRight = '5px';
        container.appendChild(label);

        const select = document.createElement('select');
        select.id = 'matching-method-dropdown';
        select.style.cssText = `
            padding: 4px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1em;
        `;

        const options = {
            'suggested': 'First suggested recording',
            'search': 'First search result',
        };

        for (const [value, text] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        }

        select.addEventListener('change', (event) => {
            matchingMethod = event.target.value;
            console.log(`Matching method set to: ${matchingMethod}`);
        });

        container.appendChild(select);
        return container;
    }

    function createButtonContainer() {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'quick-tools-fieldset';

        const legend = document.createElement('legend');
        legend.textContent = 'Quick tools';
        fieldset.appendChild(legend);

        const p1 = document.createElement('p');
        const autoLinkButton = createButton('Auto-link all tracks', startAutoLinking);
        const unlinkButton = createButton('Unlink all tracks', startUnlinking);
        p1.appendChild(autoLinkButton);
        p1.appendChild(unlinkButton);
        p1.appendChild(createConfidenceDropdown());
        p1.appendChild(createMethodDropdown());
        fieldset.appendChild(p1);

        return fieldset;
    }

    function addQuickToolsButtons() {
        const targetDiv = document.querySelector('div[data-bind="affectsBubble: $root.recordingBubble"]');
        if (targetDiv && !document.querySelector('.quick-tools-fieldset')) {
            console.log("MusicBrainz Quick Tools Debug: Found target div, adding button container.");
            const buttonContainer = createButtonContainer();
            targetDiv.before(buttonContainer);
        } else if (targetDiv) {
            console.log("MusicBrainz Quick Tools Debug: Target div found, but buttons already exist. Skipping.");
        } else {
            console.log("MusicBrainz Quick Tools Debug: Target div not found.");
        }
    }

    function removeQuickToolsButtons() {
        const existingButtonContainer = document.querySelector('.quick-tools-fieldset');
        if (existingButtonContainer) {
            console.log("MusicBrainz Quick Tools Debug: Removing button container.");
            existingButtonContainer.remove();
        }
    }

    function createCancelButton() {
        const cancelButton = document.createElement('button');
        cancelButton.id = 'quick-tools-cancel-button';
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 20px;
            font-size: 16px;
            background-color: #d32f2f;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            z-index: 1000;
        `;
        cancelButton.onclick = cancelProcess;
        document.body.appendChild(cancelButton);
    }

    function removeCancelButton() {
        const cancelButton = document.getElementById('quick-tools-cancel-button');
        if (cancelButton) {
            cancelButton.remove();
        }
    }

    function disableMainButtons() {
        mainButtons = document.querySelectorAll('.musicbrainz-quick-tool-button');
        mainButtons.forEach(button => {
            button.disabled = true;
            button.style.opacity = '0.5';
            button.style.cursor = 'not-allowed';
        });
        const dropdowns = document.querySelectorAll('#confidence-level-dropdown, #matching-method-dropdown');
        dropdowns.forEach(dropdown => {
            if (dropdown) dropdown.disabled = true;
        });
    }

    function enableMainButtons() {
        if (mainButtons) {
            mainButtons.forEach(button => {
                button.disabled = false;
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
            });
        }
        const dropdowns = document.querySelectorAll('#confidence-level-dropdown, #matching-method-dropdown');
        dropdowns.forEach(dropdown => {
            if (dropdown) dropdown.disabled = false;
        });
    }

    function cancelProcess() {
        isCancelled = true;
        removeCancelButton();
        enableMainButtons();
        console.log("MusicBrainz Quick Tools: Process cancelled.");
    }

    function runProcess(handler) {
        isCancelled = false;
        currentIndex = 0;
        editButtons = document.querySelectorAll('#recordings .edit-track-recording');
        if (editButtons.length === 0) {
            alert("No tracks found. Make sure you are on the 'Recordings' tab and have a tracklist.");
            return;
        }

        disableMainButtons();
        createCancelButton();
        handler();
    }

    function shouldIgnore(confidence) {
        if (ignoredConfidenceLevel === 'red' && confidence === 'red') {
            return true;
        }
        if (ignoredConfidenceLevel === 'orange_and_above' && ['orange', 'dark-orange', 'red'].includes(confidence)) {
            return true;
        }
        if (ignoredConfidenceLevel === 'yellow_and_above' && ['yellow', 'orange', 'dark-orange', 'red'].includes(confidence)) {
            return true;
        }
        return false;
    }

    function startAutoLinking() {
        const autoLinkButton = document.querySelector('.musicbrainz-quick-tool-button');
        autoLinkButton.style.backgroundColor = '#ebbba0';

        runProcess(() => {
            function processNextTrack() {
                if (isCancelled || currentIndex >= editButtons.length) {
                    autoLinkButton.style.backgroundColor = '#bceba0';
                    removeCancelButton();
                    enableMainButtons();
                    highlightAllDifferences();
                    return;
                }

                const currentButton = editButtons[currentIndex];
                const trackRow = currentButton.closest('tr.track');
                currentButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                currentButton.click();

                setTimeout(() => {
                    const nextButton = document.querySelector('#recording-assoc-bubble button[data-click="nextTrack"]');

                    if (matchingMethod === 'suggested') {
                        const firstSuggested = document.querySelector('#recording-assoc-bubble input[data-change="recording"]');
                        if (firstSuggested) {
                            firstSuggested.click();
                            console.log(`MusicBrainz Quick Tools: Selected first suggested recording for track ${currentIndex + 1}.`);
                            setTimeout(() => {
                                const confidence = getConfidenceLevel(trackRow);
                                if (confidence && shouldIgnore(confidence)) {
                                    console.log(`MusicBrainz Quick Tools: Match has confidence '${confidence}', ignoring.`);
                                    const addNewRecordingButton = document.querySelector('#recording-assoc-bubble #add-new-recording');
                                    if (addNewRecordingButton) {
                                        addNewRecordingButton.click();
                                    }
                                }
                                if (nextButton) nextButton.click();
                                currentIndex++;
                                processNextTrack();
                            }, 100);
                        } else {
                            console.log(`MusicBrainz Quick Tools: No suggested recordings for track ${currentIndex + 1}. Moving to next track.`);
                            if (nextButton) nextButton.click();
                            currentIndex++;
                            processNextTrack();
                        }
                    } else if (matchingMethod === 'search') {
                        const searchIcon = document.querySelector('#recording-assoc-bubble img.search');
                        if (searchIcon) {
                            searchIcon.click();
                            console.log(`MusicBrainz Quick Tools: Searching for track ${currentIndex + 1}.`);

                            const observer = new MutationObserver((mutations, obs) => {
                                const firstSearchResult = document.querySelector('.ui-autocomplete .ui-menu-item a');
                                const noResultsItem = document.querySelector('.ui-autocomplete .ui-menu-item')?.textContent.includes('(No results)');

                                if (firstSearchResult) {
                                    obs.disconnect();
                                    firstSearchResult.click();
                                    console.log(`MusicBrainz Quick Tools: Selected first search result for track ${currentIndex + 1}.`);

                                    setTimeout(() => {
                                        const confidence = getConfidenceLevel(trackRow);

                                        if (confidence && shouldIgnore(confidence)) {
                                            console.log(`MusicBrainz Quick Tools: Match for track ${currentIndex + 1} has confidence '${confidence}', ignoring and unlinking.`);
                                            const addNewRecordingButton = document.querySelector('#recording-assoc-bubble #add-new-recording');
                                            if (addNewRecordingButton) {
                                                addNewRecordingButton.click();
                                            }
                                        }

                                        if (nextButton) {
                                            nextButton.click();
                                        } else {
                                            console.log(`MusicBrainz Quick Tools: Could not find the "Next" button for track ${currentIndex + 1}.`);
                                        }

                                        currentIndex++;
                                        processNextTrack();
                                    }, 100);
                                } else if (noResultsItem) {
                                    obs.disconnect();
                                    console.log(`MusicBrainz Quick Tools: No search results found for track ${currentIndex + 1}. Skipping.`);
                                    if (nextButton) {
                                        nextButton.click();
                                    }
                                    currentIndex++;
                                    processNextTrack();
                                }
                            });

                            observer.observe(document.body, {
                                childList: true,
                                subtree: true
                            });

                        } else {
                            console.log(`MusicBrainz Quick Tools: Could not find search icon for track ${currentIndex + 1}. Skipping.`);
                            if (nextButton) {
                                nextButton.click();
                            } else {
                                console.log(`MusicBrainz Quick Tools: Could not find the "Next" button for track ${currentIndex + 1}.`);
                            }
                            currentIndex++;
                            processNextTrack();
                        }
                    }
                }, 1000); // Initial delay for the popup to appear
            }
            processNextTrack();
        });
    }

    function startUnlinking() {
        const unlinkButton = document.querySelectorAll('.musicbrainz-quick-tool-button')[1];
        unlinkButton.style.backgroundColor = '#ebbba0';

        runProcess(() => {
            function processNextTrack() {
                if (isCancelled || currentIndex >= editButtons.length) {
                    unlinkButton.style.backgroundColor = '#bceba0';
                    removeCancelButton();
                    enableMainButtons();
                    highlightAllDifferences();
                    return;
                }

                const currentButton = editButtons[currentIndex];
                currentButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                currentButton.click();

                setTimeout(() => {
                    const addNewRecordingButton = document.querySelector('#recording-assoc-bubble #add-new-recording');
                    const nextButton = document.querySelector('#recording-assoc-bubble button[data-click="nextTrack"]');

                    if (addNewRecordingButton) {
                        addNewRecordingButton.click();
                        console.log(`MusicBrainz Quick Tools: Unlinked track ${currentIndex + 1} and selected to add a new recording.`);
                    } else {
                        console.log(`MusicBrainz Quick Tools: Could not find "Add a new recording" button for track ${currentIndex + 1}. Skipping.`);
                    }

                    if (nextButton) {
                        nextButton.click();
                    } else {
                        console.log(`MusicBrainz Quick Tools: Could not find the "Next" button for track ${currentIndex + 1}.`);
                    }

                    highlightAllDifferences();

                    currentIndex++;
                    processNextTrack();
                }, 1000);
            }
            processNextTrack();
        });
    }

    window.addEventListener('load', () => {
        const recordingsTabContent = document.getElementById('recordings');
        if (!recordingsTabContent) {
            console.error("MusicBrainz Quick Tools Debug: Could not find the #recordings element.");
            return;
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'aria-hidden') {
                    const isTabActive = mutation.target.getAttribute('aria-hidden') === 'false';
                    if (isTabActive) {
                        addQuickToolsButtons();
                        highlightAllDifferences();
                    } else {
                        removeQuickToolsButtons();
                    }
                }
            });
        });

        console.log("MusicBrainz Quick Tools Debug: Initializing MutationObserver on the #recordings element's attributes.");
        observer.observe(recordingsTabContent, { attributes: true });

        if (recordingsTabContent.getAttribute('aria-hidden') === 'false') {
            addQuickToolsButtons();
            highlightAllDifferences();
        }
    });

    document.body.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('edit-track-recording')) {
            currentTrackRow = target.closest('tr.track');
        }
    });

    const recordingPopup = document.getElementById('recording-assoc-bubble');
    if (recordingPopup) {
        const popupObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length || mutation.removedNodes.length) {
                    if (currentTrackRow) {
                        setTimeout(() => {
                           highlightSingleTrack(currentTrackRow);
                        }, 100);
                    }
                }
            });
        });

        console.log("MusicBrainz Quick Tools Debug: Initializing MutationObserver on the recording association bubble.");
        popupObserver.observe(recordingPopup, { childList: true, subtree: true });
    }
})();
