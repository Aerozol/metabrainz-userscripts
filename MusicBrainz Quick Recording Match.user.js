// ==UserScript==
// @name        MusicBrainz Quick Recording Match
// @namespace   https://github.com/Aerozol/metabrainz-userscripts
// @description Select the first recording search result for each track, in the release editor Recordings tab.
// @version     5.20
// @downloadURL https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Recording%20Match.user.js
// @updateURL   https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Recording%20Match.user.js
// @license     MIT
// @author      Google Gemini
// @match       *://*.musicbrainz.org/release/*/edit*
// @match       *://*.musicbrainz.org/release/add*
// @grant       GM_getValue
// @grant       GM_setValue
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    let isCancelled = false;
    let currentIndex = 0;
    let editButtons;
    let mainButtons;
    let currentTrackRow = null;
    let ignoredConfidenceLevel = GM_getValue('ignoredConfidenceLevel', 'none');
    let matchingMethod = GM_getValue('matchingMethod', 'suggested');
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

    function getCandidateConfidence(trackRow, candidate) {
        const artistRow = trackRow.nextElementSibling;
        const nameCells = trackRow.querySelectorAll('td.name');
        const trackTitleCell = nameCells[0];
        const trackLengthCell = trackRow.querySelector('td.length');
        const trackArtistCell = artistRow?.querySelector('td[colspan="2"]:first-of-type > span');

        const trackTitle = trackTitleCell?.querySelector('bdi')?.textContent.trim().toLowerCase();
        const trackArtists = trackArtistCell?.textContent.trim().toLowerCase();

        const candidateTitle = candidate.name?.trim().toLowerCase();
        const candidateArtists = candidate.artist?.trim().toLowerCase();

        let lengthDiff = 0;
        if (trackLengthCell && candidate.length) {
            const trackLengthMs = parseLengthToMs(trackLengthCell.textContent.trim());
            const candidateLengthMs = parseLengthToMs(candidate.length);
            if (trackLengthMs !== null && candidateLengthMs !== null) {
                lengthDiff = Math.abs(trackLengthMs - candidateLengthMs);
            }
        }

        const differences = [];
        if (candidateTitle && trackTitle && trackTitle !== candidateTitle) {
            differences.push('Title');
        }
        if (candidateArtists && trackArtists && trackArtists !== candidateArtists) {
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

    function setInputValue(element, value) {
        let ok = false;
        try {
            element.focus();
            element.setSelectionRange(0, element.value.length);
            ok = value ? document.execCommand('insertText', false, value)
                       : document.execCommand('delete', false, null);
            if (ok && element.value !== value) ok = false;
        } catch (e) { ok = false; }
        if (!ok) {
            const isTextArea = element instanceof window.HTMLTextAreaElement;
            const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor && descriptor.set) {
                descriptor.set.call(element, value);
            } else {
                element.value = value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
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
            GM_setValue('ignoredConfidenceLevel', ignoredConfidenceLevel);
            console.log(`Ignoring confidence level set to: ${ignoredConfidenceLevel}`);
        });

        select.value = ignoredConfidenceLevel;

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
            GM_setValue('matchingMethod', matchingMethod);
            console.log(`Matching method set to: ${matchingMethod}`);
        });

        select.value = matchingMethod;

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
        const isrcButton = createButton('Match by ISRC', openIsrcModal);
        isrcButton.title = 'Requires companion script: MusicBrainz: Search by ISRC in release editor';
        const unlinkButton = createButton('Unlink all tracks', startUnlinking);
        p1.appendChild(autoLinkButton);
        p1.appendChild(isrcButton);
        p1.appendChild(unlinkButton);
        p1.appendChild(createConfidenceDropdown());
        p1.appendChild(createMethodDropdown());
        p1.appendChild(createStartAtDropdown());
        fieldset.appendChild(p1);

        return fieldset;
    }

    function addQuickToolsButtons() {
        const targetDiv = document.querySelector('div[data-bind="affectsBubble: $root.recordingBubble"]');
        if (targetDiv && !document.querySelector('.quick-tools-fieldset')) {
            console.log("MusicBrainz Quick Tools Debug: Found target div, adding button container.");
            const buttonContainer = createButtonContainer();
            targetDiv.before(buttonContainer);
            return true;
        }
        return false;
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
        const startAtDropdown = document.getElementById('start-at-dropdown');
        const startIndex = startAtDropdown ? parseInt(startAtDropdown.value) : 0;
        currentIndex = startIndex;
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
    let attempts = 0;
    const maxAttempts = 30; // Maximum wait of 3 seconds (30 * 100ms)

    const pollSuggested = setInterval(() => {
        const firstSuggested = document.querySelector('#recording-assoc-bubble input[data-change="recording"]');
        const nextButton = document.querySelector('#recording-assoc-bubble button[data-click="nextTrack"]');

        attempts++;

        if (firstSuggested) {
            // Found a suggestion! Stop waiting and click it immediately
            clearInterval(pollSuggested);
            firstSuggested.click();
            console.log(`MusicBrainz Quick Tools: Selected suggested recording for track ${currentIndex + 1} after ${attempts * 100}ms.`);

            setTimeout(() => {
                const confidence = getConfidenceLevel(trackRow);
                if (confidence && shouldIgnore(confidence)) {
                    const addNewRecordingButton = document.querySelector('#recording-assoc-bubble #add-new-recording');
                    if (addNewRecordingButton) addNewRecordingButton.click();
                }
                if (nextButton) nextButton.click();
                currentIndex++;
                processNextTrack();
            }, 100);
        } else if (attempts >= maxAttempts) {
            // Reached timeout and no suggestion appeared
            clearInterval(pollSuggested);
            console.log(`MusicBrainz Quick Tools: No suggested recordings found for track ${currentIndex + 1} after 3 seconds.`);
            if (nextButton) nextButton.click();
            currentIndex++;
            processNextTrack();
        }
    }, 100); // Check every 100ms
}
                     else if (matchingMethod === 'search') {
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

    function openIsrcModal() {
        const overlay = document.createElement('div');
        overlay.id = 'quick-tools-isrc-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white; padding: 20px; border-radius: 8px;
            width: 400px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            font-family: inherit; display: flex; flex-direction: column; gap: 15px;
        `;

        modal.innerHTML = `
            <h2 style="margin: 0; font-size: 1.2em;">Match Recordings by ISRC</h2>
            <p style="margin: 0; font-size: 0.9em; color: #555;">
                Paste a list of ISRCs below, one per line.<br>
                Line 1 matches the track selected in the 'Start at' dropdown, Line 2 matches the next, etc.
            </p>
            <p style="margin: 0; padding: 8px 10px; font-size: 0.85em; background: #fff8e1; border-left: 3px solid #f9a825; border-radius: 2px; color: #555;">
                ⚠️ Requires the companion script
                <a href="https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Search%20by%20ISRC%20in%20release%20editor.user.js"
                   target="_blank" rel="noopener noreferrer" style="color: #1a73e8;">
                    MusicBrainz: Search by ISRC in release editor
                </a>
                to be installed and active.
            </p>
            <textarea id="isrc-paste-area" rows="15" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; resize: vertical;" placeholder="US-RC1-76-09839\n..."></textarea>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button type="button" id="isrc-cancel-btn" style="padding: 6px 12px; cursor: pointer; border: 1px solid #ccc; background: #f8f8f8; border-radius: 4px;">Cancel</button>
                <button type="button" id="isrc-start-btn" style="padding: 6px 12px; cursor: pointer; border: 1px solid transparent; background: #4CAF50; color: white; border-radius: 4px; font-weight: bold;">Start Matching</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('isrc-cancel-btn').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('isrc-start-btn').addEventListener('click', () => {
            const isrcText = document.getElementById('isrc-paste-area').value;
            overlay.remove();
            startIsrcMatching(isrcText);
        });
    }

    function startIsrcMatching(isrcText) {
        const isrcs = isrcText.split('\n').map(s => s.trim());
        const isrcButtons = document.querySelectorAll('.musicbrainz-quick-tool-button');
        const isrcButton = Array.from(isrcButtons).find(btn => btn.textContent === 'Match by ISRC');
        if (isrcButton) isrcButton.style.backgroundColor = '#ebbba0';

        runProcess(() => {
            const startAtDropdown = document.getElementById('start-at-dropdown');
            const startIndex = startAtDropdown ? parseInt(startAtDropdown.value) : 0;

            function processNextTrack() {
                if (isCancelled || currentIndex >= editButtons.length) {
                    if (isrcButton) isrcButton.style.backgroundColor = '#bceba0';
                    removeCancelButton();
                    enableMainButtons();
                    highlightAllDifferences();
                    return;
                }

                const listIndex = currentIndex - startIndex;
                const remainingIsrcs = isrcs.slice(listIndex).some(s => s);
                if (!remainingIsrcs) {
                    if (isrcButton) isrcButton.style.backgroundColor = '#bceba0';
                    removeCancelButton();
                    enableMainButtons();
                    highlightAllDifferences();
                    return;
                }

                if (!isrcs[listIndex]) {
                    // Blank ISRC provided for this track. Skip it.
                    currentIndex++;
                    processNextTrack();
                    return;
                }

                const currentButton = editButtons[currentIndex];
                const trackRow = currentButton.closest('tr.track');
                currentButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                currentButton.click();

                setTimeout(() => {
                    const nextButton = document.querySelector('#recording-assoc-bubble button[data-click="nextTrack"]');
                    const closeButton = document.querySelector('#recording-assoc-bubble button[data-click="close"]');
                    const searchInput = document.querySelector('#recording-assoc-bubble input.name');
                    const searchIcon = document.querySelector('#recording-assoc-bubble img.search');

                    function advanceOrClose() {
                        if (searchInput) searchInput.blur();
                        document.querySelectorAll('.ui-autocomplete').forEach(el => el.style.display = 'none');
                        const hasMore = isrcs.slice(listIndex + 1).some(s => s);
                        if (hasMore && nextButton) {
                            nextButton.click();
                        } else {
                            if (closeButton) closeButton.click();
                        }
                        currentIndex++;
                        processNextTrack();
                    }

                    if (searchInput && searchIcon) {
                        setInputValue(searchInput, isrcs[listIndex]);
                        // searchIcon.click(); // Removed: setInputValue fires 'input' which triggers search automatically.
                        console.log(`MusicBrainz Quick Tools: Searching ISRC for track ${currentIndex + 1}.`);

                        const observer = new MutationObserver((mutations, obs) => {
                            const autocompleteMenu = document.querySelector('.ui-autocomplete');
                            if (!autocompleteMenu) return;

                            const noResultsItem = Array.from(document.querySelectorAll('.ui-autocomplete .ui-menu-item')).find(item => item.textContent.includes('(No results)'));
                            const searchResults = Array.from(document.querySelectorAll('.ui-autocomplete .ui-menu-item a')).filter(a => {
                                return !a.textContent.includes('Switch back') && !a.textContent.includes('Add a new recording') && !a.textContent.includes('(No results)');
                            });

                            if (searchResults.length > 0) {
                                obs.disconnect();

                                let bestCandidate = null;
                                let bestScore = -1;

                                searchResults.forEach(a => {
                                    const lengthSpan = a.querySelector('.autocomplete-length');
                                    const lengthText = lengthSpan ? lengthSpan.textContent.trim() : null;

                                    let title = '';
                                    for (const node of a.childNodes) {
                                        if (node.nodeType === Node.TEXT_NODE) {
                                            title += node.textContent;
                                        }
                                    }
                                    title = title.trim();

                                    const artistSpan = Array.from(a.querySelectorAll('.autocomplete-comment')).find(span => span.textContent.trim().startsWith('by '));
                                    const artist = artistSpan ? artistSpan.textContent.replace('by ', '').trim() : '';

                                    const candidateData = { name: title, length: lengthText, artist: artist, element: a };
                                    const confidence = getCandidateConfidence(trackRow, candidateData);

                                    if (!shouldIgnore(confidence)) {
                                        const score = confidence === null ? 4 : (confidence === 'yellow' ? 3 : (confidence === 'orange' ? 2 : (confidence === 'dark-orange' ? 1 : 0)));
                                        if (score > bestScore) {
                                            bestScore = score;
                                            bestCandidate = candidateData;
                                        }
                                    }
                                });

                                if (bestCandidate) {
                                    bestCandidate.element.click();
                                    console.log(`MusicBrainz Quick Tools: Selected best match for ISRC on track ${currentIndex + 1}.`);
                                    setTimeout(() => {
                                        advanceOrClose();
                                    }, 100);
                                } else {
                                    console.log(`MusicBrainz Quick Tools: No acceptable match found for track ${currentIndex + 1}. Unlinking.`);
                                    const addNewRecordingButton = document.querySelector('#recording-assoc-bubble #add-new-recording');
                                    if (addNewRecordingButton) addNewRecordingButton.click();
                                    advanceOrClose();
                                }
                            } else if (noResultsItem) {
                                obs.disconnect();
                                console.log(`MusicBrainz Quick Tools: No ISRC results found for track ${currentIndex + 1}. Skipping.`);
                                advanceOrClose();
                            }
                        });

                        observer.observe(document.body, { childList: true, subtree: true });
                    } else {
                        console.log(`MusicBrainz Quick Tools: Could not find search input for track ${currentIndex + 1}. Skipping.`);
                        advanceOrClose();
                    }
                }, 1000);
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

function initializeQuickTools() {
    const recordingsTabContent = document.getElementById('recordings');

    // Only proceed if the recordings element exists and is currently visible
    if (recordingsTabContent && recordingsTabContent.getAttribute('aria-hidden') === 'false') {
        if (addQuickToolsButtons()) {
            highlightAllDifferences();
        }
    }
}

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

    function createStartAtDropdown() {
        const container = document.createElement('span');
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';

        const separator = document.createElement('span');
        separator.textContent = '|';
        separator.style.margin = '0 10px 0 5px';
        separator.style.color = '#ccc';
        container.appendChild(separator);

        const label = document.createElement('span');
        label.textContent = 'Start at:';
        label.style.fontWeight = 'bold';
        label.style.marginRight = '5px';
        container.appendChild(label);

        const select = document.createElement('select');
        select.id = 'start-at-dropdown';
        select.style.cssText = `
            padding: 4px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 1em;
        `;

        const trackRows = document.querySelectorAll('#track-recording-assignation tr.track');
        trackRows.forEach((trackRow, index) => {
            const option = document.createElement('option');
            const trackNumberElement = trackRow.querySelector('td.track.title');
            const trackNumber = trackNumberElement ? trackNumberElement.textContent.trim() : index + 1;
            option.value = index;
            option.textContent = `Track ${trackNumber}`;
            select.appendChild(option);
        });

        container.appendChild(select);
        return container;
    }

    // This observer ensures the script runs even if the page content loads late
const globalObserver = new MutationObserver(() => {
    initializeQuickTools();
});

// Watch the entire document for changes to elements or attributes (like aria-hidden)
globalObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden']
});

// Also try an immediate execution in case it's already loaded
initializeQuickTools();

})();
