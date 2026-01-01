// ==UserScript==
// @name         MusicBrainz Soundcloud track parser
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Copies tracklists and times from Soundcloud, for the MusicBrainz track parser. Needs to play each track to grab the duration from the bottom player bar.
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/drafts/MusicBrainz%20Soundcloud%20track%20parser.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/drafts/MusicBrainz%20Soundcloud%20track%20parser.user.js
// @license      MIT
// @author       Google Gemini
// @match        https://soundcloud.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function copyReleaseDate(btn) {
        const dateEl = document.querySelector('time.relativeTime');
        if (dateEl && dateEl.getAttribute('datetime')) {
            const date = dateEl.getAttribute('datetime').split('T')[0];
            navigator.clipboard.writeText(date).then(() => {
                const oldText = btn.innerText;
                btn.innerText = "Date Copied!";
                setTimeout(() => btn.innerText = oldText, 2000);
            });
        } else {
            alert("Could not find release date.");
        }
    }

    async function scanTracklist(btn) {
        const trackRows = document.querySelectorAll('.trackList__item, .trackItem');
        let finalTracks = [];
        let seenTitles = new Set();
        const originalText = btn.innerText;
        btn.innerText = "Scanning...";

        for (let i = 0; i < trackRows.length; i++) {
            const row = trackRows[i];
            const titleEl = row.querySelector('.trackItem__trackTitle, .trackItem__title, .sc-link-primary');
            const playBtn = row.querySelector('.sc-button-play');
            if (!titleEl || !playBtn) continue;

            const title = titleEl.textContent.trim();
            if (seenTitles.has(title)) continue;
            seenTitles.add(title);

            row.scrollIntoView({ behavior: 'instant', block: 'center' });
            playBtn.click();
            await new Promise(r => setTimeout(r, 1200));

            const globalDurationEl = document.querySelector('.playbackTimeline__duration span:nth-child(2)');
            const duration = globalDurationEl ? globalDurationEl.textContent.trim() : "0:00";
            finalTracks.push(`${title} (${duration})`);
        }

        const stopBtn = document.querySelector('.playControl.playing');
        if (stopBtn) stopBtn.click();

        navigator.clipboard.writeText(finalTracks.join('\n')).then(() => {
            btn.innerText = originalText;
            alert("Tracklist Copied!");
        });
    }

    function injectButtons() {
        const groups = document.querySelectorAll('.sc-button-toolbar .sc-button-group:not(.mb-final)');
        groups.forEach(group => {
            // Tracklist Button
            const trackBtn = document.createElement('button');
            trackBtn.className = 'sc-button sc-button-medium sc-button-border';
            trackBtn.innerText = 'Copy Tracklist';
            trackBtn.style.color = '#ff5500';
            trackBtn.onclick = () => scanTracklist(trackBtn);
            group.appendChild(trackBtn);

            // Date Button
            const dateBtn = document.createElement('button');
            dateBtn.className = 'sc-button sc-button-medium sc-button-border';
            dateBtn.innerText = 'Copy Date';
            dateBtn.style.marginLeft = '5px';
            dateBtn.onclick = () => copyReleaseDate(dateBtn);
            group.appendChild(dateBtn);

            group.classList.add('mb-final');
        });
    }

    const observer = new MutationObserver(() => injectButtons());
    observer.observe(document.body, { childList: true, subtree: true });
    injectButtons();
})();
