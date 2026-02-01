// ==UserScript==
// @name         MusicBrainz Release Group Linker
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Copy RYM or Discogs artist data to clipboard and compare and link from MB artist pages. Incorporates RandomMushroom128's 'MusicBrainz: add release(group) links from level above' userscript.
// @license      GPL
// @version      1.1
// @author       Gemini and RandomMushroom128
// @match        *://rateyourmusic.com/artist/*
// @match        *://www.discogs.com/artist/*
// @match        *://musicbrainz.org/artist/*
// @match        *://beta.musicbrainz.org/artist/*
// @match        *://test.musicbrainz.org/artist/*
// @match        *://musicbrainz.org/label/*
// @match        *://beta.musicbrainz.org/label/*
// @match        *://test.musicbrainz.org/label/*
// @match        *://musicbrainz.org/series/*
// @match        *://beta.musicbrainz.org/series/*
// @match        *://test.musicbrainz.org/series/*
// @match        *://musicbrainz.org/release-group/*
// @match        *://beta.musicbrainz.org/release-group/*
// @match        *://test.musicbrainz.org/release-group/*
// @exclude      *://musicbrainz.org/artist/*/*
// @exclude      *://beta.musicbrainz.org/artist/*/*
// @exclude      *://test.musicbrainz.org/artist/*/*
// @exclude      *://musicbrainz.org/artist/create
// @exclude      *://beta.musicbrainz.org/artist/create
// @exclude      *://test.musicbrainz.org/artist/create
// @exclude      *musicbrainz.org/label/*/*
// @exclude      *musicbrainz.org/series/*/*
// @grant        GM_setClipboard
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // PART 1: Helpers
    // -------------------------------------------------------------------------
    const normalizeUrl = (url) => url ? url.split(/[?#]/)[0].replace(/^http:/, "https:").replace(/\/$/, "").toLowerCase() : null;

    function cleanTitle(str) {
        if (!str) return "";
        return str.toLowerCase()
            .replace(/[✅❌❓➕➖⏳\u2795\u2796\u274c\u2705\u2753]/g, '')
            .replace(/\b(original soundtrack|soundtrack|ost|the ep|ep|lp|album|dj mix)\b/g, '')
            .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
            .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
            .replace(/[:\-–—]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isFuzzyMatch(mbTitle, sourceTitle) {
        const t1 = cleanTitle(mbTitle);
        const t2 = cleanTitle(sourceTitle);
        return t1 && t2 && (t1 === t2 || t1.includes(t2) || t2.includes(t1));
    }

    function createHarvestButton(siteName) {
        const btn = $('<button type="button">📋 Copy ' + siteName + ' Data</button>').css({
            'position': 'fixed', 'top': '20px', 'right': '20px', 'z-index': '10001',
            'padding': '14px 24px', 'background': '#0055ff', 'color': 'white', 'border-radius': '10px', 'cursor': 'pointer', 'font-weight': 'bold'
        });
        $('body').append(btn);
        return btn;
    }

    const triggerAllEvents = (el) => {
        if (!el) return;
        ['mousedown', 'mouseup', 'click'].forEach(type => {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        });
    };

    // -------------------------------------------------------------------------
    // PART 2: Companion Script Logic (Add Release Buttons)
    // -------------------------------------------------------------------------
    // Adapted from "MusicBrainz: add release(group) links from level above"
    // -------------------------------------------------------------------------
    function initCompanionScript() {
        // Only run on MusicBrainz pages
        if (!window.location.host.includes('musicbrainz.org')) return;

        console.log("Initializing Companion Script Logic...");

        const MBID_REGEX = /[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/;
        const current_url = window.location.href.match(/(test|beta|)\.?musicbrainz\.org/)[0];

        function create_button(dom_callback) {
            let button = document.createElement('span'), toggled = false;
            button.innerHTML = '&#x2795;'; // ➕
            button.style.cursor = 'pointer';
            button.style.color = '#777';
            button.style.float = "right";

            const toggleLogic = function () {
                toggled = !toggled;
                button.innerHTML = toggled ? '&#x2796;' : '&#x2795;'; // ➖ : ➕
                dom_callback(toggled);
            };

            button.addEventListener('mousedown', toggleLogic, false);
            // Also listen for our custom trigger if needed, but direct mousedown is better
            button.addEventListener('mb-linker:trigger', toggleLogic, false);
            return button;
        }

        function debloatIframe(iframeId) {
            $(`#${iframeId}`).on("load", function () {
                // Same debloating logic
                try {
                    let iframe_head = document.getElementById(`${iframeId}`).contentDocument.head,
                        iframe_width = document.getElementById(`${iframeId}`).offsetWidth - 15,
                        hide_stuff = document.createElement('style');
                    hide_stuff.textContent = `#enter-edit, #edit-note {display: block !important;} .header, .banner, .rgheader, .tabs, #content > p, form > div > fieldset:nth-child(1), fieldset.editnote > p, #footer, .relationship-editor, .ui-tabs-nav, #information > .half-width > :nth-child(n+1):nth-child(-n+3), .releaseheader, .buttons > button:nth-of-type(n+2):nth-of-type(-n+5) {display: none} #page, .half-width, .relationship-editor, #content {margin: 0px !important; margin-top: 0px; padding: 0px; padding-right: 0px;} body {min-width: 0px;} .half-width {width: ${iframe_width}px !important;} .warning {width: 100%} .ui-tabs, .ui-tabs-panel, #release-editor {margin-top: 0; padding: 0;}`;
                    iframe_head.appendChild(hide_stuff);
                } catch (e) { console.error("Debloat error:", e); }
            });
        }

        function injectReleaseGroupButton(parent) {
            let match = parent.querySelector('a').href.match(MBID_REGEX);
            if (!match) return;
            let mbid = match[0];

            // Check for relationship column DYNAMICALLY (to handle race conditions with other scripts)
            let relationshipsCol = $(`#${mbid} td.relationships`);

            let table = document.createElement('table'),
                iframe = document.createElement("iframe");

            table.style.width = "100%";
            iframe.src = `https://${current_url}/release-group/${mbid}/edit`;
            iframe.style.width = "100%";
            iframe.style.height = "375px";
            iframe.style.border = "none";
            iframe.id = `${mbid}-iframe`;

            let button = create_button(function (toggled) {
                if (toggled) {
                    parent.appendChild(table);
                    table.appendChild(iframe);
                    debloatIframe(`${mbid}-iframe`);
                } else {
                    if (table.parentNode) table.parentNode.removeChild(table);
                }
            });

            if (relationshipsCol.length) {
                relationshipsCol.append(button);
            } else {
                parent.insertBefore(button, parent.childNodes[1]);
            }
        }

        function injectReleaseButton(parent) {
            let match = parent.querySelector('a').href.match(MBID_REGEX);
            if (!match) return;
            let mbid = match[0];

            // DYNAMIC CHECK
            let relationshipsCol = $(`#${mbid} td.relationships`);
            let isReleaseGroupPage = window.location.href.includes("release-group");

            let table = document.createElement('table'),
                iframe = document.createElement("iframe");

            table.style.width = "100%";
            iframe.src = `https://${current_url}/release/${mbid}/edit`;
            iframe.style.width = "100%";
            iframe.style.height = "375px";
            iframe.style.border = "none";
            iframe.id = `${mbid}-iframe`;

            let button = create_button(function (toggled) {
                if (toggled) {
                    if (isReleaseGroupPage) {
                        parent.parentNode.nextSibling.firstChild.appendChild(table) & table.appendChild(iframe) & debloatIframe(`${mbid}-iframe`);
                    } else {
                        parent.appendChild(table) & table.appendChild(iframe) & debloatIframe(`${mbid}-iframe`);
                    }
                } else {
                    if (isReleaseGroupPage) {
                        parent.parentNode.nextSibling.firstChild.removeChild(table);
                    } else {
                        parent.removeChild(table);
                    }
                }
            });

            if (isReleaseGroupPage) {
                parent.insertBefore(button, parent.childNodes[1]);
            } else if (relationshipsCol.length) {
                relationshipsCol.append(button);
            } else {
                parent.insertBefore(button, parent.childNodes[1]);
            }
        }

        function searchExpandedReleaseGroup(parent) {
            let isloaded = parent.lastChild.hasChildNodes();
            if (isloaded == true) {
                let loaded_release_links = parent.querySelectorAll('a');
                // Check if not already injected (rough check)
                if (!parent.innerHTML.includes('&#x2795;')) {
                    for (const release of loaded_release_links) {
                        let release_link = release.getAttribute('href');
                        if (release_link && release_link.match(/\/release\/[0-9a-z-]{36}/)) {
                            injectReleaseButton(release.parentNode);
                        }
                    }
                }
            } else {
                setTimeout(() => searchExpandedReleaseGroup(parent), 100);
            }
        }

        // Logic to scan page
        const releases_or_releasegroups = document.querySelectorAll("#content table.tbl > tbody > tr > td a[href^='/release']");
        for (const entity of releases_or_releasegroups) {
            const entity_link = entity.getAttribute('href');
            if (entity_link.match(/\/release-group\//)) {
                setTimeout(injectReleaseGroupButton, 100, entity.parentNode);
            } else if (!entity_link.match(/\/cover-art/)) {
                setTimeout(injectReleaseButton, 100, entity.parentNode);
            }
        }

        const expanded_releasegroup_button = document.querySelectorAll("#content table.tbl > tbody > tr > td > span");
        for (const releasegroup_button of expanded_releasegroup_button) {
            if (releasegroup_button.textContent == "▶") {
                releasegroup_button.addEventListener('mousedown', function () {
                    searchExpandedReleaseGroup(releasegroup_button.parentNode);
                });
            }
        }
    }

    // -------------------------------------------------------------------------
    // PART 3: Linker Script Logic
    // -------------------------------------------------------------------------
    function initLinkerScript() {
        // Global CSS
        const style = document.createElement('style');
        style.innerHTML = `
            .rym-stealth-hide { 
                position: fixed !important;
                top: 0 !important;
                right: 0 !important;
                width: 800px !important;
                height: 600px !important;
                opacity: 0 !important;
                z-index: -10000 !important;
                pointer-events: none !important;
            }
            .rym-match-row { display: flex; align-items: center; margin: 4px 0; gap: 0; }
            .rym-link-btn {
                width: 100%; font-size: 11px; padding: 4px 8px; cursor: pointer;
                background: #eee; border: 1px solid #bbb; border-right: none;
                border-radius: 4px 0 0 4px; text-align: left; color: #333;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .rym-link-btn:hover { background: #e5e5e5; }
            .rym-year-match { background: #f0f7ff; border-color: #aac6ff; }
            .rym-ext-btn {
                width: 30px; font-size: 11px; padding: 4px 0; cursor: pointer;
                background: #f8f8f8; border: 1px solid #bbb; border-radius: 0 4px 4px 0;
                color: #666; text-align: center; height: 23px; line-height: 1;
            }
            .rym-success { background: #e6f4e8 !important; border-color: #8cc084 !important; color: #155724 !important; }
        `;
        document.head.appendChild(style);

        // RYM HARVESTER
        if (window.location.host.includes('rateyourmusic.com')) {
            const harvestBtn = createHarvestButton('RYM');
            harvestBtn.on('click', function () {
                let data = [];
                $('.disco_info').each(function () {
                    const info = $(this);
                    const link = info.find('a.album, a.single, a.ep, a.release').first();
                    if (!link.length) return;
                    const title = link.text().replace(/[✅❌⏳]/g, '').trim();
                    let rawUrl = link.attr('href');
                    const fullUrl = rawUrl.startsWith('http') ? rawUrl : "https://rateyourmusic.com" + rawUrl;

                    const subline = info.find('.disco_subline');
                    let year = subline.find('.disco_year_ym').text().trim() || subline.text().match(/\d{4}/)?.[0] || "?";

                    let type = "Album";
                    if (fullUrl.includes('/release/ep/')) type = "EP";
                    else if (fullUrl.includes('/release/single/')) type = "Single";
                    else if (fullUrl.includes('/release/djmix/')) type = "DJ Mix";
                    else if (fullUrl.includes('/release/comp/')) type = "Compilation";

                    data.push({ title, url: normalizeUrl(fullUrl), year, type, source: 'RYM' });
                });
                GM_setClipboard(JSON.stringify(data));
                harvestBtn.text('✅ Copied').css('background', '#28a745');
                setTimeout(() => harvestBtn.text('📋 Copy RYM Data').css('background', '#0055ff'), 2000);
            });
        }

        // DISCOGS HARVESTER
        if (window.location.host.includes('discogs.com')) {
            const harvestBtn = createHarvestButton('Discogs');
            harvestBtn.on('click', function () {
                let data = [];
                $('tr[class*="textWithCoversRow"]').each(function () {
                    const row = $(this);
                    const masterLink = row.find('td[class*="title"] a[href*="/master/"]').first();
                    if (!masterLink.length) return;

                    const title = masterLink.text().trim();
                    const rawUrl = masterLink.attr('href');
                    const fullUrl = "https://www.discogs.com" + rawUrl;
                    const year = row.find('td[class*="year"]').text().trim() || "?";
                    const sectionHeader = row.closest('tbody').prev('thead').find('h2').text().trim() || "Release";

                    data.push({ title, url: normalizeUrl(fullUrl), year, type: sectionHeader, source: 'Discogs' });
                });

                if (data.length === 0) { alert("No Master Releases found."); return; }

                GM_setClipboard(JSON.stringify(data));
                harvestBtn.text('✅ Copied ' + data.length).css('background', '#28a745');
                setTimeout(() => harvestBtn.text('📋 Copy Discogs Data').css('background', '#0055ff'), 2000);
            });
        }

        // MB MATCHER
        if (window.location.host.includes('musicbrainz.org')) {
            const injectUI = () => {
                // RESTRICTION: Only show on Artist pages. Hide on Label and Release Group pages.
                if (!window.location.href.match(/\/artist\//)) return;

                if ($('#rym-matcher-ui').length) return;
                let isExpanded = localStorage.getItem('rym-automator-expanded') === 'true';

                const container = $('<div id="rym-matcher-ui"></div>').css({
                    'margin': '10px 0', 'border': '1px solid #ccc', 'background': '#f8f8f8',
                    'border-radius': '4px', 'float': isExpanded ? 'none' : 'right',
                    'width': isExpanded ? '100%' : 'auto', 'clear': 'both', 'box-shadow': '0 2px 6px rgba(0,0,0,0.15)'
                });

                const header = $('<div id="rym-ui-header"></div>').css({
                    'background': '#eee', 'padding': '8px 15px', 'cursor': 'pointer', 'display': 'flex',
                    'justify-content': 'space-between', 'font-weight': 'bold', 'font-size': '11px'
                }).append('<span id="rym-ui-title">Release Group link automator</span><span id="rym-ui-icon">' + (isExpanded ? '▼' : '◀') + '</span>');

                const content = $('<div id="rym-ui-content"></div>').css({ 'padding': '10px', 'display': isExpanded ? 'block' : 'none' });
                const input = $('<textarea id="rym-input-box" placeholder="Paste JSON here..."></textarea>').css({ 'width': '100%', 'height': '50px', 'font-size': '11px' });
                const processBtn = $('<button id="rym-proc-btn">Scan Page</button>').css({ 'margin-top': '8px', 'padding': '5px 15px', 'cursor': 'pointer' });

                content.append(input).append('<br>').append(processBtn);
                container.append(header).append(content);
                $('#content h2').first().after(container).after('<div style="clear:both"></div>');

                header.on('click', () => {
                    content.toggle();
                    isExpanded = content.is(':visible');
                    localStorage.setItem('rym-automator-expanded', isExpanded);
                    container.css('float', isExpanded ? 'none' : 'right').css('width', isExpanded ? '100%' : 'auto');
                    $('#rym-ui-icon').text(isExpanded ? '▼' : '◀');
                });

                processBtn.on('click', function () {
                    try {
                        const harvestedData = JSON.parse($('#rym-input-box').val());
                        $('table.tbl tbody tr').each(function () {
                            const row = $(this);
                            const rgLink = row.find('a[href*="/release-group/"]').first();
                            if (!rgLink.length) return;

                            const mbTitle = rgLink.text();
                            const mbYear = row.text().match(/\d{4}/)?.[0];
                            const mbid = rgLink.attr('href').match(/[0-9a-z-]{36}/)?.[0];

                            harvestedData.filter(r => isFuzzyMatch(mbTitle, r.title)).forEach((match) => {
                                const isYearMatch = mbYear === match.year;
                                const rowWrapper = $('<div class="rym-match-row"></div>');
                                const linkBtn = $('<button class="rym-link-btn"></button>')
                                    .text(`Link ${match.source}: ${match.title} [${match.type} (${match.year})]`)
                                    .addClass(isYearMatch ? 'rym-year-match' : '');

                                const extBtn = $('<button class="rym-ext-btn" title="Open source page">↗</button>');
                                extBtn.on('click', (e) => { e.preventDefault(); window.open(match.url, '_blank'); });

                                linkBtn.on('click', function (e) {
                                    e.preventDefault();
                                    if (linkBtn.hasClass('rym-success')) return;
                                    linkBtn.text('⌛ Opening...').prop('disabled', true);

                                    // Find the plus button added by the companion script part
                                    const plusBtn = row.find('span').filter(function () {
                                        return $(this).text().includes('\u2795') || $(this).text().includes('➕');
                                    });

                                    if (plusBtn.length) {
                                        // TRIGGER THE COMPANION SCRIPT BUTTON CLICK
                                        triggerAllEvents(plusBtn[0]);

                                        let pollIframe = setInterval(() => {
                                            const $iframe = $('#' + mbid + '-iframe');
                                            if ($iframe.length) {
                                                clearInterval(pollIframe);

                                                // Hiding
                                                $iframe.addClass('rym-stealth-hide').closest('table').addClass('rym-stealth-hide');

                                                const onFrameLoad = function () {
                                                    const doc = this.contentDocument || this.contentWindow.document;

                                                    // CHECK FOR SUCCESS BANNER FIRST (Result of submission)
                                                    // When the form submits, the iframe reloads. This check catches the success page.
                                                    const successBanner = doc.querySelector('.banner.flash');
                                                    if (successBanner && (successBanner.textContent.includes('accepted') || successBanner.textContent.includes('automatisch'))) {
                                                        linkBtn.text('✅ Linked').addClass('rym-success').prop('disabled', false);
                                                        return;
                                                    }

                                                    const nativeLinker = (input, val) => {
                                                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                                                        nativeInputValueSetter.call(input, val);

                                                        // Simulate full user interaction sequence
                                                        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true }));
                                                        input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true }));
                                                        input.dispatchEvent(new Event('input', { bubbles: true }));
                                                        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));
                                                        input.dispatchEvent(new Event('change', { bubbles: true }));
                                                    }

                                                    let pollInput = setInterval(() => {
                                                        const urlInput = doc.querySelector('input[placeholder*="link"]');
                                                        if (urlInput) {
                                                            clearInterval(pollInput);
                                                            urlInput.focus();
                                                            nativeLinker(urlInput, match.url);
                                                            // Blur often triggers final validation
                                                            urlInput.blur();

                                                            // Wait for MusicBrainz to validate the link (Type label appears)
                                                            let pollValidation = setInterval(() => {
                                                                const typeLabel = doc.querySelector('.relationship-name');
                                                                // Also check if we already have a success banner (unexpected but possible) or error
                                                                if (typeLabel) {
                                                                    clearInterval(pollValidation);

                                                                    // Link detected, now submit
                                                                    let pollSubmit = setInterval(() => {
                                                                        const submitBtn = doc.querySelector('button.submit, button.primary');
                                                                        if (submitBtn) {
                                                                            if (!submitBtn.disabled) {
                                                                                clearInterval(pollSubmit);
                                                                                triggerAllEvents(submitBtn);
                                                                                // The polling for success is now redundant here because the page will reload
                                                                                // and trigger onFrameLoad again, which catches the banner at the top.
                                                                            }
                                                                        }
                                                                    }, 50);
                                                                }
                                                            }, 50);
                                                        }
                                                    }, 50);
                                                };

                                                const iframeEl = $iframe[0];
                                                if (iframeEl.contentDocument && iframeEl.contentDocument.readyState === 'complete' && iframeEl.contentDocument.URL !== 'about:blank') {
                                                    onFrameLoad.call(iframeEl);
                                                } else {
                                                    $iframe.on('load', onFrameLoad);
                                                }
                                            }
                                        }, 200);
                                    } else {
                                        // Fallback if button not found yet
                                        linkBtn.text('❌ Button not found');
                                    }
                                });
                                rowWrapper.append(linkBtn).append(extBtn);
                                rgLink.closest('td').append(rowWrapper);
                            });
                        });
                    } catch (e) { alert("Invalid JSON data."); console.error(e); }
                });
            };
            injectUI();
        }
    }

    // -------------------------------------------------------------------------
    // EXECUTE
    // -------------------------------------------------------------------------
    $(document).ready(function () {
        initCompanionScript();
        // Give a slight delay for the companion script to populate buttons before the Linker runs (though Linker runs on user interaction mostly)
        initLinkerScript();
    });

})();
