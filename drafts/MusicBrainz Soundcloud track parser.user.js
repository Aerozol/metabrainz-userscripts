// ==UserScript==
// @name         MusicBrainz Soundcloud track parser
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Copies tracklists and times from Soundcloud, for the MusicBrainz track parser. Needs to play each track to grab the duration from the bottom player bar.
// @version      1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/drafts/MusicBrainz%20Soundcloud%20track%20parser.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/drafts/MusicBrainz%20Soundcloud%20track%20parser.user.js
// @license      MIT
// @author       Google Gemini
// @match        https://soundcloud.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    async function copyTracklist(btn) {
        // 1. Select all track rows
        const trackRows = document.querySelectorAll('.trackList__item, .trackItem');
        let finalTracks = [];
        let seenTitles = new Set();

        const originalText = btn.innerText;
        btn.innerText = "Scanning Player...";
        btn.disabled = true;

        for (let i = 0; i < trackRows.length; i++) {
            const row = trackRows[i];

            // Get Title
            const titleEl = row.querySelector('.trackItem__trackTitle, .trackItem__title, .sc-link-primary');
            const playBtn = row.querySelector('.sc-button-play');

            if (!titleEl || !playBtn) continue;

            const title = titleEl.textContent.trim();

            // Skip if we've already processed this title (prevents doubling)
            if (seenTitles.has(title)) continue;
            seenTitles.add(title);

            // Scroll and Play
            row.scrollIntoView({ behavior: 'instant', block: 'center' });
            playBtn.click();

            // 2. Wait for the player at the bottom to update
            // We wait 1.2 seconds to ensure the "Total Time" metadata loads
            await new Promise(resolve => setTimeout(resolve, 1200));

            // 3. Grab duration from the GLOBAL PLAYER (bottom of screen)
            // This is the most reliable way to get the duration displayed on the site
            const globalDurationEl = document.querySelector('.playbackTimeline__duration span:nth-child(2)');
            let duration = "";

            if (globalDurationEl) {
                duration = globalDurationEl.textContent.trim();
            } else {
                // Fallback to row if player fails
                const rowDuration = row.querySelector('.trackItem__duration span[aria-label^="Time"]');
                duration = rowDuration ? rowDuration.getAttribute('aria-label').replace('Time: ', '') : "";
            }

            finalTracks.push(`${title} (${duration})`);
        }

        // Stop music
        const stopBtn = document.querySelector('.playControl.playing');
        if (stopBtn) stopBtn.click();

        const output = finalTracks.join('\n');
        navigator.clipboard.writeText(output).then(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            alert(`SCAN COMPLETE\n\n${finalTracks.length} unique tracks copied with times.`);
        });
    }

    function injectButtons() {
        const groups = document.querySelectorAll('.sc-button-toolbar .sc-button-group:not(.mb-global-fix)');
        groups.forEach(group => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sc-button sc-button-medium sc-button-responsive sc-button-border';
            btn.innerText = 'Copy Tracklist (Player Scan)';
            btn.style.marginLeft = '5px';
            btn.style.borderColor = '#ff5500';
            btn.style.color = '#ff5500';

            btn.onclick = (e) => {
                e.preventDefault();
                copyTracklist(btn);
            };

            group.appendChild(btn);
            group.classList.add('mb-global-fix');
        });
    }

    const observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
    injectButtons();
})();
