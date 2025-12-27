// ==UserScript==
// @name MusicBrainz Nuclear Tags
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Quick buttons to submit and remember tag strings (ctrl+click to forget them). Submit and clear tags to selected sub-entities (artist > release group > release > recordings).
// @version      1.3
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Nuclear%20Tags.user.js
// @updateURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Nuclear%20Tags.user.js
// @license      MIT
// @author       ChatGPT
// @match        *://*.musicbrainz.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_SHORTCUTS = 'mbz_tag_shortcuts';
    const STORAGE_KEY_LAST_SUBMITTED = 'mbz_last_submitted_tag';
    const STORAGE_KEY_BULK_EXPANDED = 'mbz_elephant_tags_bulk_expanded';
    // Merge checkbox selector for Release Groups and Releases
    const MERGE_CHECKBOX_SELECTOR = 'input[name="add-to-merge"]';
    // Custom checkbox selector for Recordings
    const RECORDING_CHECKBOX_SELECTOR = 'input[name="elephant-tag-checkbox"]';

    let parentObserver = null;
    let formContentObserver = null;
    let isAddingUI = false;

    // Global state for cascading action targets (used only for initial UI state/checkbox syncing)
    let isToggledRGs = false;
    let isToggledReleases = false;
    let isToggledRecordings = false;
    let progressDisplay = null;

    // --- Re-initialization Function (Non-destructive rebinding) ---
    function rebindUIElements(form) {
        if (!form) return;

        // 1. Get the necessary elements from the potentially new DOM structure
        const input = form.querySelector('input.tag-input');
        const submitButton = form.querySelector('button.styled-button');
        const shortcutContainer = form.querySelector('.tag-shortcuts');

        if (input && submitButton && shortcutContainer) {
            // 2. Simply re-render the buttons and re-bind listeners to the new input/submit elements
            renderTagButtons(shortcutContainer, getSavedTags(), input, submitButton);
            setupFormContentObserver(form);
            console.log('%c[ElephantTags] Rebound UI elements successfully.', 'color: purple; font-weight: bold;');
        } else {
             // If key elements are missing, assume full destruction and force a full re-injection
             const existingWrapper = form.querySelector('.elephant-tags-wrapper');
             if (existingWrapper) {
                 existingWrapper.remove();
             }
             addTaggingUI();
        }
    }


    // ----------------------------------------------------------------------
    // Storage Helpers
    // ----------------------------------------------------------------------
    function getSavedTags() {
        return GM_getValue(STORAGE_KEY_SHORTCUTS, []);
    }

    function saveTags(tags) {
        GM_setValue(STORAGE_KEY_SHORTCUTS, tags);
    }

    function getLastSubmittedTag() {
        return GM_getValue(STORAGE_KEY_LAST_SUBMITTED, '');
    }

    function saveLastSubmittedTag(tag) {
        GM_setValue(STORAGE_KEY_LAST_SUBMITTED, tag);
    }

    function removeTagShortcut(tagToRemove) {
        let savedTags = getSavedTags();
        savedTags = savedTags.filter(t => t !== tagToRemove);
        saveTags(savedTags);
    }

    function getBulkExpandedState() {
        return GM_getValue(STORAGE_KEY_BULK_EXPANDED, false);
    }

    function setBulkExpandedState(isExpanded) {
        GM_setValue(STORAGE_KEY_BULK_EXPANDED, isExpanded);
    }

    // ----------------------------------------------------------------------
    // UI Helpers
    // ----------------------------------------------------------------------
    function updateProgress(message) {
        if (!progressDisplay) return;
        progressDisplay.textContent = message;
        progressDisplay.style.display = message ? 'block' : 'none';
    }

    /**
     * Disables and restyles the 'Clear instead of tag' toggle after an action is executed.
     */
    function markClearToggleAsStale(isBulkAction = false) {
        const clearLabel = document.querySelector('label[for="mb-clear-action"]');
        const clearCheckbox = document.getElementById('mb-clear-action');

        if (clearLabel && clearCheckbox) {
            console.log('%c[ElephantTags] Mark toggle as stale: Applying visual changes.', 'color: #777;');

            // Apply visual changes: Only indicate refresh required if bulk action was performed
            const message = `actioned${isBulkAction ? ' (refresh required)' : ''}`;
            clearLabel.textContent = message; // Force update
            clearLabel.style.setProperty('color', '#777', 'important');
            clearLabel.style.setProperty('text-decoration', 'line-through', 'important');

            // Disable the checkbox and uncheck it
            clearCheckbox.checked = false;
            clearCheckbox.disabled = true;
        } else {
            console.warn('[ElephantTags] Mark toggle as stale: Could not find clear toggle elements.');
        }
    }

    // ----------------------------------------------------------------------
    // Tagging Status & Rendering (Core Logic)
    // ----------------------------------------------------------------------

    function saveAndRenderOnSubmission(form, tagText, input, submitButton, isNewTag = false) {
        const tag = tagText.trim();
        if (!tag) return;
        if (isNewTag) {
            const savedTags = getSavedTags();
            if (!savedTags.includes(tag)) {
                savedTags.push(tag);
                saveTags(savedTags);
            }
        }
        saveLastSubmittedTag(tag);
        const shortcutContainer = form.querySelector('.tag-shortcuts');
        if (shortcutContainer) {
            renderTagButtons(shortcutContainer, getSavedTags(), input, submitButton);
        }
    }

    function renderTagButtons(container, tags, input, submitButton) {
        if (formContentObserver) {
            // Do NOT disconnect observer here. Rely on setupFormContentObserver to manage it.
        }

        const oldButtons = container.querySelectorAll('.brain-tag-button, .repeat-tag-button, .tag-shortcut-btn');
        oldButtons.forEach(btn => btn.remove());

        const insertButton = (newNode) => { container.appendChild(newNode); };

        // --- Brain Button ---
        const brainButton = document.createElement('button');
        brainButton.textContent = '🧠';
        brainButton.title = 'Submit and remember tags. Ctrl+click to remove a remembered tag.';
        brainButton.classList.add('brain-tag-button');
        brainButton.style.cssText = `font-size: 11px; height: 22px; padding: 2px 6px; margin: 2px 4px 2px 0; background-color: #eee; color: #333; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;`;
        brainButton.addEventListener('click', function (e) {
            e.preventDefault();
            const tagText = input.value.trim();
            if (!tagText) return;
            saveAndRenderOnSubmission(container.closest('form'), tagText, input, submitButton, true);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            submitButton.click();
        });
        insertButton(brainButton);

        // --- Repeat Button ---
        const lastTag = getLastSubmittedTag();
        const repeatButton = document.createElement('button');
        repeatButton.textContent = '🔄';
        repeatButton.title = lastTag ? `Apply last submitted tag: "${lastTag}"` : 'No previous tag to apply.';
        repeatButton.classList.add('repeat-tag-button');
        repeatButton.style.cssText = `font-size: 11px; height: 22px; padding: 2px 6px; margin: 2px 4px 2px 0; background-color: #eee; color: #333; border: 1px solid #ccc; border-radius: 4px; ${!lastTag ? 'opacity: 0.5; cursor: not-allowed;' : 'cursor: pointer;'}`;
        if (lastTag) {
            repeatButton.addEventListener('click', function (e) {
                e.preventDefault();
                input.value = lastTag;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                submitButton.click();
            });
        }
        insertButton(repeatButton);

        // --- Shortcut Buttons ---
        tags.forEach(tag => {
            const btn = document.createElement('button');
            btn.textContent = tag.substring(0, 3);
            btn.title = tag;
            btn.classList.add('tag-shortcut-btn');
            btn.style.cssText = `font-size: 11px; height: 22px; padding: 2px 6px; margin: 2px 4px 2px 0; background-color: #f8f8f8; color: #333; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;`;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (e.ctrlKey) {
                    removeTagShortcut(tag);
                    renderTagButtons(container, getSavedTags(), input, submitButton);
                } else {
                    input.value = tag;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    submitButton.click();
                    saveAndRenderOnSubmission(container.closest('form'), tag, input, submitButton);
                }
            });
            insertButton(btn);
        });

        if (formContentObserver) {
            // Do NOT re-attach observer here. Rely on setupFormContentObserver to manage it.
        }
    }

    // ----------------------------------------------------------------------
    // Bulk Tagging/Clearing Functions
    // ----------------------------------------------------------------------

    /**
     * Sends a request to the MusicBrainz API to upvote (tag) or downvote (clear) a tag for a given entity.
     * @param {string} id The MBID of the entity.
     * @param {string} type The entity type (e.g., 'release-group', 'release', 'recording').
     * @param {string} tag The tag string to apply or clear.
     * @param {'upvote'|'downvote'} action The action to perform.
     * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
     */
    async function updateEntityTags(id, type, tag, action) {
        const requestUrl = `${location.origin}/${type}/${id}/tags/${action}?tags=${encodeURIComponent(tag)}`;
        try {
            const response = await fetch(requestUrl, {
                credentials: "include",
                method: "GET",
                headers: { "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" }
            });

            if (!response.ok) {
                // **LOGGING ADDED**: Report non-successful status codes in the console.
                console.error(`[ElephantTags - AJAX Failure] Action '${action}' failed for ${type} ${id} tag "${tag}". Status: ${response.status} ${response.statusText}. Check the Network tab for details.`);
            }

            return response.ok;
        } catch (err) {
            console.error(`[ElephantTags - Network Error] Action '${action}' failed for ${type} ${id} tag "${tag}". Error:`, err);
            return false;
        }
    }

    function showTagStatus(aElement, tag, isSuccess, isEntity = true, isClear = false) {
        const statusIcon = document.createElement('span');
        statusIcon.classList.add(isEntity ? 'rg-tag-status' : 'rec-tag-status');
        statusIcon.style.cssText = `margin-left: 5px; font-size: 1.2em; cursor: help; vertical-align: middle;`;
        if (isClear) {
            // Shows a broom icon 🧹 for success, ❌ for failure
            statusIcon.textContent = isSuccess ? '🧹' : '❌';
            statusIcon.title = isSuccess ? `Successfully cleared tag "${tag}"` : `Failed to clear tag "${tag}". Check browser console for errors, or ensure the tag was applied to this entity.`;
        } else {
            statusIcon.textContent = isSuccess ? '✅' : '❌';
            statusIcon.title = isSuccess ? `Successfully tagged with "${tag}"` : `Failed to tag with "${tag}". Check permissions/tag limits.`;
        }
        aElement.insertAdjacentElement('afterend', statusIcon);
    }

    async function getReleasesForRG(rgId) {
        const rgPageUrl = `${location.origin}/release-group/${rgId}`;
        const parser = new DOMParser();
        try {
            const response = await fetch(rgPageUrl, { credentials: "include" });
            const html = await response.text();
            const doc = parser.parseFromString(html, 'text/html');

            const releaseRows = doc.querySelectorAll('table.tbl:not(.medium) tbody tr');
            const releases = [];

            releaseRows.forEach(row => {
                const link = row.querySelector('td:nth-child(2) a[href*="/release/"]');
                if (link) {
                    const match = link.getAttribute('href').match(/\/release\/([0-9a-f-]+)/i);
                    if (match) {
                        releases.push({ id: match[1], title: link.textContent.trim() });
                    }
                }
            });
            return releases;
        } catch (err) {
            console.error(`[ElephantTags - Scrape Error] Failed to fetch releases for RG ${rgId}:`, err);
            return [];
        }
    }

    // MODIFIED: Added taggedRecordingIds parameter with default value for safety
    async function fetchAndExecuteRecordingsFromRelease(releaseId, tag, action, isClear, taggedRecordingIds = new Set()) {
        let success = 0;
        let failure = 0;

        const releasePageUrl = `${location.origin}/release/${releaseId}`;
        const parser = new DOMParser();

        try {
            const response = await fetch(releasePageUrl, { credentials: "include" });
            const html = await response.text();
            const doc = parser.parseFromString(html, 'text/html');

            const recordingRows = doc.querySelectorAll('table.tbl.medium tbody tr');

            for (const row of recordingRows) {
                const recordingLink = row.querySelector('td.title a[href*="/recording/"]');
                if (!recordingLink) continue;

                const match = recordingLink.getAttribute('href').match(/\/recording\/([0-9a-f-]+)/i);
                if (!match) continue;
                const recordingId = match[1];

                // --- OPTIMIZATION: Check if recording was already tagged ---
                if (!isClear && taggedRecordingIds.has(recordingId)) {
                    console.log(`[ElephantTags - Skip] Recording ${recordingId} already tagged in this batch. Skipping API call.`);
                    success++; // Count as success since the goal is achieved
                    continue;
                }
                // --- END OPTIMIZATION ---


                const isSuccess = await updateEntityTags(recordingId, 'recording', tag, action);
                isSuccess ? success++ : failure++;

                // Add ID to the set if the tag was successful (only for tagging)
                if (!isClear && isSuccess) {
                    taggedRecordingIds.add(recordingId);
                }
            }
        } catch (err) {
            console.error(`[ElephantTags - Scrape Error] Failed to fetch or parse release page for ${releaseId}:`, err);
            failure += 1;
        }

        return { success, failure };
    }

 async function tagCheckedReleaseGroups(tag, actionType, isToggledRGsParam, isToggledReleasesParam, isToggledRecordingsParam) {
    // Action function is AJAX Upvote or AJAX Downvote
    const action = (actionType === 'tag') ? 'upvote' : 'downvote';
    const isClear = actionType === 'clear';

    // --- OPTIMIZATION: Track tagged recordings globally for this cascade ---
    const taggedRecordingIds = new Set();
    // --- END OPTIMIZATION ---

    // Select only checked checkboxes that are currently visible
    const checkedRGs = Array.from(document.querySelectorAll('table.release-group-list ' + MERGE_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null);
    const totalRGs = checkedRGs.length;

    if (totalRGs === 0) { console.log("No visible release groups checked for action."); updateProgress(''); return; }

    let rgSuccess = 0, rgFailure = 0;
    let rlSuccess = 0, rlFailure = 0;
    let recSuccess = 0, recFailure = 0;

    for (let i = 0; i < totalRGs; i++) {
        const checkbox = checkedRGs[i];
        const row = checkbox.closest('tr');
        const titleCell = row.querySelectorAll('td')[2];
        const rgLink = titleCell.querySelector('a[href*="/release-group/"]');
        const match = rgLink?.getAttribute('href').match(/\/release-group\/([0-9a-f-]+)/i);

        if (!match) { rgFailure++; continue; }
        const releaseGroupId = match[1];

        updateProgress(`Processing RG ${i + 1}/${totalRGs}: ${isClear ? 'Clearing' : 'Tagging'} ${rgLink.textContent.trim()}...`);

        // Execute AJAX and show status for the list entity (Release Group)
        // Only execute if the RG toggle is explicitly checked (isToggledRGsParam)
        let isRGSuccess = true;
        if (isToggledRGsParam) {
            rgLink.closest('td').querySelectorAll('.rg-tag-status').forEach(el => el.remove());
            isRGSuccess = await updateEntityTags(releaseGroupId, 'release-group', tag, action);
            isRGSuccess ? rgSuccess++ : rgFailure++;
            if(isRGSuccess) checkbox.checked = false;
            showTagStatus(rgLink, tag, isRGSuccess, true, isClear);
        }
        // -----------------------------------------------------------------------------------------

        if (isToggledReleasesParam || isToggledRecordingsParam) {
            console.log(`%c[ElephantTags - Cascade Check] RG ${i + 1}/${totalRGs} (${releaseGroupId}): isToggledReleases=${isToggledReleasesParam}, isToggledRecordings=${isToggledRecordingsParam}`, 'color: purple; font-weight: bold;');

            const releases = await getReleasesForRG(releaseGroupId);
            console.log(`%c[ElephantTags - Releases Found] Fetched ${releases.length} releases for RG ${releaseGroupId}.`, 'color: orange; font-weight: bold;');

            updateProgress(`Processing RG ${i + 1}/${totalRGs}: ${isClear ? 'Clearing' : 'Tagging'} ${releases.length} Releases...`);

            for (const release of releases) {
                // Release tagging/clearing: Only execute if the Release toggle is explicitly checked
                let isRLSuccess = true;
                if (isToggledReleasesParam) {
                    isRLSuccess = await updateEntityTags(release.id, 'release', tag, action);
                    isRLSuccess ? rlSuccess++ : rlFailure++;

                    if (isRLSuccess) {
                        console.log(`[ElephantTags - Release Action] SUCCESS for Release ${release.title} (${release.id})`);
                    } else {
                        console.warn(`[ElephantTags - Release Action] FAILURE for Release ${release.title} (${release.id}). Check console logs for status code.`);
                    }
                }

                // Check recording toggle parameter
                // Requires the recording toggle to be on AND a release action to have succeeded (or been skipped, as isRLSuccess is true by default if skipped)
                if (isToggledRecordingsParam && isRLSuccess) {
                    updateProgress(`Processing RG ${i + 1}/${totalRGs}: ${isClear ? 'Clearing' : 'Tagging'} Recordings in Release: ${release.title}...`);
                    const recResults = await fetchAndExecuteRecordingsFromRelease(release.id, tag, action, isClear, taggedRecordingIds);
                    recSuccess += recResults.success;
                    recFailure += recResults.failure;
                }
            }
        }
    }

    const summary = [
        `RG: ${rgSuccess} ${isClear ? '🧹' : '✅'}, ${rgFailure} ❌`,
        (isToggledReleasesParam || isToggledRecordingsParam) ? `Release: ${rlSuccess} ${isClear ? '🧹' : '✅'}, ${rlFailure} ❌` : '',
        isToggledRecordingsParam ? `Rec: ${recSuccess} ${isClear ? '🧹' : '✅'}, ${recFailure} ❌` : ''
    ].filter(Boolean).join(' | ');

    console.log(`RG Bulk Action Summary: ${summary}`);
    updateProgress(`RG Bulk Action Complete. ${summary}`);
}

async function tagCheckedReleases(tag, actionType, isToggledReleasesParam, isToggledRecordingsParam) {
    // Action function is AJAX Upvote or AJAX Downvote
    const action = (actionType === 'tag') ? 'upvote' : 'downvote';
    const isClear = actionType === 'clear';

    // --- OPTIMIZATION: Track tagged recordings globally for this cascade ---
    const taggedRecordingIds = new Set();
    // --- END OPTIMIZATION ---

    const checkedReleases = Array.from(document.querySelectorAll('table.tbl:not(.medium) ' + MERGE_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null);
    const totalReleases = checkedReleases.length;

    if (totalReleases === 0) { console.log("No visible releases checked for action."); updateProgress(''); return; }

    let rlSuccess = 0;
    let rlFailure = 0;
    let recSuccess = 0;
    let recFailure = 0;

    for (let i = 0; i < totalReleases; i++) {
        const checkbox = checkedReleases[i];
        const row = checkbox.closest('tr');
        const titleCell = row.querySelector('td:nth-child(2)');
        const rlLink = titleCell.querySelector('a[href*="/release/"]');
        const match = rlLink?.getAttribute('href').match(/\/release\/([0-9a-f-]+)/i);

        if (!match) { rlFailure++; continue; }
        const releaseId = match[1];

        updateProgress(`Processing Release ${i + 1}/${totalReleases}: ${isClear ? 'Clearing' : 'Tagging'} ${rlLink.textContent.trim()}...`);

        // Execute AJAX and show status for the list entity (Release)
        // Only execute if the Release toggle is explicitly checked (isToggledReleasesParam)
        let isRLSuccess = true;
        if (isToggledReleasesParam) {
            rlLink.closest('td').querySelectorAll('.rg-tag-status').forEach(el => el.remove());
            isRLSuccess = await updateEntityTags(releaseId, 'release', tag, action);
            isRLSuccess ? rlSuccess++ : rlFailure++;
            if(isRLSuccess) checkbox.checked = false;
            showTagStatus(rlLink, tag, isRLSuccess, true, isClear);
        }
        // -----------------------------------------------------------------------------------------

        // Check recording toggle parameter
        // Requires the recording toggle to be on AND a release action to have succeeded (or been skipped)
        if (isToggledRecordingsParam && isRLSuccess) {
            updateProgress(`Processing Release ${i + 1}/${totalReleases}: ${isClear ? 'Clearing' : 'Tagging'} Recordings...`);
            const recResults = await fetchAndExecuteRecordingsFromRelease(releaseId, tag, action, isClear, taggedRecordingIds);
            recSuccess += recResults.success;
            recFailure += recResults.failure;
        }
    }

    const summary = [
        `Release: ${rlSuccess} ${isClear ? '🧹' : '✅'}, ${rlFailure} ❌`,
        isToggledRecordingsParam ? `Rec: ${recSuccess} ${isClear ? '🧹' : '✅'}, ${recFailure} ❌` : ''
    ].filter(Boolean).join(' | ');

    console.log(`Release Bulk Action Summary: ${summary}`);
    updateProgress(`Release Bulk Action Complete. ${summary}`);
}

    async function tagCheckedRecordings(tag, actionType) {
        // Action function is AJAX Upvote or AJAX Downvote
        const action = (actionType === 'tag') ? 'upvote' : 'downvote';
        const isClear = actionType === 'clear';

        const checkedRecordings = Array.from(document.querySelectorAll('table.tbl.medium ' + RECORDING_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null);
        const totalRecordings = checkedRecordings.length;

        if (totalRecordings === 0) { console.log("No visible recordings checked for action."); updateProgress(''); return; }

        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < totalRecordings; i++) {
            const checkbox = checkedRecordings[i];
            const row = checkbox.closest('tr');
            const recordingLink = row.querySelector('td.title a[href*="/recording/"]');

            if (!recordingLink) { failureCount++; continue; }
            const match = recordingLink.getAttribute('href').match(/\/recording\/([0-9a-f-]+)/i);
            if (!match) { failureCount++; continue; }
            const recordingId = match[1];

            updateProgress(`Processing Recording ${i + 1}/${totalRecordings}: ${isClear ? 'Clearing' : 'Tagging'} ${recordingLink.textContent.trim()}...`);

            // Execute AJAX and show status for the list entity
            recordingLink.closest('.title').querySelectorAll('.rec-tag-status').forEach(el => el.remove());

            const isSuccess = await updateEntityTags(recordingId, 'recording', tag, action);
            isSuccess ? successCount++ : failureCount++;

            showTagStatus(recordingLink, tag, isSuccess, false, isClear);
            if(isSuccess) checkbox.checked = false;
        }

        const summary = `Rec: ${successCount} ${isClear ? '🧹' : '✅'}, ${failureCount} ❌`;
        console.log(`Recording Bulk Action Summary: ${summary}`);
        updateProgress(`Recording Bulk Action Complete. ${summary}`);
    }


    // --- Recording Checkbox Injection ---
    function addRecordingCheckboxes(isToggled) {
        const tracklistTables = document.querySelectorAll('table.tbl.medium');

        tracklistTables.forEach(table => {
            let headRow = table.querySelector('thead tr.subh') || table.querySelector('tbody tr.subh');

            if (!headRow || headRow.querySelector('th.elephant-tag-col')) return;

            const newHeader = document.createElement('th');
            newHeader.classList.add('elephant-tag-col');
            newHeader.style.cssText = `width: 20px`;
            newHeader.title = 'Bulk Tag Recordings';

            const masterCheckbox = document.createElement('input');
            masterCheckbox.type = 'checkbox';
            masterCheckbox.name = 'elephant-tag-master';
            masterCheckbox.title = 'Toggle all visible recording tags';
            masterCheckbox.checked = isToggled;

            masterCheckbox.addEventListener('change', (e) => {
                table.querySelectorAll(RECORDING_CHECKBOX_SELECTOR).forEach(cb => {
                    cb.checked = e.target.checked;
                });
            });
            headRow.prepend(newHeader);
            newHeader.appendChild(masterCheckbox); // Append master checkbox to its header

            table.querySelectorAll('tbody > tr').forEach(row => {
                if (row.classList.contains('subh') || !row.querySelector('td.pos')) return;

                const newCell = document.createElement('td');
                newCell.classList.add('elephant-tag-col');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.name = 'elephant-tag-checkbox';
                checkbox.checked = isToggled;

                row.prepend(newCell); // Prepend new cell to the row
                newCell.appendChild(checkbox);
            });
        });
    }

    // ----------------------------------------------------------------------
    // UI Initialization & Rendering Logic
    // ----------------------------------------------------------------------

    function addTaggingUI() {

        isAddingUI = true;
        const form = document.getElementById('tag-form');
        if (!form) { isAddingUI = false; return; }

        // --- Idempotency Check ---
        if (form.querySelector('.elephant-tags-wrapper')) {
            // **FIX: Removed repetitive console log. Rebind and exit silently.**
            rebindUIElements(form);
            isAddingUI = false;
            return;
        }

        const input = form.querySelector('input.tag-input');
        const submitButton = form.querySelector('button.styled-button');

        if (!input || !submitButton) { isAddingUI = false; return; }

        console.log('%c[ElephantTags] addTaggingUI: Injecting Custom UI...', 'color: green; font-weight: bold;');


        const pathname = location.pathname;
        let pageContext = null;
        let masterToggleText = null;
        let entityId = null;

        const entityMatch = pathname.match(/\/(artist|release-group|release)\/([0-9a-f-]+)/i);

        if (entityMatch) {
            entityId = entityMatch[2];
            if (entityMatch[1] === 'artist' && document.querySelector('table.release-group-list ' + MERGE_CHECKBOX_SELECTOR)) {
                pageContext = 'artist';
                masterToggleText = 'Tag selected release groups';
            } else if (entityMatch[1] === 'release-group' && document.querySelector('table.tbl:not(.medium) ' + MERGE_CHECKBOX_SELECTOR)) {
                pageContext = 'release_group';
                masterToggleText = 'Tag selected releases';
            } else if (entityMatch[1] === 'release' && document.querySelector('table.tbl.medium')) {
                pageContext = 'release';
                masterToggleText = 'Tag selected recordings';
            }
        }


        // 1. Create the main UI wrapper
        const unifiedWrapper = document.createElement('div');
        unifiedWrapper.className = 'elephant-tags-wrapper';
        unifiedWrapper.style.cssText = `border: 1px solid #ccc; border-radius: 4px; padding: 4px; margin-top: 6px; display: block; width: 100%; box-sizing: border-box;`;

        // 2. Add the Tag Shortcut Buttons container
        const shortcutContainer = document.createElement('div');
        shortcutContainer.className = 'tag-shortcuts';
        shortcutContainer.style.cssText = `display: flex; flex-wrap: wrap; align-items: flex-start; margin-bottom: 4px;`;
        unifiedWrapper.appendChild(shortcutContainer);

        renderTagButtons(shortcutContainer, getSavedTags(), input, submitButton);
        setupFormContentObserver(form);

        // 3. Conditional Bulk Action UI
        if (pageContext) {

            if (pageContext === 'release') {
                addRecordingCheckboxes(isToggledRecordings);
            }

            const isBulkExpanded = getBulkExpandedState();

            // --- Bulk UI Wrapper (The Collapsible Part) ---
            const bulkWrapper = document.createElement('div');
            bulkWrapper.style.cssText = `border-top: 1px dashed #ddd; margin-top: 4px; padding-top: 4px;`;

            // --- Collapse Button ---
            const collapseButton = document.createElement('button');
            collapseButton.textContent = `Nuclear Options (Bulk Actions) ${isBulkExpanded ? '▲' : '▼'}`;
            collapseButton.style.cssText = `width: 100%; text-align: left; font-size: 11px; padding: 4px 6px; margin: 0; background-color: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;`;

            // --- Toggle Container (Holds the checkboxes) ---
            const toggleContainer = document.createElement('div');
            toggleContainer.className = 'bulk-toggle-chain';
            toggleContainer.style.cssText = `width: 100%; display: ${isBulkExpanded ? 'block' : 'none'}; padding-top: 4px;`;

            collapseButton.onclick = (e) => {
                e.preventDefault();
                const isCurrentlyExpanded = toggleContainer.style.display !== 'none';
                toggleContainer.style.display = isCurrentlyExpanded ? 'none' : 'block';
                collapseButton.textContent = isCurrentlyExpanded ? 'Nuclear Options (Bulk Actions) ▼' : 'Nuclear Options (Bulk Actions) ▲';
                setBulkExpandedState(!isCurrentlyExpanded);
            };
            bulkWrapper.appendChild(collapseButton);


            // --- Checkbox Creation Helper ---
            const createCheckboxToggle = (id, text, margin) => {
                const span = document.createElement('span');
                span.style.cssText = `display: flex; align-items: center; margin: 2px 0; font-size: 11px; font-weight: normal; margin-left: ${margin};`;

                const checkbox = document.createElement('input');
                checkbox.setAttribute('type', 'checkbox');
                checkbox.id = id;
                checkbox.classList.add('toggle-rg-checkbox');

                const label = document.createElement('label');
                label.setAttribute('for', id);
                label.textContent = text;
                label.style.marginLeft = '4px';
                label.style.cursor = 'pointer';

                span.appendChild(checkbox);
                span.appendChild(label);
                return { span, checkbox, label };
            };

            // --- Cascade Checkboxes (The three main toggles) ---
            let masterToggle = null;
            let releaseToggle = null;
            let recordingToggle = null;

            masterToggle = createCheckboxToggle('mb-master-toggle', masterToggleText, '0px');
            masterToggle.checkbox.checked = isToggledRGs || isToggledRecordings;
            toggleContainer.appendChild(masterToggle.span);

            if (pageContext === 'artist') {
                releaseToggle = createCheckboxToggle('mb-releases-toggle', '↳ releases', '20px');
                releaseToggle.checkbox.checked = isToggledReleases;
                toggleContainer.appendChild(releaseToggle.span);
            }

            if (pageContext !== 'release') {
                 recordingToggle = createCheckboxToggle('mb-recordings-toggle', '↳ recordings', pageContext === 'artist' ? '40px' : '20px');
                 recordingToggle.checkbox.checked = isToggledRecordings;
                 toggleContainer.appendChild(recordingToggle.span);
            }

            // --- Clear Action Toggle (The single switch) ---
            const clearToggleWrapper = document.createElement('div');
            clearToggleWrapper.style.cssText = `border-top: 1px dashed #ddd; margin-top: 4px; padding-top: 4px;`;
            const clearToggle = createCheckboxToggle('mb-clear-action', 'Clear instead of tag', '0px');
            clearToggle.label.style.color = '#777';
            clearToggleWrapper.appendChild(clearToggle.span);
            toggleContainer.appendChild(clearToggleWrapper);


            // --- Toggle Event Listeners (Daisy Chain Logic) ---
            const updateCheckboxState = () => {
                // 1. Sync global state from checkboxes (for future UI injection/rebinds)
                if (masterToggle) {
                    if (pageContext === 'artist' || pageContext === 'release-group') {
                        isToggledRGs = masterToggle.checkbox.checked;
                    } else if (pageContext === 'release') {
                        isToggledRecordings = masterToggle.checkbox.checked;
                    }
                }

                if (releaseToggle) {
                    isToggledReleases = releaseToggle.checkbox.checked;
                }
                if (recordingToggle) {
                    isToggledRecordings = recordingToggle.checkbox.checked;
                }

                // 2. Apply Daisy Chain Logic (Updates UI from bottom up) (DISABLED TO ALLOW FOR SELECTING SEPARATE 'LEVELS')
             //   if (recordingToggle) {
             //       if (isToggledRecordings) {
             //           if (releaseToggle) {
             //               isToggledReleases = true;
             //               releaseToggle.checkbox.checked = true;
             //           }
             //           if (masterToggle) {
             //               if (pageContext === 'release') {
             //                   isToggledRecordings = true;
             //               } else {
             //                   isToggledRGs = true;
             //               }
             //               masterToggle.checkbox.checked = true;
             //           }
             //       }
             //   }
             //   if (releaseToggle) {
             //       if (isToggledReleases && masterToggle) {
             //           if (pageContext !== 'release') {
             //               isToggledRGs = true;
             //               masterToggle.checkbox.checked = true;
             //           }
             //       }
             //   }

                // 3. Sync Native Merge Checkboxes
                const masterToggled = masterToggle.checkbox.checked;
                const selector = (pageContext === 'artist') ? 'table.release-group-list ' + MERGE_CHECKBOX_SELECTOR : 'table.tbl:not(.medium) ' + MERGE_CHECKBOX_SELECTOR;
                document.querySelectorAll(selector).forEach(cb => {
                    if (cb.offsetParent !== null) {
                        cb.checked = masterToggled;
                    }
                });

                // 4. Sync Custom Recording Checkboxes (on /release/ page only)
                if (pageContext === 'release') {
                     document.querySelectorAll(RECORDING_CHECKBOX_SELECTOR).forEach(cb => {
                         cb.checked = isToggledRecordings;
                     });
                     const masterRecToggle = document.querySelector('input[name="elephant-tag-master"]');
                     if (masterRecToggle) masterRecToggle.checked = isToggledRecordings;
                }
            };

            // Attach listener to all cascaded checkboxes
            document.querySelectorAll('.toggle-rg-checkbox').forEach(cb => {
                if (cb.id !== 'mb-clear-action') {
                    cb.addEventListener('change', updateCheckboxState);
                }
            });

            updateCheckboxState();

            bulkWrapper.appendChild(toggleContainer);

            // --- Progress Display ---
            progressDisplay = document.createElement('div');
            progressDisplay.className = 'tag-progress-reporter';
            progressDisplay.style.cssText = `margin-top: 4px; font-size: 11px; font-style: italic; color: #555; display: none;`;
            bulkWrapper.appendChild(progressDisplay);

            unifiedWrapper.appendChild(bulkWrapper);

            // --- Submit Button Handler with FIX for Single Clear ---
            submitButton.addEventListener('click', async function (e) {

                // CRUCIAL: Re-fetch form and input inside the closure for the currently active elements
                const currentForm = document.getElementById('tag-form');
                const currentInput = currentForm ? currentForm.querySelector('input.tag-input') : null;
                const tagText = currentInput ? currentInput.value.trim() : '';

                if (!tagText) return;

                const clearActionCheckbox = document.getElementById('mb-clear-action');
                const actionType = clearActionCheckbox.checked ? 'clear' : 'tag';

                const isMasterToggled = masterToggle.checkbox.checked;
                const hasManualSelection = (
                    pageContext === 'artist' && document.querySelectorAll('table.release-group-list ' + MERGE_CHECKBOX_SELECTOR + ':checked').length > 0
                ) || (
                    pageContext === 'release-group' && document.querySelectorAll('table.tbl:not(.medium) ' + MERGE_CHECKBOX_SELECTOR + ':checked').length > 0
                ) || (
                    pageContext === 'release' && document.querySelectorAll('table.tbl.medium ' + RECORDING_CHECKBOX_SELECTOR + ':checked').length > 0
                );

                const isBulkAction = isMasterToggled || hasManualSelection;

                // Always save the tag/render buttons before any action
                saveAndRenderOnSubmission(currentForm, tagText, currentInput, submitButton);

                // Map page context to API entity type
                const apiEntityType = entityMatch ? (entityMatch[1] === 'artist' ? 'artist' : entityMatch[1] === 'release-group' ? 'release-group' : 'release') : null;

// --- READ CASCADE TOGGLE STATE DIRECTLY FROM DOM FOR RELIABILITY ---
const masterChecked = masterToggle ? masterToggle.checkbox.checked : false;

let isToggledRGsNow = false;
let isToggledReleasesNow = false;
let isToggledRecordingsNow = false;

if (pageContext === 'artist') {
    // Artist Page: 3 Toggles (RGs, Releases, Recordings)
    isToggledRGsNow = masterChecked; // Master toggle controls RGs
    isToggledReleasesNow = releaseToggle ? releaseToggle.checkbox.checked : false;
    isToggledRecordingsNow = recordingToggle ? recordingToggle.checkbox.checked : false;
} else if (pageContext === 'release_group') {
    // RG Page: 2 Toggles (Releases, Recordings)
    isToggledReleasesNow = masterChecked; // Master toggle controls Releases
    isToggledRecordingsNow = recordingToggle ? recordingToggle.checkbox.checked : false;
} else if (pageContext === 'release') {
    // Release Page: 1 Toggle (Recordings)
    isToggledRecordingsNow = masterChecked; // Master toggle controls Recordings
}


 // 1. SCENARIO: TAG (Native Upvote Flow)
if (actionType === 'tag') {
    // If it's just a single tag, we do nothing and allow native flow to complete instantly.
    if (!isBulkAction) {
        // Action finished by native click. Disable clear toggle immediately.
        markClearToggleAsStale(false);
        return;
    }

    // If it's a bulk tag, we let the native action tag the current entity,
    // then start our cascade immediately (no delay).
    console.log(`[ElephantTags] Bulk TAG: Allowing native upvote. Starting cascade immediately.`);

    setTimeout(async () => {
        updateProgress(`Current entity action (native tag) complete. Starting bulk cascade...`);

        // --- RUN CHILD BULK ACTION ---
if (pageContext === 'artist') {
    // PASS: RG Toggle, Releases Toggle, Recordings Toggle
    await tagCheckedReleaseGroups(tagText, actionType, isToggledRGsNow, isToggledReleasesNow, isToggledRecordingsNow);
} else if (pageContext === 'release_group') {
    // PASS: Releases Toggle (isToggledReleasesNow is now correct), Recordings Toggle
    await tagCheckedReleases(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
} else if (pageContext === 'release') {
    // This only runs the recording bulk action (the release itself is tagged by native flow)
    await tagCheckedRecordings(tagText, actionType);
}

        // --- UI CLEANUP ---
        updateProgress(`Bulk Action Complete. Refresh required to view changes.`);
        setTimeout(() => { updateProgress(''); }, 3000);
        markClearToggleAsStale(true); // Disable after bulk
    }, 100); // 100ms small delay to ensure native click fires first
    return;
}


                // 2. SCENARIO: CLEAR (Custom Downvote Flow) - INTERRUPT native UPVOTE
                e.preventDefault();

                // Clear the input field immediately
                currentInput.value = '';
                currentInput.dispatchEvent(new Event('input', { bubbles: true }));

                // --- Execute Clear Action ---
                if (apiEntityType && entityId) {

                    if (isBulkAction) {
                        // --- BULK CLEAR: Custom AJAX for Current Entity + Cascade ---
                        console.log(`[ElephantTags] BULK CLEAR: Intercepting native upvote and performing manual downvote for current entity and starting cascade.`);
                        updateProgress(`Clearing tag from current entity: ${tagText}...`);

                        // Use custom AJAX clear for current entity in the bulk path
                        const isMainEntityClearSuccess = await updateEntityTags(entityId, apiEntityType, tagText, 'downvote');

                        // Immediately mark as stale and update label
                        markClearToggleAsStale(true);

                        updateProgress(`Current entity action complete. Starting bulk cascade...`);

                        // Bulk Clear: start the cascade immediately.
            setTimeout(async () => {
                // --- RUN CHILD BULK ACTION (Clear) ---
                if (pageContext === 'artist') {
                    await tagCheckedReleaseGroups(tagText, actionType, isToggledRGsNow, isToggledReleasesNow, isToggledRecordingsNow);
                } else if (pageContext === 'release_group') {
                    // CHECK THIS LINE: ENSURE THERE IS NO COMMA AT THE END
                    await tagCheckedReleases(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                } else if (pageContext === 'release') {
                    // CHECK THIS LINE: ENSURE THERE IS NO COMMA AT THE END
                    await tagCheckedRecordings(tagText, actionType);
                } // <-- If you see a comma here, remove it.

                // --- UI CLEANUP ---
                updateProgress(`Bulk Action Complete. Refresh required to view changes.`);
                // This next line should end with a semicolon (;) not a comma (,)
                setTimeout(() => { updateProgress(''); }, 3000);

            }, 100); // 100ms small delay to ensure native click is fully cancelled.

                    } else {
                        // --- SINGLE CLEAR: Using Robust Event Dispatch for Instant UI Update ---
                        console.log(`[ElephantTags] SINGLE CLEAR: Intercepting native upvote and performing native downvote click for instant UI update.`);
                        updateProgress(`Clearing tag from current entity: ${tagText}...`);

                        const encodedTag = encodeURIComponent(tagText.trim());
                        // Find the tag link element in the sidebar (genre or other tags)
                        const tagLink = document.querySelector(`.sidebar-tags a[href='/tag/${encodedTag}']`);

                        if (tagLink) {
                            const downvoteButton = tagLink.closest('li')?.querySelector('.tag-downvote');

                            if (downvoteButton) {
                                // Create a robust MouseEvent to ensure React/Vue handles it correctly
                                const event = new MouseEvent('click', {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true,
                                    // Make it look like a real user click
                                    clientX: 0,
                                    clientY: 0,
                                    button: 0 // Left mouse button
                                });

                                // Dispatch the event instead of using the simple .click()
                                downvoteButton.dispatchEvent(event);
                                console.log(`[ElephantTags] SINGLE CLEAR: Dispatched simulated MouseEvent on native downvote button for "${tagText}". SUCCESS (UI should update instantly).`);
                            } else {
                                console.log(`[ElephantTags] SINGLE CLEAR: Tag found but downvote button not present (tag not upvoted by user). No action needed.`);
                            }
                        } else {
                            console.log(`[ElephantTags] SINGLE CLEAR: Tag not found in sidebar list. No action needed.`);
                        }

                        // Action complete, disable the toggle and clear the progress message
                        markClearToggleAsStale(false);
                        setTimeout(() => { updateProgress(''); }, 500); // Clear progress message quickly
                    }
                }

                // If not a bulk action, we return here since the single clear is complete (or not needed).
                if (!isBulkAction) return;

            }, true); // Use capture phase

        }

        // FINAL UI ASSEMBLY
        form.appendChild(unifiedWrapper);
        isAddingUI = false;
    }

    // ----------------------------------------------------------------------
    // Mutation Observer Setup
    // ----------------------------------------------------------------------

    function setupFormContentObserver(form) {
        if (formContentObserver) {
            formContentObserver.disconnect();
        }

        formContentObserver = new MutationObserver(function(mutationsList, observer) {
            const wrapper = form.querySelector('.elephant-tags-wrapper');
            if (!wrapper) return;

            const shortcutContainer = form.querySelector('.tag-shortcuts');
            // Check for button presence, in case the tag box is cleared/re-rendered
            if (shortcutContainer && shortcutContainer.querySelectorAll('.brain-tag-button, .repeat-tag-button, .tag-shortcut-btn').length < 3) {
                 const input = form.querySelector('input.tag-input');
                 const submitButton = form.querySelector('button.styled-button');
                 if (input && submitButton) {
                     renderTagButtons(shortcutContainer, getSavedTags(), input, submitButton);
                 }
            }
        });

        formContentObserver.observe(form, { childList: true });
    }

    function setupParentObserver() {
        if (parentObserver) {
            parentObserver.disconnect();
        }

        const isRelevantPage = location.pathname.startsWith('/artist/') ||
                               location.pathname.startsWith('/release-group/') ||
                               location.pathname.startsWith('/release/');

        if (!isRelevantPage) return;

        // Target the element that eventually holds the tag form
        const targetNode = document.getElementById('content') || document.body;
        let initialAttemptDone = false;

        // Function to attempt injecting the UI
        const tryAddUI = (delay, isFallback) => {
            const form = document.getElementById('tag-form');
            if (form) {
                // Check for wrapper presence before running addTaggingUI
                if (form.querySelector('.elephant-tags-wrapper')) {
                    // UI is already present from a previous run (including the 3s run), do nothing.
                    return;
                }

                // Only log when we are actually going to inject.
                if (isFallback) {
                    console.log('%c[ElephantTags] Parent Observer: FALLBACK INJECTION (10s). UI not present, injecting now.', 'color: orange; font-weight: bold;');
                } else {
                    console.log('%c[ElephantTags] Parent Observer: INITIAL INJECTION (3s). #tag-form detected, injecting now.', 'color: green; font-weight: bold;');
                }
                addTaggingUI();
            }
        };


        const scheduleChecks = () => {
            if (initialAttemptDone) return;
            initialAttemptDone = true;

            // 1. Initial attempt (3 seconds)
            console.log('%c[ElephantTags] Parent Observer: Scheduling initial UI injection in 3000ms.', 'color: blue; font-weight: bold;');
            setTimeout(() => tryAddUI(5000, false), 5000);

            // 2. Fallback attempt (10 seconds total)
            console.log('%c[ElephantTags] Parent Observer: Scheduling fallback UI check/injection in 10000ms.', 'color: blue; font-weight: bold;');
            setTimeout(() => tryAddUI(10000, true), 10000);
        };


        const callback = function(mutationsList, observer) {
            if (document.getElementById('tag-form') && !initialAttemptDone) {
                scheduleChecks();
            }
        };

        parentObserver = new MutationObserver(callback);
        // We observe the main content area for the tag form to appear (and re-appear)
        parentObserver.observe(targetNode, { childList: true, subtree: true });

        // Check if form is present on page load (before observer triggers)
        if (document.getElementById('tag-form')) {
            scheduleChecks();
        }
    }

    // ----------------------------------------------------------------------
    // Main Script Initialization
    // ----------------------------------------------------------------------

    if (document.readyState !== 'loading') {
        setupParentObserver();
    } else {
        window.addEventListener('DOMContentLoaded', setupParentObserver);
    }
})();
