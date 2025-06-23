// ==UserScript==
// @name MusicBrainz Elephant Tags
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @version 1.0
// @description Adds a button to submit and remember tag strings. Ctrl+click to forget them again.
// @author ChatGPT
// @match *://*.musicbrainz.org/*
// @grant none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'mbz_tag_shortcuts';

    function getSavedTags() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveTags(tags) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
    }

    function addTagShortcut(form, tagText, input, submitButton) {
        const shortcutDiv = form.querySelector('.tag-shortcuts');
        if (!shortcutDiv) return;

        const tag = tagText.trim();
        if (!tag) return;

        const savedTags = getSavedTags();
        if (savedTags.includes(tag)) return;

        savedTags.push(tag);
        saveTags(savedTags);
        renderTagButtons(shortcutDiv, savedTags, input, submitButton);
    }

    function removeTagShortcut(tagToRemove) {
        let savedTags = getSavedTags();
        savedTags = savedTags.filter(t => t !== tagToRemove);
        saveTags(savedTags);
    }

    function renderTagButtons(container, tags, input, submitButton) {
        container.innerHTML = ''; // Clear old buttons

        // 🧠 button (inline)
        const brainButton = document.createElement('button');
        brainButton.textContent = '🧠';
        brainButton.title = 'submit and remember tags – ctrl+click remembered tags to remove';
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
            input.dispatchEvent(new Event('input', { bubbles: true }));
            submitButton.click();
            addTagShortcut(container.closest('form'), tagText, input, submitButton);
        });

        container.appendChild(brainButton);

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

    window.addEventListener('load', addTaggingUI);
})();
