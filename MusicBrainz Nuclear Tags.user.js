// ==UserScript==
// @name MusicBrainz Nuclear Tags
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Quick buttons to submit and remember tag strings (ctrl+click to forget them). Submit and withdraw tags from selected sub-entities (artist > release group > release > recordings).
// @version      1.10-beta
// @downloadURL  https://github.com/chaban-mb/aerozol-metabrainz-userscripts/raw/Nuclear-Tags/refactor/MusicBrainz%20Nuclear%20Tags.user.js
// @updateURL  https://github.com/chaban-mb/aerozol-metabrainz-userscripts/raw/Nuclear-Tags/refactor/MusicBrainz%20Nuclear%20Tags.user.js
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
        .nuclear-withdraw-wrapper {
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
    let isBulkRunning = false;

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

    const rgReleaseCache = new Map();
    const releaseRecordingCache = new Map();
    const releaseRgMap = new Map();

    /**
     * Disables and restyles the 'Withdraw votes' toggle after an action is executed.
     */
    function markWithdrawToggleAsStale(isBulkAction = false) {
        const withdrawLabel = document.querySelector('label[for="mb-withdraw-action"]');
        const withdrawCheckbox = document.getElementById('mb-withdraw-action');

        if (withdrawLabel && withdrawCheckbox) {
            console.log('%c[ElephantTags] Mark toggle as stale: Updating visuals (skipped text change per user request).', 'color: #777;');
            // We DO NOT change the text anymore, so users don't get confused.
            // We DO NOT disable the checkbox anymore, allowing users to switch it and submit again (Undo).
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
    // Bulk Tagging/Withdrawing Functions
    // ----------------------------------------------------------------------

    // ----------------------------------------------------------------------
    // API Helpers (Official JSON & XML API)
    // ----------------------------------------------------------------------

    /**
     * Submits tags for multiple entities in chunks.
     * @param {Array<{id: string, type: string}>} entityList List of entities to tag.
     * @param {string[]} tags List of tags to apply (or remove).
     * @param {'upvote'|'downvote'|'withdraw'} action The vote action.
     * @returns {Promise<boolean>} True if ALL chunks were successful.
     */
    async function submitTagsBatch(entityList, tags, action) {
        if (!entityList.length || !tags.length) return false;

        const clientVersion = 'MusicBrainzNuclearTags-1.5';
        const url = `${location.origin}/ws/2/tag?client=${clientVersion}`;
        const CHUNK_SIZE = 200;

        // Chunk the entities
        const chunks = [];
        for (let i = 0; i < entityList.length; i += CHUNK_SIZE) {
            chunks.push(entityList.slice(i, i + CHUNK_SIZE));
        }

        console.log(`[ElephantTags] Batch Submission: Processing ${entityList.length} entities in ${chunks.length} chunks.`);
        let allSuccess = true;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            if (i > 0) {
                updateProgress(`Batch processing: Chunk ${i + 1}/${chunks.length} (waiting)...`);
                await delay(1100); // Rate limit between chunks
            }

            // Group entities by type
            const groups = {
                'artist': [],
                'release-group': [],
                'release': [],
                'recording': [],
                'label': []
            };

            chunk.forEach(e => {
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

            let chunkSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    updateProgress(`Batch processing: Chunk ${i + 1}/${chunks.length}${attempt > 1 ? ` (Attempt ${attempt})` : ''}...`);

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/xml; charset=utf-8'
                        },
                        body: xmlBody
                    });

                    const text = await response.text();

                    if (!response.ok) {
                        // If it's a 503 or 429 or 504, we definitely want to retry.
                        // Actually let's retry on any non-2xx for safety in this context,
                        // as we are doing chunks.
                        // But if it's 400 (Bad Request) maybe not?
                        // MusicBrainz 504 is common for heavy loads.
                        const isRetryable = response.status >= 500 || response.status === 429;

                        if (isRetryable && attempt < 3) {
                            console.warn(`[ElephantTags] Chunk ${i + 1} failed (Status ${response.status}). Retrying...`);
                            await delay(2000 * attempt); // Progressive backoff
                            continue;
                        }

                        console.error(`[ElephantTags] Chunk ${i + 1} failed permanently. Status: ${response.status} ${response.statusText}`, text);
                        chunkSuccess = false;
                        break; // Stop retrying this chunk
                    }

                    // Parse XML check
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(text, "text/xml");
                    const message = xmlDoc.querySelector("message text")?.textContent;

                    if (message === 'OK') {
                        console.log(`[ElephantTags] Chunk ${i + 1} successful.`);
                        chunkSuccess = true;
                        break; // Success!
                    } else {
                        console.warn(`[ElephantTags] Chunk ${i + 1} OK but unexpected response body:`, text);
                        chunkSuccess = true; // Still count as success?
                        break;
                    }

                } catch (err) {
                    console.error(`[ElephantTags] Chunk ${i + 1} network error (Attempt ${attempt}):`, err);
                    if (attempt < 3) {
                        await delay(2000 * attempt);
                    } else {
                        chunkSuccess = false;
                    }
                }
            }

            if (!chunkSuccess) {
                allSuccess = false;
                // keep going to try other chunks? Yes.
            }
        }

        return allSuccess;
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
        if (rgReleaseCache.has(rgId)) {
            console.log(`[ElephantTags] Helper: Returning cached releases for RG ${rgId}`);
            return { items: rgReleaseCache.get(rgId), isCached: true };
        }

        const url = `${location.origin}/ws/2/release-group/${rgId}?inc=releases&fmt=json`;
        try {
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();
            const releases = data.releases.map(r => ({ id: r.id, title: r.title }));

            rgReleaseCache.set(rgId, releases); // Cache result
            return { items: releases, isCached: false };
        } catch (err) {
            console.error(`[ElephantTags] Failed to fetch releases for RG ${rgId}:`, err);
            return { items: [], isCached: false };
        }
    }

    /**
     * Fetches recordings for a release using JSON API.
     * @param {string} releaseId
     * @returns {Promise<Array<{id: string, title: string}>>}
     */
    async function fetchRecordings(releaseId) {
        if (releaseRecordingCache.has(releaseId)) {
            console.log(`[ElephantTags] Helper: Returning cached recordings for Release ${releaseId}`);
            return { items: releaseRecordingCache.get(releaseId), isCached: true };
        }

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

            releaseRecordingCache.set(releaseId, recordings); // Cache result
            return { items: recordings, isCached: false };
        } catch (err) {
            console.error(`[ElephantTags] Failed to fetch recordings for Release ${releaseId}:`, err);
            return { items: [], isCached: false };
        }
    }

    /**
     * Unified fetcher for Release data (RG and/or Recordings).
     * @param {string} releaseId
     * @param {string[]} incParams Array of include parameters e.g. ['release-groups', 'recordings']
     * @returns {Promise<{releaseGroup: {id: string, title: string}|null, recordings: Array<{id: string, title: string}>, isCached: boolean}>}
     */
    async function fetchReleaseData(releaseId, incParams = []) {
        // Check individual caches to determine if we need to fetch
        // but since we are doing bulk ops, we mainly care about not hitting the same thing twice in one run.
        // For now, we will rely on individual caches for components or just fetch.
        // Actually, let's just do fresh fetch for simplified bulk logic or check individual caches?
        // Let's implement smart caching: check if we have what we need.

        const needsRG = incParams.includes('release-groups');
        const needsRecs = incParams.includes('recordings');

        let cachedRG = releaseRgMap.get(releaseId);
        let cachedRecs = releaseRecordingCache.get(releaseId);

        if ((!needsRG || cachedRG) && (!needsRecs || cachedRecs)) {
            console.log(`[ElephantTags] Helper: Returning fully cached data for Release ${releaseId}`);
            return {
                releaseGroup: needsRG ? cachedRG : null,
                recordings: needsRecs ? cachedRecs : [],
                isCached: true
            };
        }

        const incStr = incParams.join('+');
        const url = `${location.origin}/ws/2/release/${releaseId}?inc=${incStr}&fmt=json`;
        console.log(`[ElephantTags] Fetching Release Data: ${url}`);

        try {
            const response = await fetchWithRetry(url);
            if (!response.ok) throw new Error(response.statusText);
            const data = await response.json();

            let resultRG = null;
            let resultRecs = [];

            if (needsRG) {
                const rg = data['release-group'];
                if (rg) {
                    resultRG = { id: rg.id, title: rg.title };
                    releaseRgMap.set(releaseId, resultRG);
                }
            }

            if (needsRecs) {
                if (data.media && Array.isArray(data.media)) {
                    data.media.forEach(medium => {
                        if (medium.tracks && Array.isArray(medium.tracks)) {
                            medium.tracks.forEach(track => {
                                if (track.recording) {
                                    resultRecs.push({
                                        id: track.recording.id,
                                        title: track.recording.title
                                    });
                                }
                            });
                        }
                    });
                }
                releaseRecordingCache.set(releaseId, resultRecs);
            }

            return {
                releaseGroup: resultRG,
                recordings: resultRecs,
                isCached: false
            };

        } catch (err) {
            console.error(`[ElephantTags] Failed to fetch data for Release ${releaseId}:`, err);
            return { releaseGroup: null, recordings: [], isCached: false };
        }
    }

    /**
     * Fetches release group for a release using JSON API.
     * @param {string} releaseId
     * @returns {Promise<{item: {id: string, title: string}|null, isCached: boolean}>}
     */
    async function fetchReleaseGroup(releaseId) {
        // Legacy wrapper for single usage if needed, or redirect to unified
        const { releaseGroup, isCached } = await fetchReleaseData(releaseId, ['release-groups']);
        return { item: releaseGroup, isCached };
    }

    // ----------------------------------------------------------------------
    // Unified Bulk Orchestrator
    // ----------------------------------------------------------------------

    /**
     * Common logic for iterating checked rows, fetching children, and submitting tags.
     */
    async function orchestrateBulkTagging({
        label,
        tagInput,
        actionType,
        checkboxSelector, // String CSS selector for CHECKED checkboxes
        rootEntityType,   // 'release-group', 'release', 'recording'
        cascade           // { root: boolean, releases: boolean, recordings: boolean }
    }) {
        const action = (actionType === 'tag') ? 'upvote' : 'withdraw';
        const isWithdraw = actionType === 'withdraw' || action === 'withdraw';
        const tags = tagInput.split(',').map(t => t.trim()).filter(t => t);
        if (!tags.length) return;

        // 1. Scan DOM for checked roots
        const allChecked = Array.from(document.querySelectorAll(checkboxSelector));
        const visibleChecked = allChecked.filter(cb => cb.offsetParent !== null); // Visibility check

        if (visibleChecked.length === 0) {
            console.log(`[ElephantTags] No visible ${label} checked.`);
            updateProgress('');
            return;
        }

        let accumulatedEntities = [];
        const uniqueRecordingIds = new Set();
        const uniqueReleaseGroupIds = new Set();
        const total = visibleChecked.length;

        // 2. Process Roots & Cascade
        for (let i = 0; i < total; i++) {
            const checkbox = visibleChecked[i];
            const row = checkbox.closest('tr');

            // Generic link finder (works for 99% of MB tables)
            // For Releases, we might hit the /cover-art link first (which has the ID but no text).
            // So we prefer a link that is NOT cover art if possible.
            const allLinks = Array.from(row.querySelectorAll(`a[href*="/${rootEntityType}/"]`));
            let link = allLinks.find(a => !a.href.endsWith('/cover-art') && !a.closest('.release-group-list')); // Exclude different entity type if possible

            // Fallback: Just take the first one if we were too picky
            if (!link && allLinks.length > 0) link = allLinks[0];

            if (!link) continue;

            const match = link.getAttribute('href').match(new RegExp(`/${rootEntityType}/([0-9a-f-]+)`, 'i'));
            if (!match) continue;

            const rootId = match[1];
            const rootTitle = link.textContent.trim();

            updateProgress(`Gathering data for ${label} ${i + 1}/${total}: ${rootTitle}...`);

            // Add Root
            if (cascade.root) {
                accumulatedEntities.push({ id: rootId, type: rootEntityType, title: rootTitle });
            }

            // Cascade: RG -> Release
            // (Only relevant if root is release-group)
            if (rootEntityType === 'release-group' && (cascade.releases || cascade.recordings)) {
                const { items: releases, isCached: releasesCached } = await fetchReleases(rootId);
                if (!releasesCached) await delay(1000); // Rate limit

                for (const release of releases) {
                    if (cascade.releases) {
                        accumulatedEntities.push({ id: release.id, type: 'release', title: release.title });
                    }
                    if (cascade.recordings) {
                        const { items: recordings, isCached: recsCached } = await fetchRecordings(release.id);
                        if (!recsCached) await delay(1000); // Rate limit
                        recordings.forEach(rec => {
                            if (!uniqueRecordingIds.has(rec.id)) {
                                uniqueRecordingIds.add(rec.id);
                                accumulatedEntities.push({ id: rec.id, type: 'recording', title: rec.title });
                            }
                        });
                    }
                }
            }
            // Cascade: Release -> Recording
            // (Relevant if root is release)
            else if (rootEntityType === 'release') {

                const incParams = [];
                if (cascade.releaseGroups) incParams.push('release-groups');
                if (cascade.recordings) incParams.push('recordings');

                if (incParams.length > 0) {
                    const { releaseGroup: rg, recordings, isCached } = await fetchReleaseData(rootId, incParams);
                    if (!isCached) await delay(1000); // Rate limit

                    // 1. Cascade to Release Group
                    if (cascade.releaseGroups && rg && !uniqueReleaseGroupIds.has(rg.id)) {
                        uniqueReleaseGroupIds.add(rg.id);
                        accumulatedEntities.push({ id: rg.id, type: 'release-group', title: rg.title });
                    }

                    // 2. Cascade to Recordings
                    if (cascade.recordings && recordings.length > 0) {
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

        // 3. Submit
        if (accumulatedEntities.length === 0) {
            updateProgress('No entities gathered to tag.');
            return;
        }

        updateProgress(`Submitting tags for ${accumulatedEntities.length} entities...`);
        const success = await submitTagsBatch(accumulatedEntities, tags, action);

        // 4. UI Update
        if (success) {
            // visibleChecked.forEach(cb => cb.checked = false);
            visibleChecked.forEach(cb => {
                const row = cb.closest('tr');
                // Use generic link finder again for status icons
                const link = row.querySelector(`a[href*="/${rootEntityType}/"]`);
                if (link) showTagStatus(link, tags.join(', '), true, false, isWithdraw);
            });

            const counts = {};
            accumulatedEntities.forEach(e => counts[e.type] = (counts[e.type] || 0) + 1);
            const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');

            updateProgress(`Success! Tagged: ${summary}. Refresh to see changes.`);
            console.log(`[ElephantTags] Batch Success: ${summary}`);
        } else {
            updateProgress('Batch submission failed. Check console.');
        }
    }

    // --- Wrapper Functions (Old Signatures) ---

    async function tagCheckedReleaseGroups(tagInput, actionType, isToggledRGs, isToggledReleases, isToggledRecordings) {
        await orchestrateBulkTagging({
            label: 'RG',
            tagInput, actionType,
            checkboxSelector: `${MERGE_CHECKBOX_SELECTOR}:checked`, // Uses global MERGE_CHECKBOX_SELECTOR
            rootEntityType: 'release-group',
            cascade: { root: isToggledRGs, releases: isToggledReleases, recordings: isToggledRecordings }
        });
    }

    async function tagCheckedReleases(tagInput, actionType, isToggledReleases, isToggledRecordings) {
        await orchestrateBulkTagging({
            label: 'Release',
            tagInput, actionType,
            checkboxSelector: `table.tbl:not(.medium) ${MERGE_CHECKBOX_SELECTOR}:checked`,
            rootEntityType: 'release',
            cascade: { root: isToggledReleases, releases: false, recordings: isToggledRecordings }
        });
    }

    async function tagCheckedRecordings(tagInput, actionType) {
        await orchestrateBulkTagging({
            label: 'Recording',
            tagInput, actionType,
            checkboxSelector: `table.tbl.medium ${RECORDING_CHECKBOX_SELECTOR}:checked`,
            rootEntityType: 'recording',
            cascade: { root: true, releases: false, recordings: false }
        });
    }

    // For Artist/Label pages where releases are listed directly
    async function tagCheckedReleasesDirect(tagInput, actionType, isToggledReleases, isToggledRecordings, isToggledRGs) {
        await orchestrateBulkTagging({
            label: 'Release',
            tagInput, actionType,
            // Broad selector for any table using merge checkboxes
            checkboxSelector: `table.tbl input[name="add-to-merge"]:checked`,
            rootEntityType: 'release',
            cascade: { root: isToggledReleases, releases: false, recordings: isToggledRecordings, releaseGroups: isToggledRGs }
        });
    }

    // For Artist Recordings page
    async function tagCheckedArtistRecordings(tagInput, actionType) {
        await orchestrateBulkTagging({
            label: 'Recording',
            tagInput, actionType,
            // Artist recordings page key difference: uses merge checkboxes, not custom ones
            checkboxSelector: `table.tbl input[name="add-to-merge"]:checked`,
            rootEntityType: 'recording',
            cascade: { root: true, releases: false, recordings: false }
        });
    }




    // --- UI Helper for Individual Status ---
    function showTagStatus(element, text, success, isError, isWithdraw) {
        if (!element) return;
        const existing = element.parentNode.querySelector('.rec-tag-status');
        if (existing) existing.remove();

        const span = document.createElement('span');
        span.classList.add('nuclear-status', 'rec-tag-status');

        if (isError) {
            span.style.color = 'red';
            span.textContent = '❌ ' + text;
        } else if (isWithdraw) {
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

            // NEW: Add Release Group toggle for Label, Artist Releases, and Release pages
            if (pageContext === 'artist_releases' || pageContext === 'label') {
                // For Artist Releases page AND Label page: Master is Releases. Child is Recordings.
                recordingToggle = createCheckboxToggle('mb-recordings-toggle', '↳ recordings', '20px');
                recordingToggle.checkbox.checked = isToggledRecordings;
                toggleContainer.appendChild(recordingToggle.span);
            }

            // NEW: Add Release Group toggle for Label, Artist Releases, and Release pages
            let rgToggle = null;
            if (pageContext === 'artist_releases' || pageContext === 'label' || pageContext === 'release') {
                rgToggle = createCheckboxToggle('mb-rg-toggle', 'Release Group', '0px');
                // We reuse isToggledRGs for state persistence, though it might be shared with Artist page RG master toggle.
                // In this context, it's a child toggle.
                rgToggle.checkbox.checked = isToggledRGs;
                toggleContainer.appendChild(rgToggle.span);
            }

            if (pageContext !== 'release' && pageContext !== 'artist_releases' && pageContext !== 'artist_recordings' && pageContext !== 'label') {
                recordingToggle = createCheckboxToggle('mb-recordings-toggle', '↳ recordings', pageContext === 'artist' ? '40px' : '20px');
                recordingToggle.checkbox.checked = isToggledRecordings;
                toggleContainer.appendChild(recordingToggle.span);
            }

            // --- Withdraw Action Toggle (The single switch) ---
            const withdrawToggleWrapper = document.createElement('div');
            withdrawToggleWrapper.className = 'nuclear-withdraw-wrapper';
            const withdrawToggle = createCheckboxToggle('mb-withdraw-action', 'Withdraw votes', '0px');
            withdrawToggle.label.style.color = '#777';
            withdrawToggleWrapper.appendChild(withdrawToggle.span);
            toggleContainer.appendChild(withdrawToggleWrapper);


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
                if (rgToggle) {
                    // Only update global RG state if we have a specific toggle for it here
                    isToggledRGs = rgToggle.checkbox.checked;
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
                if (cb.id !== 'mb-withdraw-action') {
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

            // --- Submit Button Handler with FIX for Single Withdraw ---
            submitButton.addEventListener('click', async function (e) {
                if (isBulkRunning) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    console.warn('[ElephantTags] Bulk operation is currently running. Please wait.');
                    return;
                }

                // CRUCIAL: Re-fetch form and input inside the closure for the currently active elements
                const currentForm = document.getElementById('tag-form');
                const currentInput = currentForm ? currentForm.querySelector('input.tag-input') : null;
                const tagText = currentInput ? currentInput.value.trim() : '';

                if (!tagText) return;

                const withdrawActionCheckbox = document.getElementById('mb-withdraw-action');
                const actionType = withdrawActionCheckbox.checked ? 'withdraw' : 'tag';

                // --- READ TOGGLE STATE DIRECTLY FROM DOM FOR RELIABILITY ---
                const domMaster = document.getElementById('mb-master-toggle');
                const domRg = document.getElementById('mb-rg-toggle');
                const domRelease = document.getElementById('mb-releases-toggle');
                const domRec = document.getElementById('mb-recordings-toggle');

                const isAnyToggleChecked = (domMaster && domMaster.checked) ||
                    (domRg && domRg.checked) ||
                    (domRelease && domRelease.checked) ||
                    (domRec && domRec.checked);

                const hasManualSelection = (
                    pageContext === 'artist' && Array.from(document.querySelectorAll('table.release-group-list ' + MERGE_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null).length > 0
                ) || (
                        (pageContext === 'release-group' || pageContext === 'artist_releases' || pageContext === 'label') && Array.from(document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked')).filter(cb => cb.offsetParent !== null).length > 0
                    ) || (
                        (pageContext === 'release' || pageContext === 'artist_recordings') && Array.from(document.querySelectorAll('table.tbl input[name="add-to-merge"]:checked, table.tbl ' + RECORDING_CHECKBOX_SELECTOR + ':checked')).filter(cb => cb.offsetParent !== null).length > 0
                    );

                const isBulkAction = isAnyToggleChecked || hasManualSelection;

                if (isBulkAction) {
                    isBulkRunning = true;
                    submitButton.disabled = true;
                }

                // Always save the tag/render buttons before any action
                saveAndRenderOnSubmission(currentForm, tagText, currentInput, submitButton);

                // Map page context to API entity type
                // Ensure we support all types we might encounter
                const rawType = entityMatch ? entityMatch[1] : null;
                const apiEntityType = (['artist', 'release-group', 'release', 'recording', 'label', 'work', 'area', 'event', 'series'].includes(rawType))
                    ? rawType
                    : 'release'; // Fallback (though risky if wrong)



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
                    isToggledRGsNow = domRg ? domRg.checked : false; // New RG toggle
                    isToggledRecordingsNow = domRec ? domRec.checked : false;
                } else if (pageContext === 'release') {
                    isToggledRGsNow = domRg ? domRg.checked : false; // New RG toggle
                    isToggledRecordingsNow = masterChecked;
                } else if (pageContext === 'artist_recordings') {
                    isToggledRecordingsNow = masterChecked;
                }


                // 1. SCENARIO: TAG (Native Upvote Flow)
                if (actionType === 'tag') {
                    // If it's just a single tag, we do nothing and allow native flow to complete instantly.
                    if (!isBulkAction) {
                        // Action finished by native click. Disable withdraw toggle immediately.
                        markWithdrawToggleAsStale(false);
                        return;
                    }

                    // If it's a bulk tag, we let the native action tag the current entity,
                    // then start our cascade immediately (no delay).
                    console.log(`[ElephantTags] Bulk TAG: Allowing native upvote. Starting cascade immediately.`);

                    setTimeout(async () => {
                        try {
                            updateProgress(`Current entity action (native tag) complete. Starting bulk cascade...`);

                            // --- RUN CHILD BULK ACTION ---
                            if (pageContext === 'artist') {
                                // PASS: RG Toggle, Releases Toggle, Recordings Toggle
                                await tagCheckedReleaseGroups(tagText, actionType, isToggledRGsNow, isToggledReleasesNow, isToggledRecordingsNow);
                            } else if (pageContext === 'release_group') {
                                // PASS: Releases Toggle (isToggledReleasesNow is now correct), Recordings Toggle
                                await tagCheckedReleases(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                            } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                                // PASS: Releases Toggle (Master), Recordings Toggle, RG Toggle (New)
                                await tagCheckedReleasesDirect(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow, isToggledRGsNow);
                            } else if (pageContext === 'artist_recordings') {
                                await tagCheckedArtistRecordings(tagText, actionType);
                            } else if (pageContext === 'release') {

                                const incParams = [];
                                if (isToggledRGsNow && entityId) incParams.push('release-groups');
                                // Note: For the *current* release page, we might just be tagging recordings via checkboxes,
                                // but usually native flow handles the release.

                                // However, we still use fetchReleaseData for RG if needed.
                                if (incParams.length > 0) {
                                    updateProgress('Processing Release Group...');
                                    const { releaseGroup: rgData } = await fetchReleaseData(entityId, incParams);
                                    if (rgData) {
                                        const tags = tagText.split(',').map(t => t.trim()).filter(t => t);
                                        await submitTagsBatch([{ id: rgData.id, type: 'release-group' }], tags, actionType === 'tag' ? 'upvote' : 'withdraw');
                                    }
                                }

                                // 2. Tag Recordings if toggled
                                await tagCheckedRecordings(tagText, actionType);
                            }

                            // --- UI CLEANUP ---
                            updateProgress(`Bulk Action Complete. Refresh required to view changes.`);
                            setTimeout(() => { updateProgress(''); }, 3000);
                            markWithdrawToggleAsStale(true); // Disable after bulk
                        } finally {
                            isBulkRunning = false;
                            submitButton.disabled = false;
                        }
                    }, 100); // 100ms small delay to ensure native click fires first
                    return;
                }


                // 2. SCENARIO: WITHDRAW (Custom Downvote Flow) - INTERRUPT native UPVOTE
                e.preventDefault();

                // Clear the input field immediately
                currentInput.value = '';
                currentInput.dispatchEvent(new Event('input', { bubbles: true }));

                // --- Execute Withdraw Action ---
                if (apiEntityType && entityId) {

                    if (isBulkAction) {
                        // --- BULK WITHDRAW: Custom AJAX for Current Entity + Cascade ---
                        console.log(`[ElephantTags] BULK WITHDRAW: Intercepting native upvote and performing manual downvote for current entity and starting cascade.`);
                        updateProgress(`Withdrawing tag from current entity: ${tagText}...`);

                        // Use custom AJAX withdraw for current entity in the bulk path
                        // NEW: Use submitTagsBatch logic
                        const tags = tagText.split(',').map(t => t.trim()).filter(t => t);
                        await submitTagsBatch([{ id: entityId, type: apiEntityType }], tags, 'withdraw');

                        // Immediately mark as stale and update label
                        markWithdrawToggleAsStale(true);

                        updateProgress(`Current entity action complete. Starting bulk cascade...`);

                        // Bulk Withdraw: start the cascade immediately.
                        setTimeout(async () => {
                            try {
                                // --- RUN CHILD BULK ACTION (Withdraw) ---
                                if (pageContext === 'artist') {
                                    await tagCheckedReleaseGroups(tagText, actionType, isToggledRGsNow, isToggledReleasesNow, isToggledRecordingsNow);
                                } else if (pageContext === 'release_group') {
                                    await tagCheckedReleases(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow);
                                } else if (pageContext === 'artist_releases' || pageContext === 'label') {
                                    await tagCheckedReleasesDirect(tagText, actionType, isToggledReleasesNow, isToggledRecordingsNow, isToggledRGsNow);
                                } else if (pageContext === 'artist_recordings') {
                                    await tagCheckedArtistRecordings(tagText, actionType);
                                } else if (pageContext === 'release') {
                                    if (isToggledRGsNow && entityId) {
                                        updateProgress('Processing Release Group...');
                                        const { item: rgData } = await fetchReleaseGroup(entityId);
                                        if (rgData) {
                                            const tags = tagText.split(',').map(t => t.trim()).filter(t => t);
                                            await submitTagsBatch([{ id: rgData.id, type: 'release-group' }], tags, actionType === 'tag' ? 'upvote' : 'withdraw');
                                        }
                                    }
                                    await tagCheckedRecordings(tagText, actionType);
                                }

                                // --- UI CLEANUP ---
                                updateProgress(`Bulk Action Complete. Refresh required to view changes.`);
                                setTimeout(() => { updateProgress(''); }, 3000);
                            } finally {
                                isBulkRunning = false;
                                submitButton.disabled = false;
                            }

                        }, 100); // 100ms small delay to ensure native click is fully cancelled.

                    } else {
                        // --- SINGLE WITHDRAW: Using Text Match ---
                        console.log(`[ElephantTags] SINGLE WITHDRAW: Intercepting native upvote and performing native downvote click for instant UI update.`);
                        updateProgress(`Withdrawing tag from current entity: ${tagText}...`);

                        const tagsToWithdraw = tagText.split(',').map(t => t.trim()).filter(t => t);

                        tagsToWithdraw.forEach(t => {
                            let tagLink = null;

                            const sidebarLinks = document.querySelectorAll('#sidebar a');
                            for (const link of sidebarLinks) {
                                if (link.textContent.trim() === t) {
                                    tagLink = link;
                                    break;
                                }
                            }

                            if (tagLink) {
                                const downvoteButton = tagLink.closest('li')?.querySelector('.tag-downvote');

                                if (downvoteButton && !downvoteButton.disabled) {
                                    downvoteButton.click();
                                    console.log(`[ElephantTags] SINGLE WITHDRAW: Clicked native downvote for "${t}". SUCCESS.`);
                                } else {
                                    console.log(`[ElephantTags] SINGLE WITHDRAW: Tag "${t}" found but downvote button not present/enabled.`);
                                }
                            } else {
                                console.log(`[ElephantTags] SINGLE WITHDRAW: Tag "${t}" not found in sidebar list.`);
                            }
                        });

                        // Action complete, disable the toggle and clear the progress message
                        markWithdrawToggleAsStale(false);
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
