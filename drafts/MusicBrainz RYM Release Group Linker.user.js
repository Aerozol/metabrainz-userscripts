// ==UserScript==
// @name         MusicBrainz RYM Release Group Linker
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Adds a button to RYM artist pages to copy release data to clipboard. Adds a collapsible 'RYM Automator' field in MusicBrainz artist pages to paste the clipboard contents, check for matches with RYM entities, and the submit the release group links. Submitting release group links REQUIRES the MusicBrainz: add release(group) links from artist/label page' userscript.
// @license      MIT
// @version      1.0
// @author       Gemini
// @match        *://rateyourmusic.com/artist/*
// @match        *://musicbrainz.org/artist/*
// @match        *://beta.musicbrainz.org/artist/*
// @match        *://test.musicbrainz.org/artist/*
// @exclude      *://musicbrainz.org/artist/*/*
// @exclude      *://beta.musicbrainz.org/artist/*/*
// @exclude      *://test.musicbrainz.org/artist/*/*
// @grant        GM_setClipboard
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    'use strict';

    const normalizeUrl = (url) => url ? url.split(/[?#]/)[0].replace(/^http:/, "https:").replace(/\/$/, "").toLowerCase() : null;

    function cleanTitle(str) {
        if (!str) return "";
        return str.toLowerCase()
            .replace(/[✅❌❓➕➖⏳\u2795\u2796\u274c\u2705\u2753]/g, '')
            .replace(/\b(original soundtrack|soundtrack|ost|the ep|ep|lp|album|dj mix)\b/g, '')
            .replace(/[:\-–—]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isFuzzyMatch(mbTitle, rymTitle) {
        const t1 = cleanTitle(mbTitle);
        const t2 = cleanTitle(rymTitle);
        if (!t1 || !t2) return false;
        return t1 === t2 || t1.includes(t2) || t2.includes(t1);
    }

    // --- RYM HARVESTER ---
    if (window.location.host.includes('rateyourmusic.com')) {
        const harvestBtn = $('<button type="button">📋 Copy RYM Data</button>').css({
            'position': 'fixed', 'top': '20px', 'right': '20px', 'z-index': '10001',
            'padding': '14px 24px', 'background': '#0055ff', 'color': 'white', 'border-radius': '10px', 'cursor': 'pointer', 'font-weight': 'bold'
        });
        $('body').append(harvestBtn);
        harvestBtn.on('click', function() {
            let data = [];
            $('.disco_info').each(function() {
                const info = $(this);
                const link = info.find('a.album, a.single, a.ep, a.release').first();
                if (!link.length) return;
                const title = link.text().replace(/[✅❌]/g, '').trim();
                let rawUrl = link.attr('href');
                if (!rawUrl) return;
                const fullUrl = rawUrl.startsWith('http') ? rawUrl : "https://rateyourmusic.com" + rawUrl;
                const subline = info.find('.disco_subline');
                let year = subline.find('.disco_year_ym').text().trim();
                if (!year) year = subline.text().match(/\d{4}/)?.[0] || "?";

                let type = "Album";
                const urlLower = fullUrl.toLowerCase();
                if (urlLower.includes('/release/ep/')) type = "EP";
                else if (urlLower.includes('/release/single/')) type = "Single";
                else if (urlLower.includes('/release/djmix/')) type = "DJ Mix";
                else if (urlLower.includes('/release/unauth/')) type = "Bootleg";
                else if (urlLower.includes('/release/comp/')) type = "Compilation";
                else {
                    let spanType = subline.find('.disco_type').text().trim();
                    if (spanType) type = spanType;
                }
                data.push({ title, url: normalizeUrl(fullUrl), year, type });
            });
            const uniqueData = Array.from(new Map(data.map(item => [item.url, item])).values());
            GM_setClipboard(JSON.stringify(uniqueData));
            harvestBtn.text('✅ Copied ' + uniqueData.length + ' items').css('background', '#28a745');
            setTimeout(() => harvestBtn.text('📋 Copy RYM Data').css('background', '#0055ff'), 2000);
        });
    }

    // --- MB MATCHER & AUTOMATOR ---
    if (window.location.host.includes('musicbrainz.org')) {
        const injectUI = () => {
            if ($('#rym-matcher-ui').length) return;

            const isExpanded = localStorage.getItem('rym-automator-expanded') === 'true';

            const container = $('<div id="rym-matcher-ui"></div>').css({
                'margin': '10px 0', 'border': '1px solid #ccc',
                'background': isExpanded ? '#fdfaff' : '#f0f0f0',
                'border-radius': '6px', 'float': isExpanded ? 'none' : 'right',
                'width': isExpanded ? '100%' : 'auto', 'transition': 'all 0.2s ease-in-out', 'clear': 'both'
            });

            const header = $('<div id="rym-ui-header"></div>').css({
                'background': isExpanded ? '#606' : '#e0e0e0', 'color': isExpanded ? 'white' : '#666',
                'padding': isExpanded ? '8px 15px' : '4px 10px', 'cursor': 'pointer',
                'display': 'flex', 'justify-content': 'space-between', 'align-items': 'center',
                'font-weight': 'bold', 'font-size': isExpanded ? '13px' : '11px', 'border-radius': '5px'
            }).append('<span id="rym-title">' + (isExpanded ? 'RYM → MB Automator' : 'RYM Automator') + '</span><span id="rym-toggle-icon" style="margin-left:8px">' + (isExpanded ? '▼' : '◀') + '</span>');

            const content = $('<div id="rym-ui-content"></div>').css({
                'padding': '15px', 'display': isExpanded ? 'block' : 'none'
            });

            const input = $('<textarea id="rym-input-box" placeholder="Paste RYM JSON here..."></textarea>').css({'width': '100%', 'height': '60px'});
            const processBtn = $('<button id="rym-proc-btn">Scan Artist Page</button>').css({'margin-top': '10px', 'padding': '8px 20px', 'background': '#606', 'color': 'white', 'cursor': 'pointer', 'border-radius':'4px', 'border':'none'});

            content.append(input).append('<br>').append(processBtn);
            container.append(header).append(content);
            $('#content h2').first().after(container);
            $('#content h2').first().after('<div style="clear:both"></div>');

            header.on('click', function() {
                const expanding = !content.is(':visible');
                if (expanding) {
                    container.css({'float': 'none', 'width': '100%', 'background': '#fdfaff', 'border': '2px solid #606'});
                    header.css({'background': '#606', 'color': 'white', 'padding': '8px 15px', 'font-size': '13px'});
                    $('#rym-title').text('RYM → MB Automator');
                    $('#rym-toggle-icon').text('▼');
                } else {
                    container.css({'float': 'right', 'width': 'auto', 'background': '#f0f0f0', 'border': '1px solid #ccc'});
                    header.css({'background': '#e0e0e0', 'color': '#666', 'padding': '4px 10px', 'font-size': '11px'});
                    $('#rym-title').text('RYM Automator');
                    $('#rym-toggle-icon').text('◀');
                }
                content.toggle();
                localStorage.setItem('rym-automator-expanded', expanding);
            });

            processBtn.on('click', function() {
                try {
                    const rymData = JSON.parse($('#rym-input-box').val());
                    $('table.tbl tbody tr').each(function() {
                        const row = $(this);
                        const rgLink = row.find('a[href*="/release-group/"]').first();
                        if (!rgLink.length) return;
                        const mbTitle = rgLink.text();
                        const mbYearMatch = row.text().match(/\d{4}/);
                        const mbYear = mbYearMatch ? mbYearMatch[0] : null;
                        const mbid = rgLink.attr('href').match(/[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}/)?.[0];
                        if (!mbid) return;

                        const matches = rymData.filter(r => isFuzzyMatch(mbTitle, r.title));
                        matches.forEach((match) => {
                            const yearsMatch = mbYear && match.year && (mbYear === match.year);
                            // Highlight Change: Blue for year-match, Dark Red for others
                            const bgColor = yearsMatch ? '#0055ff' : '#ba2121';

                            const linkBtn = $('<button></button>')
                                .text(`Link: ${match.title} [${match.type} (${match.year})]`)
                                .css({'background': bgColor, 'color': 'white', 'cursor': 'pointer', 'border': 'none', 'padding': '4px 10px', 'margin':'5px 0', 'display':'block', 'border-radius':'3px', 'font-size':'11px', 'text-align':'left', 'width':'100%'});

                            linkBtn.on('click', function(e) {
                                e.preventDefault();
                                linkBtn.text('⌛ Opening Editor...').prop('disabled', true);
                                const plusBtn = row.find('span').filter(function() { return $(this).text().includes('\u2795') || $(this).text().includes('➕'); });
                                if (plusBtn.length) {
                                    plusBtn[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                                    const iframeId = mbid + '-iframe';
                                    let pollIframe = setInterval(() => {
                                        const $iframe = $('#' + iframeId);
                                        if ($iframe.length) {
                                            clearInterval(pollIframe);
                                            $iframe.on('load', function() {
                                                const doc = this.contentDocument || this.contentWindow.document;
                                                let pollInput = setInterval(() => {
                                                    const urlInput = doc.querySelector('input[placeholder="Add link"]');
                                                    if (urlInput) {
                                                        clearInterval(pollInput);
                                                        linkBtn.text('⌛ Pasting...');
                                                        urlInput.focus();
                                                        doc.execCommand('insertText', false, match.url);
                                                        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
                                                        urlInput.dispatchEvent(new Event('change', { bubbles: true }));
                                                        let pollSubmit = setInterval(() => {
                                                            const rymRecognized = doc.querySelector('.external-link-item') || doc.body.innerText.toLowerCase().includes('rate your music');
                                                            const submitBtn = doc.querySelector('button.submit, button.primary');
                                                            if (rymRecognized && submitBtn && !submitBtn.disabled) {
                                                                clearInterval(pollSubmit);
                                                                linkBtn.text('⌛ Submitting...');
                                                                setTimeout(() => {
                                                                    submitBtn.click();
                                                                    linkBtn.text('✅ Linked').css('background', '#28a745');
                                                                }, 1000);
                                                            }
                                                        }, 800);
                                                        setTimeout(() => clearInterval(pollSubmit), 10000);
                                                    }
                                                }, 500);
                                            });
                                        }
                                    }, 500);
                                }
                            });
                            rgLink.closest('td').append(linkBtn);
                        });
                    });
                } catch(e) { alert("Error parsing JSON."); }
            });
        };
        injectUI();
    }
})();
