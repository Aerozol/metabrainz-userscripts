/* global $ helper relEditor sidebar */
'use strict';
// ==UserScript==
// @name         MusicBrainz seed artist relationships from Linktr.ee
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Seed MusicBrainz artist URL relationships from Linktr.ee
// @author       Gemini
// @version      0.7
// @downloadURL  https://raw.githubusercontent.com/loujine/musicbrainz-scripts/master/mb-edit-create_from_wikidata.user.js
// @updateURL    https://raw.githubusercontent.com/loujine/musicbrainz-scripts/master/mb-edit-create_from_wikidata.user.js
// @license      MIT
// @require      https://raw.githubusercontent.com/loujine/musicbrainz-scripts/master/mbz-loujine-common.js
// @include      http*://*musicbrainz.org/artist/*/edit
// @grant        GM_xmlhttpRequest
// @connect      linktr.ee
// @run-at       document-end
// ==/UserScript==

function _existingDomains() {
    const existingDomains = [];
    const fields = document.getElementById("external-links-editor")
                           .querySelectorAll('a.url');
    for (const link of fields) {
        existingDomains.push(link.href.split('/')[2]);
    }
    return existingDomains;
}


function _fillExternalLinks(url, originalUrl) {
    /* React16 adapter
     *
     * from https://github.com/facebook/react/issues/10135#issuecomment-314441175
     * React considers DOM events as duplicate of synthetic events
     */
    function _setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
    }
    const fields = document.querySelectorAll('#external-links-editor input[type="url"]');
    const input = fields[fields.length - 1];
    _setNativeValue(input, url);
    input.dispatchEvent(new Event('input', {'bubbles': true}));
    const newField = $('<dd>', {'text': url}).css('color', 'green');
    if (originalUrl) {
        newField.append(` <span class="tooltip-icon" title="URL truncated from ${originalUrl}">ⓘ</span>`);
    }
    $('#newFields').append(
        $('<dt>', {'text': 'New external link added:'})
    ).append(newField);
}

function fillExternalLinks(url, originalUrl) {
    const existingDomains = _existingDomains();
    const domain = url.split('/')[2];
    if (!existingDomains.includes(domain)) {
        _fillExternalLinks(url, originalUrl);
        return true;
    }
    return false;
}

function _logSkippedLink(url) {
    $('#newFields').append(
        $('<dt>', {'text': 'External link skipped:'})
    ).append(
        $('<dd>', {'text': url}).css('color', 'red')
    );
}

const observer = new MutationObserver((mutationsList, observer) => {
    const maxAttempts = 10;
    let attempts = 0;
    const checkInterval = setInterval(() => {
        attempts++;
        const favicon = document.querySelector('span.favicon.applemusic-favicon');
        if (favicon) {
            clearInterval(checkInterval);
            const trElement = favicon.closest('tr.external-link-item');
            if (trElement) {
                const selectRow = trElement.nextElementSibling;
                if (selectRow) {
                    const selectElement = selectRow.querySelector('select.link-type');
                    if (selectElement) {
                        selectElement.value = '978'; // 978 is the value for "streaming page"
                        selectElement.dispatchEvent(new Event('change', {'bubbles': true}));
                    }
                }
            }
        } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
        }
    }, 50); // check every 50ms
});


function fillFormFromLinktree(linktreeURL) {
    const entityType = document.URL.split('/')[3];
    GM_xmlhttpRequest({
        method: "GET",
        url: linktreeURL,
        onload: function(resp) {
            const doc = (new DOMParser()).parseFromString(resp.responseText, 'text/html');
            const links = doc.querySelectorAll('a[href]');
            links.forEach(link => {
                let url = link.href;
                if (url && !url.includes("linktr.ee") && !url.startsWith('#')) {
                    if (url.startsWith('mailto:')) {
                        _logSkippedLink(url);
                    } else if (url.includes("bandcamp.com")) {
                        const bandcampDomain = url.match(/(https?:\/\/[^\/]+\.bandcamp\.com)/);
                        if (bandcampDomain && bandcampDomain[0]) {
                            fillExternalLinks(bandcampDomain[0], url);
                        }
                    } else {
                        fillExternalLinks(url);
                    }
                }
            });
            document.getElementById(`id-edit-${entityType}.edit_note`)
                    .value += sidebar.editNote(GM_info.script);
        }
    });
}


(function displayToolbar() {
    if (!helper.isUserLoggedIn()) {
        return false;
    }
    document.getElementsByClassName('half-width')[0].insertAdjacentHTML(
        'afterend', '<div id="side-col" style="float: right;"></div>');
    relEditor.container(document.getElementById('side-col')).insertAdjacentHTML(
        'beforeend', `
        <h3>Add external link from Linktree</h3>
        <p>Add a Linktree URL here to retrieve automatically links.</p>
        <input type="text" id="linktreeParser" value="" placeholder="paste URL here"
               style="width: 400px;">
        <dl id="newFields">
    `);
    document.getElementById('loujine-menu').style.marginLeft = '550px';
})();

$(document).ready(function () {
    if (!helper.isUserLoggedIn()) {
        return false;
    }
    const node = document.getElementById('linktreeParser');
    node.addEventListener('input', () => {
        node.value = node.value.trim();
        if (!node.value) {
            return;
        }
        const domain = node.value.split('/')[2];
        node.style.backgroundColor = '#bbffbb';
        if (domain.includes("linktr.ee")) {
            node.value = node.value.replace(/http:/g, 'https:');
            fillFormFromLinktree(node.value);
            const externalLinksEditor = document.getElementById('external-links-editor');
            if (externalLinksEditor) {
                observer.observe(externalLinksEditor, { childList: true, subtree: true });
            }
        } else {
            node.style.backgroundColor = '#ffaaaa';
        }
    }, false);
    return false;
});
