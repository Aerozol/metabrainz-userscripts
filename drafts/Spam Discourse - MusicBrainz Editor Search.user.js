// ==UserScript==
// @name         MusicBrainz Discourse User <-> MusicBrainz Editor
// @namespace    https://community.metabrainz.org/
// @version      1.01
// @description  Adds cross-links between Discourse usernames and MusicBrainz editor pages
// @author       You
// @match        https://community.metabrainz.org/*
// @match        https://beta.musicbrainz.org/user/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

// --- Discourse Logic ---
function addDiscourseButtons() {

    const userLinks = document.querySelectorAll('.reviewable-user-info .username a, .names .username a');

    userLinks.forEach(userLink => {
        // Fallback: Check data-user-card first, then textContent
        const username = userLink.dataset.userCard?.trim() || userLink.textContent.trim();
        if (!username || username === "") return;

        let btn = userLink.parentNode.querySelector('.mb-search-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.textContent = 'MB';
            btn.className = 'mb-search-btn';
            btn.style.marginLeft = '5px';
            btn.style.padding = '2px 5px';
            btn.style.fontSize = '0.8em';
            btn.style.cursor = 'pointer';
            userLink.parentNode.appendChild(btn);
        }

        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const url = `https://beta.musicbrainz.org/search?query=${encodeURIComponent(username)}&type=editor&method=indexed`;
            window.open(url, '_blank');
        };
    });
}

    // --- On MusicBrainz Editor pages ---
    function addMBButton() {
        const usernameEl = document.querySelector('a[href^="/user/"] bdi');
        const buttonsDiv = document.querySelector('.buttons.clear-both');
        if (!usernameEl || !buttonsDiv) return;

        const username = usernameEl.textContent.trim();
        if (!username) return;

        if (!buttonsDiv.querySelector('.disc-search-btn')) {
            const btn = document.createElement('a');
            btn.textContent = 'Search on Discourse';
            btn.className = 'styled-button disc-search-btn';
            btn.style.marginLeft = '5px';
            btn.target = '_blank';
            btn.href = `https://community.metabrainz.org/search?q=${encodeURIComponent(username)}&search_type=users`;
            buttonsDiv.appendChild(btn);
        }
    }

    if (location.hostname.includes('community.metabrainz.org')) {
        addDiscourseButtons();

        // Watch for SPA navigation / dynamic content
        const observer = new MutationObserver(() => {
            addDiscourseButtons();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Watch for URL changes (Discourse SPA routing)
        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                addDiscourseButtons();
            }
        }, 1000);

    } else if (location.hostname.includes('musicbrainz.org')) {
        addMBButton();
    }
})();