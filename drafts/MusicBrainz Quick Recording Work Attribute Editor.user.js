// ==UserScript==
// @name         MusicBrainz Quick Recording > Work Attribute Editor
// @description  Automatically sets the 'Cover' recording > work attribute from a work page
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @version      0.1
// @downloadURL  https://github.com/Aerozol/metabrainz-userscripts/raw/refs/heads/main/drafts/MusicBrainz%20Quick%20Recording%20Work%20Attribute%20Editor.user.js
// @updateURL  https://github.com/Aerozol/metabrainz-userscripts/raw/refs/heads/main/drafts/MusicBrainz%20Quick%20Recording%20Work%20Attribute%20Editor.user.js
// @license      MIT
// @author       Gemini
// @match        http*://*.musicbrainz.org/work/*
// @match        http*://*.musicbrainz.org/recording/*/edit*
// @connect      musicbrainz.org
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-end
// ==/UserScript==

'use strict';

const isWorkPage = window.location.pathname.startsWith('/work/');
const isRecordingEditPage = window.location.pathname.startsWith('/recording/') && window.location.pathname.endsWith('/edit');

let monitorPanel = null;
let logContainer = null;

function buildMonitorPanel() {
    if (monitorPanel) return;

    monitorPanel = document.createElement('div');
    monitorPanel.id = 'mb-interactive-monitor';
    // Adjusted back to a narrower width for a cleaner, unobtrusive workspace view
    monitorPanel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        width: 480px;
        height: calc(100vh - 40px);
        background: #222;
        border: 2px solid #444;
        border-radius: 6px;
        box-shadow: -4px 4px 15px rgba(0,0,0,0.6);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'background: #333; color: #fff; padding: 8px; font-family: sans-serif; font-size: 12px; font-weight: bold; border-bottom: 1px solid #555;';
    header.innerText = '🎵 MB Quick Cover: Automation Monitor';
    monitorPanel.appendChild(header);

    logContainer = document.createElement('div');
    logContainer.style.cssText = 'height: 120px; background: #111; color: #0f0; font-family: monospace; font-size: 11px; padding: 8px; overflow-y: auto; border-bottom: 1px solid #444; white-space: pre-wrap;';
    logContainer.innerText = '[System] System Ready. Click "Set Cover" on an album row below.\n';
    monitorPanel.appendChild(logContainer);

    const frameWrapper = document.createElement('div');
    frameWrapper.style.cssText = 'flex-grow: 1; background: #fff; position: relative;';

    const framePlaceholder = document.createElement('div');
    framePlaceholder.id = 'mb-frame-placeholder';
    framePlaceholder.style.cssText = 'position: absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#888; font-family:sans-serif; font-size:12px;';
    framePlaceholder.innerText = 'No active recording page loaded yet.';
    frameWrapper.appendChild(framePlaceholder);

    monitorPanel.appendChild(frameWrapper);
    document.body.appendChild(monitorPanel);
}

function appendLog(message, recMbid = '') {
    buildMonitorPanel();
    const timestamp = new Date().toLocaleTimeString();
    const prefix = recMbid ? `(${recMbid.substring(0,6)}) ` : '';
    logContainer.innerText += `[${timestamp}] ${prefix}${message}\n`;
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ==========================================
// WORK PAGE LOGIC
// ==========================================
if (isWorkPage) {
    GM_addValueChangeListener('visual_log_signal', (key, oldValue, newValue) => {
        if (newValue) appendLog(newValue.message, newValue.mbid);
    });

    window.setCoverAttributeInteractive = function(recordingMbid, workMbid, button) {
        buildMonitorPanel();

        const oldIframe = document.getElementById('mb-debug-frame');
        if (oldIframe) oldIframe.remove();

        const placeholder = document.getElementById('mb-frame-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        appendLog('Loading recording edit page inside automation workspace...', recordingMbid);

        const iframe = document.createElement('iframe');
        iframe.id = 'mb-debug-frame';
        iframe.src = `https://musicbrainz.org/recording/${recordingMbid}/edit`;
        iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

        const placeholderSibling = document.getElementById('mb-frame-placeholder');
        placeholderSibling.parentNode.appendChild(iframe);

        GM_setValue(`interact_action_${recordingMbid}`, {
            command: 'SET_COVER_DOM',
            workMbid: workMbid
        });

        button.value = 'Running...';

        const monitorTracker = setInterval(() => {
            const state = GM_getValue(`interact_status_${recordingMbid}`);
            if (state === 'COMPLETE') {
                button.value = 'Success!';
                button.style.backgroundColor = '#cceeff';
                clearInterval(monitorTracker);
                setTimeout(() => iframe.remove(), 2500);
            } else if (state === 'ERROR') {
                button.value = 'Failed';
                button.disabled = false;
                clearInterval(monitorTracker);
            }
        }, 500);
    };

    const workMbidMatch = window.location.pathname.match(/\/work\/([a-f0-9-]{36})/);
    if (workMbidMatch) {
        const workMbid = workMbidMatch[1];
        document.querySelectorAll('table.tbl a[href*="/recording/"]').forEach(link => {
            if (link.pathname.split('/').filter(Boolean).length !== 2) return;
            const mbid = link.href.match(/\/recording\/([a-f0-9-]{36})/)[1];

            const btn = document.createElement('input');
            btn.type = 'button';
            btn.value = 'Set Cover';
            btn.style.cssText = 'margin-left:10px;padding:1px 4px;font-size:0.8em;cursor:pointer;background-color:#fff;border:1px solid #ccc;border-radius:3px;';
            btn.onclick = () => window.setCoverAttributeInteractive(mbid, workMbid, btn);

            link.parentNode.insertBefore(btn, link.nextSibling);
        });
    }
}

// ==========================================
// VISIBLE RECORDING EDIT PAGE FRAME CONTEXT
// ==========================================
if (isRecordingEditPage && window.self !== window.top) {
    const mbidMatch = window.location.pathname.match(/\/recording\/([a-f0-9-]{36})/);
    if (mbidMatch) {
        const recMbid = mbidMatch[1];
        const instruction = GM_getValue(`interact_action_${recMbid}`);

        if (instruction && instruction.command === 'SET_COVER_DOM') {
            GM_setValue(`interact_action_${recMbid}`, null);
            GM_setValue(`interact_status_${recMbid}`, 'PROCESSING');

            const postLog = (msg) => GM_setValue('visual_log_signal', { mbid: recMbid, message: msg, ts: Date.now() });
            const wait = (ms) => new Promise(r => setTimeout(r, ms));

            postLog("Recording edit layout mounted inside workspace container.");

            const runDOMSequence = async () => {
                try {
                    postLog("Waiting for target Work row link definitions to populate...");

                    let targetLink = null;
                    for (let i = 0; i < 50; i++) {
                        targetLink = document.querySelector(`a[href*="/work/${instruction.workMbid}"]`);
                        if (targetLink) break;
                        await wait(500);
                    }

                    if (!targetLink) throw new Error("Timeout waiting for specific Work row link element mapping profile.");

                    const parentContainer = targetLink.closest('div.relationship-item, td, tr');
                    const targetPencil = parentContainer?.querySelector('button.edit-item, button[id^="edit-relationship-"]');

                    if (!targetPencil) throw new Error("Could not find row editing pencil selector.");

                    targetPencil.scrollIntoView({ block: 'center' });
                    await wait(600);

                    postLog(`[DOM ACTION] Clicking relationship pencil icon: #${targetPencil.id}`);
                    targetPencil.click();

                    postLog("Waiting for the attribute modal dialogue panel to load...");
                    let coverCheckbox = null;

                    for (let i = 0; i < 25; i++) {
                        coverCheckbox = document.getElementById('cover-checkbox');
                        if (coverCheckbox) break;
                        await wait(500);
                    }

                    if (!coverCheckbox) throw new Error("Failed to pinpoint target attribute checkbox matching '#cover-checkbox'.");

                    if (coverCheckbox.checked) {
                        postLog("The cover attribute flag option is already checked on this row.");
                    } else {
                        postLog("[DOM ACTION] Clicking the '#cover-checkbox' option control element...");
                        coverCheckbox.click();
                        await wait(300);
                    }

                    postLog(`Verification readback state: checked = ${coverCheckbox.checked}`);

                    postLog("[DOM ACTION] Finding and clicking the dialogue 'Done' control button explicitly...");
                    const allButtons = Array.from(document.querySelectorAll('button'));
                    const doneButton = allButtons.find(b => b.textContent.trim() === 'Done');

                    if (!doneButton) {
                        throw new Error("Could not find button layout element containing the explicit text label 'Done'.");
                    }

                    doneButton.click();
                    await wait(1000);

                    postLog("Writing automated annotation description data inside the Edit Note field...");
                    const editNoteBox = document.querySelector('textarea[name*="edit_note"], textarea[id*="edit-note"]');
                    if (editNoteBox) {
                        // Custom edit note statement block applied per user specifications
                        editNoteBox.value = "Cover attribute set by 'MusicBrainz Quick Recording > Work Attribute Editor' userscript, see: https://github.com/Aerozol/metabrainz-userscripts";
                        editNoteBox.dispatchEvent(new Event('input', { bubbles: true }));
                        editNoteBox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    await wait(800);

                    const finalSubmitBtn = document.querySelector('button.submit.positive');
                    if (!finalSubmitBtn) throw new Error("Could not locate the final validation 'button.submit.positive' ('🐘 Enter edit') action node.");

                    postLog("[DOM ACTION] Pressing final form edit submit button.");
                    finalSubmitBtn.click();

                    postLog("Submission successfully complete.");
                    GM_setValue(`interact_status_${recMbid}`, 'COMPLETE');

                } catch (error) {
                    postLog(`ERROR DETECTED: ${error.message}`);
                    GM_setValue(`interact_status_${recMbid}`, 'ERROR');
                }
            };

            setTimeout(runDOMSequence, 1000);
        }
    }
}