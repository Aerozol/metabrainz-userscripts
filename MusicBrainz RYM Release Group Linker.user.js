// ==UserScript==
// @name         MusicBrainz RYM Release Group Linker
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Copy RYM artist data to clipboard and compare in MB artist pages. Click to add links REQUIRES the MusicBrainz: 'add release(group) links from artist/label page' userscript.
// @license      MIT
// @version      1.03
// @downloadURL https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20RYM%20Release%20Linker.user.js
// @updateURL   https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20RYM%20Release%20Linker.user.js
// @author       Gemini
// @match        *://rateyourmusic.com/artist/*
// @match        *://musicbrainz.org/artist/*
// @match        *://beta.musicbrainz.org/artist/*
// @match        *://test.musicbrainz.org/artist/*
// @exclude      *://musicbrainz.org/artist/*/*
// @exclude      *://beta.musicbrainz.org/artist/*/*
// @exclude      *://test.musicbrainz.org/artist/*/*
// @exclude      *://musicbrainz.org/artist/create
// @exclude      *://beta.musicbrainz.org/artist/create
// @exclude      *://test.musicbrainz.org/artist/create
// @grant        GM_setClipboard
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Global CSS
    const style = document.createElement('style');
    style.innerHTML = `
        /* --- TARGETED HIDING (Only hides the relationship editor elements) --- */
        .rym-stealth-hide {
            display: none !important;
            height: 0 !important;
            width: 0 !important;
            border: none !important;
            overflow: hidden !important;
            visibility: hidden !important;
            position: absolute !important;
        }

        /* --- UI STYLING --- */
        .rym-match-row {
            display: flex;
            align-items: center;
            margin: 4px 0;
            gap: 0;
        }

        .rym-link-btn {
            width: 100%;
            font-size: 11px;
            padding: 4px 8px;
            cursor: pointer;
            background: #eee;
            border: 1px solid #bbb;
            border-right: none;
            border-radius: 4px 0 0 4px;
            text-align: left;
            user-select: none;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .rym-link-btn:hover { background: #e5e5e5; }
        .rym-year-match { background: #f0f7ff; border-color: #aac6ff; }

        .rym-ext-btn {
            width: 30px;
            font-size: 11px;
            padding: 4px 0;
            cursor: pointer;
            background: #f8f8f8;
            border: 1px solid #bbb;
            border-radius: 0 4px 4px 0;
            color: #666;
            text-align: center;
            height: 23px;
            line-height: 1;
        }

        .rym-ext-btn:hover { background: #eee; color: #000; }
        .rym-success { background: #e6f4e8 !important; border-color: #8cc084 !important; color: #155724 !important; }
    `;
    document.head.appendChild(style);

    const normalizeUrl = (url) => url ? url.split(/[?#]/)[0].replace(/^http:/, "https:").replace(/\/$/, "").toLowerCase() : null;

    function cleanTitle(str) {
        if (!str) return "";
        return str.toLowerCase()
            // Ignore emojis added by 'MusicBrainz RYM Link Checker' userscript
            .replace(/[✅❌❓➕➖⏳\u2795\u2796\u274c\u2705\u2753]/g, '')
            // Ignore common suffixes
            .replace(/\b(original soundtrack|soundtrack|ost|the ep|ep|lp|album|dj mix)\b/g, '')
            // Normalize typographical apostrophes
            .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
            // Normalize various dashes
            .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
            // Convert punctuation to spaces for easier comparison
            .replace(/[:\-–—]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isFuzzyMatch(mbTitle, rymTitle) {
        const t1 = cleanTitle(mbTitle);
        const t2 = cleanTitle(rymTitle);
        return t1 && t2 && (t1 === t2 || t1.includes(t2) || t2.includes(t1));
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
                const title = link.text().replace(/[✅❌⏳]/g, '').trim();
                let rawUrl = link.attr('href');
                if (!rawUrl) return;
                const fullUrl = rawUrl.startsWith('http') ? rawUrl : "https://rateyourmusic.com" + rawUrl;
                const subline = info.find('.disco_subline');
                let year = subline.find('.disco_year_ym').text().trim() || subline.text().match(/\d{4}/)?.[0] || "?";
                let type = "Album";
                if (fullUrl.includes('/release/ep/')) type = "EP";
                else if (fullUrl.includes('/release/single/')) type = "Single";
                else if (fullUrl.includes('/release/djmix/')) type = "DJ Mix";
                else if (fullUrl.includes('/release/comp/')) type = "Compilation";
                data.push({ title, url: normalizeUrl(fullUrl), year, type });
            });
            GM_setClipboard(JSON.stringify(Array.from(new Map(data.map(item => [item.url, item])).values())));
            harvestBtn.text('✅ Copied').css('background', '#28a745');
            setTimeout(() => harvestBtn.text('📋 Copy RYM Data').css('background', '#0055ff'), 2000);
        });
    }

    // --- MB MATCHER ---
    if (window.location.host.includes('musicbrainz.org')) {
        const injectUI = () => {
            if ($('#rym-matcher-ui').length) return;
            let isExpanded = localStorage.getItem('rym-automator-expanded') === 'true';

            const container = $('<div id="rym-matcher-ui"></div>').css({
                'margin': '10px 0', 'border': '1px solid #ccc', 'background': '#f8f8f8',
                'border-radius': '4px', 'float': isExpanded ? 'none' : 'right',
                'width': isExpanded ? '100%' : 'auto', 'clear': 'both', 'box-shadow': '0 2px 6px rgba(0,0,0,0.15)', 'transition': 'none'
            });

            const header = $('<div id="rym-ui-header"></div>').css({
                'background': '#eee', 'color': '#333', 'padding': isExpanded ? '8px 15px' : '4px 10px',
                'cursor': 'pointer', 'display': 'flex', 'justify-content': 'space-between',
                'align-items': 'center', 'font-weight': 'bold', 'font-size': '11px', 'border-bottom': isExpanded ? '1px solid #ccc' : 'none'
            }).append('<span id="rym-ui-title">' + (isExpanded ? 'RYM → MB Automator' : 'RYM Automator') + '</span><span id="rym-ui-icon">' + (isExpanded ? '▼' : '◀') + '</span>');

            const content = $('<div id="rym-ui-content"></div>').css({ 'padding': '10px', 'display': isExpanded ? 'block' : 'none' });
            const input = $('<textarea id="rym-input-box" placeholder="Paste RYM JSON here..."></textarea>').css({'width': '100%', 'height': '50px', 'font-size': '11px', 'border': '1px solid #ccc'});
            const processBtn = $('<button id="rym-proc-btn">Scan Page</button>').css({'margin-top': '8px', 'padding': '5px 15px', 'background': '#eee', 'border': '1px solid #bbb', 'border-radius': '4px', 'cursor': 'pointer', 'font-size': '11px'});

            content.append(input).append('<br>').append(processBtn);
            container.append(header).append(content);
            $('#content h2').first().after(container).after('<div style="clear:both"></div>');

            header.on('click', function() {
                isExpanded = !content.is(':visible');
                localStorage.setItem('rym-automator-expanded', isExpanded);
                content.toggle();
                container.css({ 'float': isExpanded ? 'none' : 'right', 'width': isExpanded ? '100%' : 'auto' });
                header.css({ 'padding': isExpanded ? '8px 15px' : '4px 10px', 'border-bottom': isExpanded ? '1px solid #ccc' : 'none' });
                $('#rym-ui-title').text(isExpanded ? 'RYM → MB Automator' : 'RYM Automator');
                $('#rym-ui-icon').text(isExpanded ? '▼' : '◀');
            });

            processBtn.on('click', function() {
                try {
                    const rymData = JSON.parse($('#rym-input-box').val());
                    $('table.tbl tbody tr').each(function() {
                        const row = $(this);
                        const rgLink = row.find('a[href*="/release-group/"]').first();
                        if (!rgLink.length) return;
                        const mbTitle = rgLink.text();
                        const mbYear = row.text().match(/\d{4}/)?.[0];
                        const mbid = rgLink.attr('href').match(/[0-9a-z-]{36}/)?.[0];

                        rymData.filter(r => isFuzzyMatch(mbTitle, r.title)).forEach((match) => {
                            const isYearMatch = mbYear === match.year;
                            const rowWrapper = $('<div class="rym-match-row"></div>');
                            const linkBtn = $('<button class="rym-link-btn"></button>')
                                .text(`Link: ${match.title} [${match.type} (${match.year})]`)
                                .addClass(isYearMatch ? 'rym-year-match' : '');

                            const extBtn = $('<button class="rym-ext-btn" title="Open RYM page in new window">↗</button>');
                            extBtn.on('click', (e) => { e.preventDefault(); window.open(match.url, '_blank'); });

                            linkBtn.on('click', function(e) {
                                e.preventDefault();
                                if (linkBtn.hasClass('rym-success')) return;

                                linkBtn.text('⌛ Opening...').prop('disabled', true);
                                const plusBtn = row.find('span').filter(function() { return $(this).text().includes('\u2795') || $(this).text().includes('➕'); });

                                if (plusBtn.length) {
                                    plusBtn[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

                                    let pollIframe = setInterval(() => {
                                        const $iframe = $('#' + mbid + '-iframe');
                                        if ($iframe.length) {
                                            clearInterval(pollIframe);

                                            // SURGICAL HIDING: Hide ONLY the table and iframe being used for automation
                                            $iframe.addClass('rym-stealth-hide');
                                            $iframe.closest('table').addClass('rym-stealth-hide');

                                            $iframe.on('load', function() {
                                                const doc = this.contentDocument || this.contentWindow.document;
                                                let pollInput = setInterval(() => {
                                                    const urlInput = doc.querySelector('input[placeholder*="link"]');
                                                    if (urlInput) {
                                                        clearInterval(pollInput);
                                                        linkBtn.text('⌛ Pasting...');
                                                        urlInput.focus();
                                                        doc.execCommand('insertText', false, match.url);
                                                        urlInput.dispatchEvent(new Event('input', { bubbles: true }));
                                                        urlInput.dispatchEvent(new Event('change', { bubbles: true }));

                                                        let pollSubmit = setInterval(() => {
                                                            const submitBtn = doc.querySelector('button.submit, button.primary');
                                                            const rymRecognized = doc.querySelector('.external-link-item') || doc.body.innerText.toLowerCase().includes('rate your music');

                                                            if (submitBtn && !submitBtn.disabled && rymRecognized) {
                                                                clearInterval(pollSubmit);
                                                                linkBtn.text('⌛ Submitting...');
                                                                setTimeout(() => {
                                                                    submitBtn.click();
                                                                    linkBtn.text('✅ Linked').addClass('rym-success').prop('disabled', false);
                                                                }, 500);
                                                            }
                                                        }, 500);
                                                        setTimeout(() => clearInterval(pollSubmit), 15000);
                                                    }
                                                }, 500);
                                                setTimeout(() => clearInterval(pollInput), 15000);
                                            });
                                        }
                                    }, 200);
                                    setTimeout(() => clearInterval(pollIframe), 10000);
                                }
                            });

                            rowWrapper.append(linkBtn).append(extBtn);
                            rgLink.closest('td').append(rowWrapper);
                        });
                    });
                } catch(e) { alert("Invalid RYM JSON."); }
            });
        };
        injectUI();
    }
})();
