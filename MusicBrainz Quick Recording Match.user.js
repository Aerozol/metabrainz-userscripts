// ==UserScript==
// @name        MusicBrainz Quick Recording Match
// @namespace   https://github.com/Aerozol/metabrainz-userscripts
// @description Select the first recording search result for each track, in the release editor Recordings tab. Highlights bad matches.
// @match       *://*.musicbrainz.org/release/*/edit*
// @match       *://*.beta.musicbrainz.org/release/add
// @author      Gemini
// @grant       none
// @version     5.0
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    let isCancelled = false;
    let currentIndex = 0;
    let editButtons;
    let mainButtons;
    let currentTrackRow = null;

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
     * Checks for differences and highlights the edit button for a single track row.
     * @param {HTMLElement} trackRow The <tr> element of the track to check.
     */
    function highlightSingleTrack(trackRow) {
        if (!trackRow) return;
        const artistRow = trackRow.nextElementSibling;

        const editButton = trackRow.querySelector('.edit-track-recording');
        if (editButton) {
            editButton.style.backgroundColor = '';
            editButton.title = '';
        }

        const isUnlinked = trackRow.querySelector('.edit-track-recording.negative') !== null;

        if (isUnlinked) {
            return;
        }

        const differences = [];
        let lengthDiff = 0;

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

        if (editButton) {
            const tooltipText = differences.length > 0 ? differences.join(', ') + ' difference' : '';

            if (differences.length >= 3 && lengthDiff > 10000) {
                 // everything different, including a length change over 10 seconds - red
                editButton.style.backgroundColor = '#ffaea1'; // Red
                editButton.title = `Multiple major differences: ${tooltipText}`;
            } else if (lengthDiff > 15000) {
                // a length change over 15 seconds - dark orange
                editButton.style.backgroundColor = '#ffc5a1'; // Dark Orange
                editButton.title = `Major length difference (> 15 seconds). ${tooltipText}`;
            } else if (differences.length >= 2 && lengthDiff <= 15000) {
                // 2 differences, including a length change up to 15 seconds - orange
                editButton.style.backgroundColor = '#ffd0a1'; // Orange
                editButton.title = `Multiple differences found: ${tooltipText}`;
            } else if (differences.length === 1 || lengthDiff > 3000) {
                // 1 difference OR length change over 3 seconds - yellow
                editButton.style.backgroundColor = '#ffe6a1'; // Yellow
                editButton.title = `Minor difference found: ${tooltipText}`;
            }
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

    function createButtonContainer() {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'quick-tools-fieldset';

        const legend = document.createElement('legend');
        legend.textContent = 'Quick tools';

        const p = document.createElement('p');

        const autoLinkButton = createButton('Auto-link all tracks', startAutoLinking);
        const unlinkButton = createButton('Unlink all tracks', startUnlinking);

        p.appendChild(autoLinkButton);
        p.appendChild(unlinkButton);

        fieldset.appendChild(legend);
        fieldset.appendChild(p);

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
    }

    function enableMainButtons() {
        if (mainButtons) {
            mainButtons.forEach(button => {
                button.disabled = false;
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
            });
        }
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
                currentButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                currentButton.click();

                setTimeout(() => {
                    const suggestedRecording = document.querySelector('#recording-assoc-bubble input[name="recording-selection"][data-change="recording"]');
                    const nextButton = document.querySelector('#recording-assoc-bubble button[data-click="nextTrack"]');

                    if (suggestedRecording) {
                        suggestedRecording.click();
                        console.log(`MusicBrainz Quick Tools: Auto-linked track ${currentIndex + 1} to the first suggested recording.`);
                    } else {
                        console.log(`MusicBrainz Quick Tools: No suggested recording found for track ${currentIndex + 1}. Skipping.`);
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
