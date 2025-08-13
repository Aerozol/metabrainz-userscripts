// ==UserScript==
// @name         MusicBrainz Quick Join Phrases
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Click to add common join phrases (release editor)
// @version      1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Join%20Phrases.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Join%20Phrases.user.js
// @license      MIT
// @author       ChatGPT
// @match        *://*.musicbrainz.org/release/add*
// @match        *://*.musicbrainz.org/release/*/edit*
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

    function insertPhrase(input, phrase) {
        input.focus();
        input.select();
        document.execCommand('delete');
        document.execCommand('insertText', false, phrase);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clickDoneButton(form) {
        const doneBtn = form.querySelector('button.positive');
        if (doneBtn) {
            doneBtn.click();
        }
    }

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
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';

            // Join phrase button
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = phrase.trim();
            btn.title = `Insert join phrase "${phrase.trim()}"`;
            btn.style.cssText = `
                width: 80px;
                font-size: 11px;
                padding: 4px 0;
                cursor: pointer;
                background: #eee;
                border: 1px solid #bbb;
                border-right: none;
                border-radius: 4px 0 0 4px;
                text-align: center;
                user-select: none;
            `;
            btn.addEventListener('click', () => {
                insertPhrase(targetInput, phrase);
            });

            // Tick button
            const tick = document.createElement('button');
            tick.type = 'button';
            tick.textContent = '✔';
            tick.title = `Insert "${phrase.trim()}" and click Done`;
            tick.style.cssText = `
                width: 30px;
                font-size: 11px;
                padding: 2px 0;
                cursor: pointer;
                background: #e6f4e8;
                border: 1px solid #8cc084;
                border-radius: 0 4px 4px 0;
                color: #155724;
                text-align: center;
                user-select: none;
                height: 21px;
            `;
            tick.addEventListener('click', () => {
                insertPhrase(targetInput, phrase);
                setTimeout(() => clickDoneButton(form), 50);
            });

            row.appendChild(btn);
            row.appendChild(tick);
            container.appendChild(row);
        });

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
