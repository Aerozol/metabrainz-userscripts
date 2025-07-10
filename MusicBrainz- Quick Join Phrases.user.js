// ==UserScript==
// @name         MusicBrainz: Quick Join Phrases
// @description  Click to add common join phrases (release editor)
// @version      2025-07-10.4
// @author       ChatGPT
// @match *://*.musicbrainz.org/release/add*
// @match *://*.musicbrainz.org/release/*/edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const phrases = [
        ' & ',
        ' feat. ',
        ' narrated by ',
        ' read by '
    ];

    function addFloatingButtonBox() {
        const allJoinInputs = Array.from(document.querySelectorAll('input[id*="join-phrase-"]'));
        if (allJoinInputs.length < 2) return;

        const targetInput = allJoinInputs[allJoinInputs.length - 2];
        const form = targetInput.closest('form');
        if (!form || form.querySelector('.join-phrase-single-button-container')) return;

        const container = document.createElement('div');
        container.className = 'join-phrase-single-button-container';
        container.style.position = 'absolute';
        container.style.top = '40px';
        container.style.right = '-160px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '6px';
        container.style.backgroundColor = '#f8f8f8';
        container.style.border = '1px solid #ccc';
        container.style.borderRadius = '4px';
        container.style.padding = '6px';
        container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        container.style.zIndex = '1000';
        container.style.fontSize = '11px';

        phrases.forEach(phrase => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = phrase.trim();
            btn.title = `Insert join phrase "${phrase.trim()}"`;
            btn.style.cssText = `
                font-size: 11px;
                padding: 4px 6px;
                cursor: pointer;
                background: #eee;
                border: 1px solid #bbb;
                border-radius: 3px;
            `;
            btn.addEventListener('click', () => {
                targetInput.focus();
                targetInput.select();
                document.execCommand('delete');
                document.execCommand('insertText', false, phrase);
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            });
            container.appendChild(btn);
        });

        // Ensure form is relatively positioned so the floating box works correctly
        if (getComputedStyle(form).position === 'static') {
            form.style.position = 'relative';
        }

        form.appendChild(container);
    }

    function observePopupChanges() {
        const observer = new MutationObserver(() => {
            addFloatingButtonBox();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('load', observePopupChanges);
})();
