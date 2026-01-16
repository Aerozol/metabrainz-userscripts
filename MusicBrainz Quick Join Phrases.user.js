// ==UserScript==
// @name         MusicBrainz Quick Join Phrases
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Click to add common join phrases (release editor)
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Join%20Phrases.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20Join%20Phrases.user.js
// @license      MIT
// @author       ChatGPT
// @match        *://*.musicbrainz.org/release/add*
// @match        *://*.musicbrainz.org/release/*/edit*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // Default phrases - spaces are preserved exactly as written
    const defaultPhrases = [
        ' & ',
        ' feat. ',
        ' narrated by ',
        ' read by ',
    ];

    // Get saved phrases or use defaults
    function getPhrases() {
        const saved = GM_getValue('customJoinPhrases', null);
        return saved ? JSON.parse(saved) : defaultPhrases;
    }

    // Save phrases
    function savePhrases(phrases) {
        GM_setValue('customJoinPhrases', JSON.stringify(phrases));
    }

    // Configuration dialog
    function showConfigDialog() {
        const currentPhrases = getPhrases();
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border: 2px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 400px;
            direction: ltr;
        `;

        dialog.innerHTML = `
            <h3 style="margin-top: 0;">Configure Join Phrases</h3>
            <p style="font-size: 12px; color: #666; margin-bottom: 15px;">
                Enter one phrase per line. <strong>Spaces are preserved exactly as you type them.</strong><br>
                Examples:<br>
                • <code style="background: #f0f0f0; padding: 2px 4px;"> & </code> (space before and after)<br>
                • <code style="background: #f0f0f0; padding: 2px 4px;"> /</code> (space before, no space after)<br>
                • <code style="background: #f0f0f0; padding: 2px 4px;">/ </code> (no space before, space after)
            </p>
            <textarea id="joinPhrasesInput" style="
                width: 100%;
                height: 200px;
                font-family: monospace;
                font-size: 13px;
                padding: 8px;
                border: 1px solid #ccc;
                border-radius: 4px;
                box-sizing: border-box;
                direction: ltr;
                unicode-bidi: plaintext;
                white-space: pre;
            ">${currentPhrases.join('\n')}</textarea>
            <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end;">
                <button id="resetBtn" style="padding: 8px 15px; cursor: pointer; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px;">
                    Reset to Defaults
                </button>
                <button id="cancelBtn" style="padding: 8px 15px; cursor: pointer; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px;">
                    Cancel
                </button>
                <button id="saveBtn" style="padding: 8px 15px; cursor: pointer; background: #5cb85c; color: white; border: 1px solid #4cae4c; border-radius: 4px;">
                    Save
                </button>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        const textarea = dialog.querySelector('#joinPhrasesInput');
        const saveBtn = dialog.querySelector('#saveBtn');
        const cancelBtn = dialog.querySelector('#cancelBtn');
        const resetBtn = dialog.querySelector('#resetBtn');

        function closeDialog() {
            overlay.remove();
            dialog.remove();
        }

        saveBtn.addEventListener('click', () => {
            const input = textarea.value;
            const phrases = input
                .split('\n')
                .filter(line => line.length > 0); // Keep empty lines out, but preserve all spacing

            if (phrases.length === 0) {
                alert('Please enter at least one join phrase.');
                return;
            }

            savePhrases(phrases);
            alert('Join phrases saved! Reload the page to see changes.');
            closeDialog();
        });

        cancelBtn.addEventListener('click', closeDialog);
        overlay.addEventListener('click', closeDialog);

        resetBtn.addEventListener('click', () => {
            if (confirm('Reset to default join phrases?')) {
                textarea.value = defaultPhrases.join('\n');
            }
        });
    }

    // Register menu command for configuration
    GM_registerMenuCommand('Configure Join Phrases', showConfigDialog);

    const phrases = getPhrases();

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

    // Helper to display phrase with visible spaces for button text
    function getDisplayText(phrase) {
        // Show the phrase, replacing leading/trailing spaces with a visible indicator
        let display = phrase;

        // Optional: You could add visual indicators for spaces
        // Uncomment if you want to show spaces as · in the button
        // display = phrase.replace(/^ /, '·').replace(/ $/, '·');

        return display.trim() || phrase; // Fallback to original if trimming makes it empty
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
            btn.textContent = getDisplayText(phrase);
            btn.title = `Insert join phrase: "${phrase}"`;
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
                direction: ltr;
                unicode-bidi: plaintext;
            `;
            btn.addEventListener('click', () => {
                insertPhrase(targetInput, phrase);
            });

            // Tick button
            const tick = document.createElement('button');
            tick.type = 'button';
            tick.textContent = '✔';
            tick.title = `Insert "${phrase}" and click Done`;
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
