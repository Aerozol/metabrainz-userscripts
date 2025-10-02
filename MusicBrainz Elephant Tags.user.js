// ==UserScript==
// @name MusicBrainz Elephant Tags
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Adds a button to submit and remember tag strings. Ctrl+click to forget them again.
// @version      1.2
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Elephant%20Tags.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Elephant%20Tags.user.js
// @license      MIT
// @author       ChatGPT
// @match        *://*.musicbrainz.org/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_SHORTCUTS = 'mbz_tag_shortcuts';
    const STORAGE_KEY_LAST_SUBMITTED = 'mbz_last_submitted_tag';

    function getSavedTags() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY_SHORTCUTS)) || [];
        } catch {
            return [];
        }
    }

    function saveTags(tags) {
        localStorage.setItem(STORAGE_KEY_SHORTCUTS, JSON.stringify(tags));
    }

    function getLastSubmittedTag() {
        return localStorage.getItem(STORAGE_KEY_LAST_SUBMITTED) || '';
    }

    function saveLastSubmittedTag(tag) {
        localStorage.setItem(STORAGE_KEY_LAST_SUBMITTED, tag);
    }

    // New function to handle all submission logic and re-rendering
    function saveAndRenderOnSubmission(form, tagText, input, submitButton, isNewTag = false) {
        const tag = tagText.trim();
        if (!tag) return;

        // If it's a new tag from the brain button, add it to shortcuts
        if (isNewTag) {
            const savedTags = getSavedTags();
            if (!savedTags.includes(tag)) {
                savedTags.push(tag);
                saveTags(savedTags);
            }
        }

        saveLastSubmittedTag(tag);
        renderTagButtons(form.querySelector('.tag-shortcuts'), getSavedTags(), input, submitButton);
    }

    function removeTagShortcut(tagToRemove) {
        let savedTags = getSavedTags();
        savedTags = savedTags.filter(t => t !== tagToRemove);
        saveTags(savedTags);
    }

    function renderTagButtons(container, tags, input, submitButton) {
        container.innerHTML = ''; // Clear old buttons

        // 🧠 button (submit and remember)
        const brainButton = document.createElement('button');
        brainButton.textContent = '🧠';
        brainButton.title = 'Submit and remember tags. Ctrl+click to remove a remembered tag.';
        brainButton.classList.add('brain-tag-button');
        brainButton.style.cssText = `
            font-size: 11px;
            height: 22px;
            padding: 2px 6px;
            margin: 2px 4px 2px 0;
            background-color: #eee;
            color: #333;
            border: 1px solid #ccc;
            border-radius: 4px;
            cursor: pointer;
        `;

        brainButton.addEventListener('click', function (e) {
            e.preventDefault();
            const tagText = input.value.trim();
            if (!tagText) return;
            // Use the new centralized function for submission and rendering
            saveAndRenderOnSubmission(container.closest('form'), tagText, input, submitButton, true);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            submitButton.click();
        });

        container.appendChild(brainButton);

        // 🔄 button (apply last submitted tag)
        const lastTag = getLastSubmittedTag();
        const repeatButton = document.createElement('button');
        repeatButton.textContent = '🔄';
        repeatButton.title = lastTag ? `Apply last submitted tag: "${lastTag}"` : 'No previous tag to apply.';
        repeatButton.classList.add('repeat-tag-button');
        repeatButton.style.cssText = `
            font-size: 11px;
            height: 22px;
            padding: 2px 6px;
            margin: 2px 4px 2px 0;
            background-color: #eee;
            color: #333;
            border: 1px solid #ccc;
            border-radius: 4px;
        `;

        if (!lastTag) {
            repeatButton.style.opacity = '0.5';
            repeatButton.style.cursor = 'not-allowed';
        } else {
            repeatButton.style.cursor = 'pointer';
            repeatButton.addEventListener('click', function (e) {
                e.preventDefault();
                input.value = lastTag;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                submitButton.click();
            });
        }

        container.appendChild(repeatButton);

        // Render saved tags
        tags.forEach(tag => {
            const btn = document.createElement('button');
            btn.textContent = tag.substring(0, 3);
            btn.title = tag;
            btn.classList.add('tag-shortcut-btn');
            btn.style.cssText = `
                font-size: 11px;
                height: 22px;
                padding: 2px 6px;
                margin: 2px 4px 2px 0;
                background-color: #f8f8f8;
                color: #333;
                border: 1px solid #ccc;
                border-radius: 4px;
                cursor: pointer;
            `;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                if (e.ctrlKey) {
                    removeTagShortcut(tag);
                    renderTagButtons(container, getSavedTags(), input, submitButton);
                } else {
                    input.value = tag;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    submitButton.click();
                    // Use the new centralized function for submission and rendering
                    saveAndRenderOnSubmission(container.closest('form'), tag, input, submitButton);
                }
            });
            container.appendChild(btn);
        });
    }

    function addTaggingUI() {
        const form = document.getElementById('tag-form');
        if (!form) return;

        const input = form.querySelector('input.tag-input');
        const submitButton = form.querySelector('button.styled-button');

        if (!input || !submitButton) return;

        // Prevent duplicates
        if (form.querySelector('.tag-shortcuts')) return;

        // Listen for the standard MusicBrainz submit button click
        submitButton.addEventListener('click', function (e) {
            const tagText = input.value.trim();
            if (!tagText) return;
            // Use the new centralized function for submission and rendering
            saveAndRenderOnSubmission(form, tagText, input, submitButton);
        });

        // Shortcut container
        const shortcutContainer = document.createElement('div');
        shortcutContainer.className = 'tag-shortcuts';
        shortcutContainer.style.cssText = `
            margin-top: 6px;
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
        `;

        form.appendChild(shortcutContainer);

        renderTagButtons(shortcutContainer, getSavedTags(), input, submitButton);
    }

    const observer = new MutationObserver(() => {
        addTaggingUI();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
