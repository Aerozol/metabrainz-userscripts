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
// @grant        GM_addStyle
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

    // ----------------------------------------------------------------------
    // CSS Injection
    // ----------------------------------------------------------------------
    const CSS = `
        .elephant-tags-wrapper {
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 4px;
            margin-top: 6px;
            display: block;
            width: 100%;
            box-sizing: border-box;
        }
        .tag-shortcuts {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            margin-bottom: 4px;
        }
        .nuclear-tag-btn {
            font-size: 11px;
            height: 22px;
            padding: 2px 6px;
            margin: 2px 4px 2px 0;
            background-color: #eee;
            color: #333;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
        }
        .nuclear-tag-btn:hover { background-color: #ddd; }
        .tag-shortcut-btn { background-color: #f8f8f8; }
        .tag-shortcut-btn:hover { background-color: #eee; }
        .brain-tag-button { background-color: #eee; }
        .repeat-tag-button.disabled { opacity: 0.5; cursor: not-allowed; }

        .nuclear-bulk-wrapper {
            border-top: 1px dashed #ddd;
            margin-top: 4px;
            padding-top: 4px;
        }
        .nuclear-collapse-btn {
            width: 100%;
            text-align: left;
            font-size: 11px;
            padding: 4px 6px;
            margin: 0;
            background-color: #f0f0f0;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
        }
        .nuclear-collapse-btn:hover { background-color: #e8e8e8; }
        .nuclear-toggle-container {
            width: 100%;
            padding-top: 4px;
        }
        .nuclear-toggle-row {
            display: flex;
            align-items: center;
            margin: 2px 0;
            font-size: 11px;
            font-weight: normal;
        }
        .nuclear-label {
            margin-left: 4px;
            cursor: pointer;
        }
        .nuclear-clear-wrapper {
            border-top: 1px dashed #ddd;
            margin-top: 4px;
            padding-top: 4px;
        }
        .nuclear-progress {
            margin-top: 4px;
            font-size: 11px;
            font-style: italic;
            color: #555;
            display: none;
        }
        .nuclear-status {
            margin-left: 5px;
            font-size: 11px;
        }
        .elephant-tag-col { width: 20px; }
    `;

    GM_addStyle(CSS);

    let formContentObserver = null;
    let mainObserver = null;
    const injectedForms = new WeakSet();

    // Global state for cascading action targets (used only for initial UI state/checkbox syncing)
    let isToggledRGs = false;
    let isToggledReleases = false;
    let isToggledRecordings = false;
    let progressDisplay = null;

    // --- Re-initialization Function (Non-destructive rebinding) ---


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

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
        brainButton.classList.add('nuclear-tag-btn', 'brain-tag-button');
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
        repeatButton.classList.add('nuclear-tag-btn', 'repeat-tag-button');
        if (!lastTag) repeatButton.classList.add('disabled');
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
            btn.classList.add('nuclear-tag-btn', 'tag-shortcut-btn');
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

    // ----------------------------------------------------------------------
    // API Helpers (Official JSON & XML API)
    // ----------------------------------------------------------------------

    /**
     * Submits tags for multiple entities in a single XML POST request.
     * @param {Array<{id: string, type: string}>} entityList List of entities to tag.
     * @param {string[]} tags List of tags to apply (or remove).
     * @param {'upvote'|'downvote'|'withdraw'} action The vote action.
     * @returns {Promise<boolean>} True if successful.
     */
    async function submitTagsBatch(entityList, tags, action) {
        if (!entityList.length || !tags.length) return false;

        const clientVersion = 'MusicBrainzNuclearTags-1.4';
        const url = `${location.origin}/ws/2/tag?client=${clientVersion}`;

        // Group entities by type
        const groups = {
            'artist': [],
            'release-group': [],
            'release': [],
            'recording': [],
            'label': []
        };

        entityList.forEach(e => {
            if (groups[e.type]) groups[e.type].push(e.id);
        });

        // Construct XML
        let xmlContent = '';
        for (const [type, ids] of Object.entries(groups)) {
            if (ids.length === 0) continue;

            xmlContent += `    <${type}-list>\n`;
            ids.forEach(id => {
                xmlContent += `        <${type} id="${id}">\n`;
                xmlContent += `            <user-tag-list>\n`;
                tags.forEach(tag => {
                    xmlContent += `                <user-tag vote="${action}"><name>${tag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</name></user-tag>\n`;
                });
                xmlContent += `            </user-tag-list>\n`;
                xmlContent += `        </${type}>\n`;
            });
            xmlContent += `    </${type}-list>\n`;
        }

        const xmlBody = `<metadata xmlns="http://musicbrainz.org/ns/mmd-2.0#">\n${xmlContent}</metadata>`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8'
                },
                body: xmlBody
            });

            const text = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const message = xmlDoc.querySelector("message text")?.textContent;

            if (!response.ok) {
                console.error(`[ElephantTags] Batch ${action} failed. Status: ${response.status} ${response.statusText}`, text);
                return false;
            }

            if (message === 'OK') {
                console.log(`[ElephantTags] Batch ${action} successful. Server responded: ${message}`);
                return true;
            } else {
                console.warn(`[ElephantTags] Batch ${action} completed with unexpected response:`, text);
                // We return true anyway if status is 200, but warn the user.
                // Or should we return false? strictly speaking 200 OK means success in MB.
                // Let's stick to returning true but logging the warnings.
                return true;
            }
        } catch (err) {
            console.error(`[ElephantTags] Batch network error:`, err);
            return false;
        }
    }

    /**
     * Retries a fetch operation with exponential backoff.
     * @param {string} url
     * @param {number} retries
     * @param {number} backoff
     */
    async function fetchWithRetry(url, retries = 3, backoff = 1000) {
        for (let i = 0; i <= retries; i++) {
            try {
                const response = await fetch(url);
                // Retry on rate limits (503) or throttling (429)
                if (response.status === 503 || response.status === 429) {
                    throw new Error(`Server temporarily unavailable (${response.status})`);
                }
                return response;
            } catch (err) {
                // Catch network errors (e.g., connection reset) and the manual 503/429 errors thrown above
                if (i === retries) throw err;
                console.warn(`[ElephantTags] Fetch failed (${url}), retrying in ${backoff}ms... (Attempt ${i + 1}/${retries})`, err);
                await new Promise(r => setTimeout(r, backoff));
                backoff *= 2;
            }
        }
    }

    /**
     * Fetches releases for a release group using JSON API.
     * @param {string} rgId
     * @returns {Promise<Array<{id: string, title: string}>>}
     */
    async function fetchReleases(rgId) {
        const url = `${location.origin}/ws/2/release-group/${rgId}?inc=releases&fmt=json`;
        try {
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();
            return data.releases.map(r => ({ id: r.id, title: r.title }));
        } catch (err) {
            console.error(`[ElephantTags] Failed to fetch releases for RG ${rgId}:`, err);
            return [];
        }
    }

    /**
     * Fetches recordings for a release using JSON API.
     * @param {string} releaseId
     * @returns {Promise<Array<{id: string, title: string}>>}
     */
    async function fetchRecordings(releaseId) {
        const url = `${location.origin}/ws/2/release/${releaseId}?inc=recordings&fmt=json`;
        try {
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();

            const recordings = [];
            if (data.media && Array.isArray(data.media)) {
                data.media.forEach(medium => {
                    if (medium.tracks && Array.isArray(medium.tracks)) {
                        medium.tracks.forEach(track => {
                            if (track.recording) {
                                recordings.push({
                                    id: track.recording.id,
                                    title: track.recording.title
                                });
                            }
                        });
                    }
                });
            }
            return recordings;
        } catch (err) {
            console.error(`[ElephantTags] Failed to fetch recordings for Release ${releaseId}:`, err);
            return [];
        }
    }

    async function tagCheckedReleaseGroups(tagInput, actionType, isToggledRGsParam, isToggledReleasesParam, isToggledRecordingsParam) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isClear = actionType === 'withdraw' || action === 'withdraw';

        // Split tags by comma
        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        // Select checked release groups
        // Select checked release groups
        const allChecked = Array.from(document.querySelectorAll(MERGE_CHECKBOX_SELECTOR + ':checked'));
        // Filter for visibility
        const checkedRGs = allChecked.filter(cb => cb.offsetParent !== null);

        console.log(`[ElephantTags] Debug: Found ${allChecked.length} checked boxes. Visible: ${checkedRGs.length}`);

        const totalRGs = checkedRGs.length;
        if (totalRGs === 0) {
            console.warn("[ElephantTags] No visible release groups checked. Selector used:", MERGE_CHECKBOX_SELECTOR);
            updateProgress('No entities selected.');
            return;
        }

        let accumulatedEntities = [];
        const uniqueRecordingIds = new Set();

        // --- PHASE 1: GATHER ---
        for (let i = 0; i < totalRGs; i++) {
            const checkbox = checkedRGs[i];
            const row = checkbox.closest('tr');
            const titleCell = row.querySelectorAll('td')[2];
            const rgLink = titleCell.querySelector('a[href*="/release-group/"]');
            const match = rgLink?.getAttribute('href').match(/\/release-group\/([0-9a-f-]+)/i);

            if (!match) continue;
            const releaseGroupId = match[1];
            const rgTitle = rgLink.textContent.trim();

            updateProgress(`Gathering data for RG ${i + 1}/${totalRGs}: ${rgTitle}...`);

            // 1. Add Release Group (if toggled)
            if (isToggledRGsParam) {
                accumulatedEntities.push({ id: releaseGroupId, type: 'release-group', title: rgTitle });
            }

            // 2. Cascade to Releases (if toggled or needed for recordings)
            if (isToggledReleasesParam || isToggledRecordingsParam) {
                const releases = await fetchReleases(releaseGroupId);
                await delay(1000); // Rate limit compliance

                for (const release of releases) {
                    // Add Release (if toggled)
                    if (isToggledReleasesParam) {
                        accumulatedEntities.push({ id: release.id, type: 'release', title: release.title });
                    }

                    // 3. Cascade to Recordings (if toggled)
                    if (isToggledRecordingsParam) {
                        const recordings = await fetchRecordings(release.id);
                        await delay(1000); // Rate limit compliance
                        recordings.forEach(rec => {
                            if (!uniqueRecordingIds.has(rec.id)) {
                                uniqueRecordingIds.add(rec.id);
                                accumulatedEntities.push({ id: rec.id, type: 'recording', title: rec.title });
                            }
                        });
                    }
                }
            }
        }

        // --- PHASE 2: SUBMIT ---
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} entities...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // --- UI UPDATES ---
        if (success) {
            // Uncheck processed RGs
            checkedRGs.forEach(cb => cb.checked = false);

            // Add visual feedback
            checkedRGs.forEach(cb => {
                const link = cb.closest('tr').querySelectorAll('td')[2].querySelector('a');
                showTagStatus(link, tags.join(', '), true, false, isClear);
            });

            const counts = { 'release-group': 0, 'release': 0, 'recording': 0 };
            accumulatedEntities.forEach(e => counts[e.type]++);

            const summary = Object.entries(counts)
                .filter(([, count]) => count > 0)
                .map(([type, count]) => `${type}: ${count}`)
                .join(', ');

            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
            console.log(`[ElephantTags] Batch Success: ${summary}`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }
    async function tagCheckedReleases(tagInput, actionType, isToggledReleasesParam, isToggledRecordingsParam) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isClear = actionType === 'withdraw' || action === 'withdraw';

        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        const checkedReleases = Array.from(document.querySelectorAll('table.tbl:not(.medium) ' + MERGE_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null);
        const totalReleases = checkedReleases.length;

        if (totalReleases === 0) { console.log("No visible releases checked for action."); updateProgress(''); return; }

        let accumulatedEntities = [];
        const uniqueRecordingIds = new Set();

        // --- PHASE 1: GATHER ---
        for (let i = 0; i < totalReleases; i++) {
            const checkbox = checkedReleases[i];
            const row = checkbox.closest('tr');
            const titleCell = row.querySelector('td:nth-child(2)');
            const rlLink = titleCell.querySelector('a[href*="/release/"]');
            const match = rlLink?.getAttribute('href').match(/\/release\/([0-9a-f-]+)/i);

            if (!match) continue;
            const releaseId = match[1];
            const releaseTitle = rlLink.textContent.trim();

            updateProgress(`Gathering data for Release ${i + 1}/${totalReleases}: ${releaseTitle}...`);

            // 1. Add Release (if toggled)
            if (isToggledReleasesParam) {
                accumulatedEntities.push({ id: releaseId, type: 'release', title: releaseTitle });
            }

            // 2. Cascade to Recordings (if toggled)
            if (isToggledRecordingsParam) {
                const recordings = await fetchRecordings(releaseId);
                await delay(1000); // Rate limit compliance
                recordings.forEach(rec => {
                    if (!uniqueRecordingIds.has(rec.id)) {
                        uniqueRecordingIds.add(rec.id);
                        accumulatedEntities.push({ id: rec.id, type: 'recording', title: rec.title });
                    }
                });
            }
        }

        // --- PHASE 2: SUBMIT ---
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} entities...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // --- UI UPDATES ---
        if (success) {
            checkedReleases.forEach(cb => cb.checked = false);
            checkedReleases.forEach(cb => {
                const link = cb.closest('tr').querySelector('td:nth-child(2) a');
                showTagStatus(link, tags.join(', '), true, false, isClear);
            });

            const counts = { 'release': 0, 'recording': 0 };
            accumulatedEntities.forEach(e => counts[e.type]++);

            const summary = Object.entries(counts)
                .filter(([, count]) => count > 0)
                .map(([type, count]) => `${type}: ${count}`)
                .join(', ');

            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }

    async function tagCheckedRecordings(tagInput, actionType) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isClear = actionType === 'withdraw' || action === 'withdraw';

        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        const checkedRecordings = Array.from(document.querySelectorAll('table.tbl.medium ' + RECORDING_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null);
        const totalRecordings = checkedRecordings.length;

        if (totalRecordings === 0) { console.log("No visible recordings checked for action."); updateProgress(''); return; }

        let accumulatedEntities = [];

        // --- PHASE 1: GATHER ---
        for (let i = 0; i < totalRecordings; i++) {
            const checkbox = checkedRecordings[i];
            const row = checkbox.closest('tr');
            const recordingLink = row.querySelector('td.title a[href*="/recording/"]');

            if (!recordingLink) continue;
            const match = recordingLink.getAttribute('href').match(/\/recording\/([0-9a-f-]+)/i);
            if (!match) continue;
            const recordingId = match[1];
            const recordingTitle = recordingLink.textContent.trim();

            updateProgress(`Gathering data for Recording ${i + 1}/${totalRecordings}: ${recordingTitle}...`);
            accumulatedEntities.push({ id: recordingId, type: 'recording', title: recordingTitle });
        }

        // --- PHASE 2: SUBMIT ---
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} recordings...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // --- UI UPDATES ---
        if (success) {
            checkedRecordings.forEach(cb => cb.checked = false);
            checkedRecordings.forEach(cb => {
                const link = cb.closest('tr').querySelector('td.title a');
                // Remove existing status icons to prevent pile-up
                link.closest('.title').querySelectorAll('.rec-tag-status').forEach(el => el.remove());
                showTagStatus(link, tags.join(', '), true, false, isClear);
            });

            const summary = `Recording: ${accumulatedEntities.length}`;
            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
            console.log(`[ElephantTags] Batch Success: ${summary}`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }

    async function tagCheckedReleasesDirect(tagInput, actionType, isToggledReleasesParam, isToggledRecordingsParam) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isClear = actionType === 'withdraw' || action === 'withdraw';

        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        // Artist Releases page uses standard .tbl but not always .release-group-list
        const checkedReleases = Array.from(document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked')).filter(cb => cb.offsetParent !== null);
        const totalReleases = checkedReleases.length;

        if (totalReleases === 0) { console.log("No visible releases checked for action."); updateProgress(''); return; }

        let accumulatedEntities = [];
        const uniqueRecordingIds = new Set();

        // --- PHASE 1: GATHER ---
        for (let i = 0; i < totalReleases; i++) {
            const checkbox = checkedReleases[i];
            const row = checkbox.closest('tr');
            // Try to find release link in the row
            const rlLink = row.querySelector('a[href*="/release/"]'); // More robust selector
            const match = rlLink?.getAttribute('href').match(/\/release\/([0-9a-f-]+)/i);

            if (!match) continue;
            const releaseId = match[1];
            const releaseTitle = rlLink.textContent.trim();

            updateProgress(`Gathering data for Release ${i + 1}/${totalReleases}: ${releaseTitle}...`);

            // 1. Add Release (if toggled)
            if (isToggledReleasesParam) {
                accumulatedEntities.push({ id: releaseId, type: 'release', title: releaseTitle });
            }

            // 2. Cascade to Recordings (if toggled)
            if (isToggledRecordingsParam) {
                const recordings = await fetchRecordings(releaseId);
                await delay(1000); // Rate limit compliance
                recordings.forEach(rec => {
                    if (!uniqueRecordingIds.has(rec.id)) {
                        uniqueRecordingIds.add(rec.id);
                        accumulatedEntities.push({ id: rec.id, type: 'recording', title: rec.title });
                    }
                });
            }
        }

        // --- PHASE 2: SUBMIT ---
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} entities...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // --- UI UPDATES ---
        if (success) {
            checkedReleases.forEach(cb => cb.checked = false);
            checkedReleases.forEach(cb => {
                // Find the link again to show status
                const link = cb.closest('tr').querySelector('a[href*="/release/"]');
                if (link) showTagStatus(link, tags.join(', '), true, false, isClear);
            });

            const counts = { 'release': 0, 'recording': 0 };
            accumulatedEntities.forEach(e => counts[e.type]++);

            const summary = Object.entries(counts)
                .filter(([, count]) => count > 0)
                .map(([type, count]) => `${type}: ${count}`)
                .join(', ');

            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }

    async function tagCheckedArtistRecordings(tagInput, actionType) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isClear = actionType === 'withdraw' || action === 'withdraw';

        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        // Artist Recordings page uses standard unchecked table
        const checkedRecordings = Array.from(document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked')).filter(cb => cb.offsetParent !== null);
        const totalRecordings = checkedRecordings.length;

        if (totalRecordings === 0) { console.log("No visible recordings checked for action."); updateProgress(''); return; }

        let accumulatedEntities = [];

        // --- PHASE 1: GATHER ---
        for (let i = 0; i < totalRecordings; i++) {
            const checkbox = checkedRecordings[i];
            const row = checkbox.closest('tr');
            // Try to find recording link in the row
            const recLink = row.querySelector('a[href*="/recording/"]');
            const match = recLink?.getAttribute('href').match(/\/recording\/([0-9a-f-]+)/i);

            if (!match) continue;
            const recordingId = match[1];
            const recordingTitle = recLink.textContent.trim();

            updateProgress(`Gathering data for Recording ${i + 1}/${totalRecordings}: ${recordingTitle}...`);
            accumulatedEntities.push({ id: recordingId, type: 'recording', title: recordingTitle });
        }

        // --- PHASE 2: SUBMIT ---
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} recordings...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // --- UI UPDATES ---
        if (success) {
            checkedRecordings.forEach(cb => cb.checked = false);
            checkedRecordings.forEach(cb => {
                const link = cb.closest('tr').querySelector('a[href*="/recording/"]');
                if (link) showTagStatus(link, tags.join(', '), true, false, isClear);
            });

            const summary = `Recording: ${accumulatedEntities.length}`;
            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
            console.log(`[ElephantTags] Batch Success: ${summary}`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }




    // --- UI Helper for Individual Status ---
    function showTagStatus(element, text, success, isError, isClear) {
        if (!element) return;
        const existing = element.parentNode.querySelector('.rec-tag-status');
        if (existing) existing.remove();

        const span = document.createElement('span');
        span.classList.add('nuclear-status', 'rec-tag-status');

        if (isError) {
            span.style.color = 'red';
            span.textContent = '❌ ' + text;
        } else if (isClear) {
            span.style.color = '#777';
            span.textContent = '🗑 ' + text;
        } else if (success) {
            span.style.color = 'green';
            span.textContent = '✔ ' + text;
        } else {
            span.textContent = text;
        }

        element.parentNode.appendChild(span);
    }

    // --- Recording Checkbox Injection ---
    function addRecordingCheckboxes(isToggled) {
        const tracklistTables = document.querySelectorAll('table.tbl.medium');

        tracklistTables.forEach(table => {
            let headRow = table.querySelector('thead tr.subh') || table.querySelector('tbody tr.subh');

            if (!headRow || headRow.querySelector('th.elephant-tag-col')) return;

            const newHeader = document.createElement('th');
            newHeader.classList.add('elephant-tag-col');
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

        const form = document.getElementById('tag-form');
        if (!form) return;

        // --- Infinite Loop Prevention: WeakSet & DOM Check ---
        // If we've processed this form instance AND the UI is still there, stop.
        if (injectedForms.has(form) && form.querySelector('.elephant-tags-wrapper')) {
            return;
        }

        // If the wrapper exists (even if not in WeakSet), add to set and stop.
        if (form.querySelector('.elephant-tags-wrapper')) {
            injectedForms.add(form);
            return;
        }

        injectedForms.add(form);

        const input = form.querySelector('input.tag-input');
        const submitButton = form.querySelector('button.styled-button');

        if (!input || !submitButton) return;

        console.log('%c[ElephantTags] addTaggingUI: Injecting Custom UI...', 'color: green; font-weight: bold;');


        const pathname = location.pathname;
        let pageContext = null;
        let masterToggleText = null;
        let entityId = null;

        const entityMatch = pathname.match(/\/(artist|release-group|release|label|work|area|event|recording|series)\/([0-9a-f-]+)/i);

        if (entityMatch) {
            entityId = entityMatch[2];
            if (entityMatch[1] === 'artist') {
                if (pathname.includes('/releases')) {
                    pageContext = 'artist_releases';
                    masterToggleText = 'Tag selected releases';
                } else if (pathname.includes('/recordings')) {
                    pageContext = 'artist_recordings';
                    masterToggleText = 'Tag selected recordings';
                } else if (document.querySelector('table.release-group-list ' + MERGE_CHECKBOX_SELECTOR)) {
                    pageContext = 'artist';
                    masterToggleText = 'Tag selected release groups';
                }
            } else if (entityMatch[1] === 'label' && document.querySelector('table.tbl input[name="add-to-merge"]')) {
                pageContext = 'label';
                masterToggleText = 'Tag selected releases';
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

        // 2. Add the Tag Shortcut Buttons container
        const shortcutContainer = document.createElement('div');
        shortcutContainer.className = 'tag-shortcuts';
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
            bulkWrapper.className = 'nuclear-bulk-wrapper';

            // --- Collapse Button ---
            const collapseButton = document.createElement('button');
            collapseButton.className = 'nuclear-collapse-btn';
            collapseButton.textContent = `Nuclear Options (Bulk Actions) ${isBulkExpanded ? '▲' : '▼'}`;

            // --- Toggle Container (Holds the checkboxes) ---
            const toggleContainer = document.createElement('div');
            toggleContainer.className = 'nuclear-toggle-container bulk-toggle-chain';
            toggleContainer.style.display = isBulkExpanded ? 'block' : 'none';

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
                span.className = 'nuclear-toggle-row';
                span.style.marginLeft = margin;

                const checkbox = document.createElement('input');
                checkbox.setAttribute('type', 'checkbox');
                checkbox.id = id;
                checkbox.classList.add('toggle-rg-checkbox');

                const label = document.createElement('label');
                label.className = 'nuclear-label';
                label.setAttribute('for', id);
                label.textContent = text;

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

            if (pageContext === 'artist_releases' || pageContext === 'label') {
                // For Artist Releases page AND Label page: Master is Releases. Child is Recordings.
                recordingToggle = createCheckboxToggle('mb-recordings-toggle', '↳ recordings', '20px');
                recordingToggle.checkbox.checked = isToggledRecordings;
                toggleContainer.appendChild(recordingToggle.span);
            }

            if (pageContext !== 'release' && pageContext !== 'artist_releases' && pageContext !== 'artist_recordings' && pageContext !== 'label') {
                recordingToggle = createCheckboxToggle('mb-recordings-toggle', '↳ recordings', pageContext === 'artist' ? '40px' : '20px');
                recordingToggle.checkbox.checked = isToggledRecordings;
                toggleContainer.appendChild(recordingToggle.span);
            }

            // --- Clear Action Toggle (The single switch) ---
            const clearToggleWrapper = document.createElement('div');
            clearToggleWrapper.className = 'nuclear-clear-wrapper';
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
                    } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                        isToggledReleases = masterToggle.checkbox.checked;
                    } else if (pageContext === 'release' || pageContext === 'artist_recordings') {
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

            // updateCheckboxState(); // DISABLED: Prevents clobbering user's manual selections on init

            bulkWrapper.appendChild(toggleContainer);

            // --- Progress Display ---
            progressDisplay = document.createElement('div');
            progressDisplay.className = 'nuclear-progress tag-progress-reporter';
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
                        (pageContext === 'release-group' || pageContext === 'artist_releases' || pageContext === 'label') && document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked').length > 0
                    ) || (
                        (pageContext === 'release' || pageContext === 'artist_recordings') && document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked, table.tbl ' + RECORDING_CHECKBOX_SELECTOR + ':checked').length > 0
                    );

                const isBulkAction = isMasterToggled || hasManualSelection;

                // Always save the tag/render buttons before any action
                saveAndRenderOnSubmission(currentForm, tagText, currentInput, submitButton);

                // Map page context to API entity type
                // Ensure we support all types we might encounter
                const rawType = entityMatch ? entityMatch[1] : null;
                const apiEntityType = (['artist', 'release-group', 'release', 'recording', 'label', 'work', 'area', 'event', 'series'].includes(rawType))
                    ? rawType
                    : 'release'; // Fallback (though risky if wrong)

                // --- READ CASCADE TOGGLE STATE DIRECTLY FROM DOM FOR RELIABILITY ---
                const domMaster = document.getElementById('mb-master-toggle');
                const domRelease = document.getElementById('mb-releases-toggle');
                const domRec = document.getElementById('mb-recordings-toggle');

                const masterChecked = domMaster ? domMaster.checked : false;

                let isToggledRGsNow = false;
                let isToggledReleasesNow = false;
                let isToggledRecordingsNow = false;

                if (pageContext === 'artist') {
                    isToggledRGsNow = masterChecked;
                    isToggledReleasesNow = domRelease ? domRelease.checked : false;
                    isToggledRecordingsNow = domRec ? domRec.checked : false;
                } else if (pageContext === 'release_group') {
                    isToggledReleasesNow = masterChecked;
                    isToggledRecordingsNow = domRec ? domRec.checked : false;
                } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                    isToggledReleasesNow = masterChecked;
                    isToggledRecordingsNow = domRec ? domRec.checked : false;
                } else if (pageContext === 'release' || pageContext === 'artist_recordings') {
                    isToggledRecordingsNow = masterChecked;
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
                        } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                            // PASS: Releases Toggle (Master), Recordings Toggle
                            await tagCheckedReleasesDirect(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                        } else if (pageContext === 'artist_recordings') {
                            await tagCheckedArtistRecordings(tagText, actionType);
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
                        // NEW: Use submitTagsBatch logic
                        const tags = tagText.split(',').map(t => t.trim()).filter(t => t);
                        await submitTagsBatch([{ id: entityId, type: apiEntityType }], tags, 'withdraw');

                        // Immediately mark as stale and update label
                        markClearToggleAsStale(true);

                        updateProgress(`Current entity action complete. Starting bulk cascade...`);

                        // Bulk Clear: start the cascade immediately.
                        setTimeout(async () => {
                            // --- RUN CHILD BULK ACTION (Clear) ---
                            if (pageContext === 'artist') {
                                await tagCheckedReleaseGroups(tagText, actionType, isToggledRGsNow, isToggledReleasesNow, isToggledRecordingsNow);
                            } else if (pageContext === 'release_group') {
                                await tagCheckedReleases(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                            } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                                await tagCheckedReleasesDirect(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                            } else if (pageContext === 'artist_recordings') {
                                await tagCheckedArtistRecordings(tagText, actionType);
                            } else if (pageContext === 'release') {
                                await tagCheckedRecordings(tagText, actionType);
                            }

                            // --- UI CLEANUP ---
                            updateProgress(`Bulk Action Complete. Refresh required to view changes.`);
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
        // Temporarily disconnect observer to prevent infinite self-triggering loop
        if (mainObserver) mainObserver.disconnect();

        form.appendChild(unifiedWrapper);

        if (mainObserver) mainObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ----------------------------------------------------------------------
    // Mutation Observer Setup
    // ----------------------------------------------------------------------

    function setupFormContentObserver(form) {
        if (formContentObserver) {
            formContentObserver.disconnect();
        }

        formContentObserver = new MutationObserver(function () {
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

    // ----------------------------------------------------------------------
    // Main Script Initialization (Aggrsssive Observer)
    // ----------------------------------------------------------------------

    function initObserver() {
        // Run immediately to catch if already loaded
        addTaggingUI();

        // Continuous observation to handle dynamic content loads (e.g. React/htmx updates)
        mainObserver = new MutationObserver(() => {
            addTaggingUI();
        });
        mainObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState !== 'loading') {
        initObserver();
    } else {
        window.addEventListener('DOMContentLoaded', initObserver);
    }
})();
