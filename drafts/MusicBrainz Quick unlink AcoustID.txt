// ==UserScript==
// @name         MusicBrainz Quick unlink AcoustID
// @description  Bulk unlink mis-matched AcoustID fingerprints in MusicBrainz.
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @version      0.1
// @downloadURL  https://github.com/Aerozol/metabrainz-userscripts/raw/refs/heads/main/drafts/MusicBrainz%20Quick%20unlink%20AcoustID.user.js
// @updateURL  https://github.com/Aerozol/metabrainz-userscripts/raw/refs/heads/main/drafts/MusicBrainz%20Quick%20unlink%20AcoustID.user.js
// @license      MIT
// @author       Gemini
// @match        http*://*.musicbrainz.org/recording/*/fingerprints*
// @match        http*://musicbrainz.org/recording/*/fingerprints*
// @connect      acoustid.org
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

'use strict';

const parseHTML = (htmlString) => {
    const parser = new DOMParser();
    return parser.parseFromString(htmlString, 'text/html');
};

function customFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: options.method || 'GET',
            url: url,
            data: options.body,
            headers: options.headers,
            onload: (response) => {
                if (response.status >= 200 && response.status < 400) {
                    resolve({
                        ok: true,
                        status: response.status,
                        finalUrl: response.finalUrl || url,
                        text: () => Promise.resolve(response.responseText)
                    });
                } else {
                    reject(new Error(`Server responded with status code: ${response.status}`));
                }
            },
            onerror: (err) => reject(err)
        });
    });
}

async function processBackgroundUnlinkQueue(urls, button) {
    let completedCount = 0;
    const totalCount = urls.length;

    console.log(`%c[AcoustID Bulk Unlink] Initiating background processing queue for ${totalCount} links.`, 'color: #00ff00; font-weight: bold;');

    for (const url of urls) {
        completedCount++;
        button.value = `Processing... (${completedCount}/${totalCount})`;

        const trackIdMatch = url.match(/track_gid=([a-f0-9-]+)/);
        const trackId = trackIdMatch ? trackIdMatch[1].substring(0, 8) : 'unknown';

        console.log(`%c[Step ${completedCount}/${totalCount}] Querying details for AcoustID track: ${trackId}...`, 'color: #00ccff;');

        try {
            const getResponse = await customFetch(url);

            if (getResponse.finalUrl && getResponse.finalUrl.includes('/login')) {
                console.error(`%c[Auth Error] Redirected to login page while processing track: ${trackId}`, 'color: #ff0000; font-weight: bold;');
                alert(`🛑 AUTHENTICATION REQUIRED:\nYou are not logged into AcoustID.\n\nPlease open https://acoustid.org/ in a new tab, sign in, and try again.`);
                button.value = "Unlink Selected Fingerprints";
                button.disabled = false;
                return;
            }

            const htmlText = await getResponse.text();
            const doc = parseHTML(htmlText);

            if (htmlText.includes('Edit submitted') || doc.body.textContent.includes('Edit submitted')) {
                console.log(`%c[Success] Track ${trackId} was already successfully unlinked or queued.`, 'color: #00ff00;');
                continue;
            }

            const form = doc.querySelector('form');
            if (!form) {
                console.warn(`%c[Warning] Form layout not found for track ${trackId}. Checking text markers...`, 'color: #ffaa00;');
                continue;
            }

            const payload = new URLSearchParams();
            form.querySelectorAll('input, select, textarea').forEach(input => {
                if (input.type === 'submit' || input.type === 'button') return;
                if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) return;
                payload.append(input.name, input.value);
            });

            let actionUrl = form.getAttribute('action') || url;
            if (actionUrl.startsWith('/')) {
                actionUrl = `https://acoustid.org${actionUrl}`;
            }

            console.log(`%c[Step ${completedCount}/${totalCount}] Submitting Unlink POST request for track: ${trackId}...`, 'color: #ffaa00;');

            await customFetch(actionUrl, {
                method: 'POST',
                body: payload.toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://acoustid.org',
                    'Referer': getResponse.finalUrl
                }
            });

            console.log(`%c[Success] Track ${trackId} successfully unlinked!`, 'color: #00ff00; font-weight: bold;');

        } catch (error) {
            console.error(`%c[Queue Failure] Error handling track ${trackId}: ${error.message}`, 'color: #ff0000;');
            alert(`Error processing unlink for track (${trackId}): ${error.message}`);
            button.value = "Unlink Selected Fingerprints";
            button.disabled = false;
            return;
        }
    }

    button.value = "Success! All Unlinked";
    button.style.backgroundColor = "#cceeff";
    button.disabled = false;
    console.log('%c[AcoustID Bulk Unlink] Queue execution successfully complete!', 'color: #00ff00; font-weight: bold; font-size: 14px;');
}

function initUnlinkAutomation() {
    const targetTable = document.querySelector('.acoustid-fingerprints table.tbl');
    if (!targetTable) return;

    if (targetTable.dataset.bulkUnlinkInjected) return;
    targetTable.dataset.bulkUnlinkInjected = "true";

    const unlinkRows = Array.from(targetTable.querySelectorAll('tbody tr')).filter(row => {
        const actionLink = row.querySelector('td.actions a.external');
        return actionLink && actionLink.textContent.trim().toLowerCase() === 'unlink';
    });

    if (unlinkRows.length === 0) return;

    const headerRow = targetTable.querySelector('thead tr');
    if (headerRow) {
        const th = document.createElement('th');
        th.style.width = '30px';
        th.style.textAlign = 'center';
        const masterCheck = document.createElement('input');
        masterCheck.type = 'checkbox';
        masterCheck.checked = false; // Left unchecked by default per your selection preferences
        masterCheck.addEventListener('change', () => {
            targetTable.querySelectorAll('.acoustid-bulk-checkbox').forEach(cb => cb.checked = masterCheck.checked);
        });
        th.appendChild(masterCheck);
        headerRow.insertBefore(th, headerRow.firstChild);
    }

    unlinkRows.forEach(row => {
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'acoustid-bulk-checkbox';
        cb.checked = false; // Clear defaults
        const link = row.querySelector('td.actions a.external');
        if (link) {
            cb.dataset.url = link.href;
        }
        td.appendChild(cb);
        row.insertBefore(td, row.firstChild);
    });

    Array.from(targetTable.querySelectorAll('tbody tr')).forEach(row => {
        if (!unlinkRows.includes(row)) {
            const emptyTd = document.createElement('td');
            row.insertBefore(emptyTd, row.firstChild);
        }
    });

    let mainControlBtn = document.createElement('input');
    mainControlBtn.type = 'button';
    mainControlBtn.value = "Unlink Selected Fingerprints";
    mainControlBtn.style.cssText = 'margin: 15px 0; padding: 6px 12px; font-weight: bold; cursor: pointer; background-color: #f2f2f2; border: 1px solid #b3b3b3; border-radius: 4px;';

    mainControlBtn.addEventListener('click', () => {
        const selectedUrls = Array.from(targetTable.querySelectorAll('.acoustid-bulk-checkbox:checked'))
                                  .map(cb => cb.dataset.url)
                                  .filter(Boolean);

        if (selectedUrls.length === 0) {
            alert("Please select at least one row checkbox option to unlink.");
            return;
        }

        if (!confirm(`Are you sure you want to process and unlink all ${selectedUrls.length} selected AcoustID links in the background?`)) return;

        mainControlBtn.disabled = true;
        mainControlBtn.value = `Starting queue...`;

        processBackgroundUnlinkQueue(selectedUrls, mainControlBtn);
    });

    targetTable.parentNode.insertBefore(mainControlBtn, targetTable);
}

const contentBox = document.getElementById('content');
if (contentBox) {
    const observer = new MutationObserver((mutations, obs) => {
        const targetTable = document.querySelector('.acoustid-fingerprints table.tbl');
        if (targetTable) {
            initUnlinkAutomation();
            obs.disconnect();
        }
    });
    observer.observe(contentBox, { childList: true, subtree: true });
}