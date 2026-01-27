// ==UserScript==
// @name         Facebook Home Feed Hider
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Hides the middle column (feed) only on the Facebook home page.
// @author       You
// @match        https://www.facebook.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to check if we are on the home page
    function isHomePage() {
        // Returns true if the path is "/" or "/home.php"
        return window.location.pathname === '/' || window.location.pathname === '/home.php';
    }

    function toggleFeed() {
        // Target the main landmark identified in your screenshot
        const mainColumn = document.querySelector('div[role="main"]');

        if (mainColumn) {
            if (isHomePage()) {
                mainColumn.style.display = 'none';
            } else {
                // Restore it if we are on a profile or page
                mainColumn.style.display = '';
            }
        }
    }

    // Run when the page first loads
    toggleFeed();

    // Facebook is a Single Page App (SPA). We need to watch for URL changes
    // using a MutationObserver to catch navigation updates.
    const observer = new MutationObserver(() => {
        toggleFeed();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();