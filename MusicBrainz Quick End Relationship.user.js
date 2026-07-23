// ==UserScript==
// @name         MusicBrainz Quick End Relationship
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Clicking the external link (x) cycles through "ended" -> "removed" -> "undo" states, instead of just removing.
// @version      1.1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20End%20Relationship.user.js
// @updateURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Quick%20End%20Relationship.user.js
// @license      MIT
// @author       Antigravity
// @match        *://musicbrainz.org/*
// @match        *://beta.musicbrainz.org/*
// @match        *://test.musicbrainz.org/*
// @run-at       document-start
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// ==/UserScript==

(function () {
    'use strict';

    console.log("[Relationship Ender] Script loaded on Release Editor");

    // Global state
    const rowStates = new Map(); // Store state by generated unique key
    let isProcessing = false;
    let bypassing = false;

    // Inject styles for loading state & stealth modal hiding
    function injectStyles() {
        if (document.head && !document.getElementById('relationship-ender-style')) {
            const style = document.createElement('style');
            style.id = 'relationship-ender-style';
            style.textContent = `
                .relationship-ender-processing {
                    cursor: wait !important;
                }
                .relationship-ender-processing * {
                    pointer-events: none !important;
                }
                .relationship-ender-loading {
                    opacity: 0.5 !important;
                }
                .relationship-ender-hide-dialog #external-link-relationship-dialog,
                .relationship-ender-hide-dialog [data-floating-ui-portal]:has(#external-link-relationship-dialog) {
                    opacity: 0 !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                }
            `;
            document.head.appendChild(style);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    // Helper to get React props from a DOM element
    function getReactProps(el) {
        if (!el) return null;
        const key = Object.keys(el).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
        if (!key) return null;
        const fiber = el[key];
        if (key.startsWith('__reactFiber$')) {
            return fiber.memoizedProps || fiber.pendingProps || fiber.stateNode?.props;
        }
        return fiber;
    }

    // Check if relationship is natively ended
    function isRowNativelyEnded(row) {
        const text = row.textContent.toLowerCase();
        if (text.includes('ended')) return true;

        try {
            const props = getReactProps(row);
            if (props) {
                if (props.relationship && props.relationship.ended) return true;
                if (props.ended) return true;
            }
        } catch (e) {
            // Silent catch
        }
        return false;
    }

    // Get sibling relationship rows for a given URL row
    function getRelationshipRows(urlRow) {
        const relRows = [];
        let next = urlRow.nextElementSibling;
        while (next && !next.classList.contains('external-link-item')) {
            if (next.classList.contains('relationship-item') || 
                next.querySelector('button.edit-item') || 
                next.querySelector('.relationship-content') ||
                next.querySelector('.link-type')) {
                relRows.push(next);
            }
            next = next.nextElementSibling;
        }
        return relRows;
    }

    // Get row type ('url' or 'relationship')
    function getRowType(row) {
        if (row.classList.contains('external-link-item')) return 'url';
        if (row.classList.contains('relationship-item') || row.querySelector('button.edit-item')) return 'relationship';
        return null;
    }

    // Unique key generator for rows to handle element recreation
    function getRowKey(row) {
        if (row.classList.contains('external-link-item')) {
            const urlAnchor = row.querySelector('a.url');
            return `url:${urlAnchor ? urlAnchor.href : row.id}`;
        }
        if (row.classList.contains('relationship-item') || row.querySelector('button.edit-item')) {
            // Find parent URL row
            let prev = row.previousElementSibling;
            while (prev && !prev.classList.contains('external-link-item')) {
                prev = prev.previousElementSibling;
            }
            if (!prev) return null;
            const urlKey = getRowKey(prev);
            
            // Find index of this relationship row under the URL row
            let index = 0;
            let sib = prev.nextElementSibling;
            while (sib && sib !== row) {
                if (sib.classList.contains('relationship-item') || sib.querySelector('button.edit-item')) {
                    index++;
                }
                sib = sib.nextElementSibling;
            }
            return `${urlKey}:rel:${index}`;
        }
        return null;
    }

    // Determine initial state of row
    function getInitialState(row) {
        const removeBtn = row.querySelector('.remove-item, [title*="Remove"], [title*="remove"], [title*="Delete"], [title*="delete"]');
        const hasUndo = removeBtn && (
            removeBtn.title.toLowerCase().includes('undo') || 
            removeBtn.classList.contains('undo')
        );
        const hasDeletedClass = row.classList.contains('deleted') || 
                                row.classList.contains('removed') || 
                                row.style.textDecoration === 'line-through';
                                
        if (hasUndo || hasDeletedClass) {
            return 2; // Deleted
        }

        const rowType = getRowType(row);
        if (rowType === 'relationship') {
            return isRowNativelyEnded(row) ? 1 : 0;
        }
        if (rowType === 'url') {
            const relRows = getRelationshipRows(row);
            if (relRows.length > 0 && relRows.every(r => isRowNativelyEnded(r))) {
                return 1; // Ended
            }
            return 0; // Active
        }
        return 0;
    }

    // Wait for DOM element
    async function waitForElement(selector, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            
            const startTime = Date.now();
            const interval = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) {
                    clearInterval(interval);
                    resolve(el);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Timeout waiting for selector: ${selector}`));
                }
            }, 50);
        });
    }

    // Wait for DOM element to disappear
    async function waitForElementToDisappear(selector, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const el = document.querySelector(selector);
                if (!el) {
                    clearInterval(interval);
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Timeout waiting for selector to disappear: ${selector}`));
                }
            }, 50);
        });
    }

    // Open relationship edit modal, set ended state, and save
    async function setRowEndedState(row, targetEnded) {
        const editBtn = row.querySelector('button.edit-item');
        if (!editBtn) {
            throw new Error("Edit button not found in relationship row");
        }
        
        editBtn.click();
        
        const dialog = await waitForElement('#external-link-relationship-dialog');
        const checkbox = dialog.querySelector('input[name="period.ended"], #id-period\\.ended');
        if (!checkbox) {
            throw new Error("Ended checkbox not found in relationship dialog");
        }
        
        if (checkbox.checked !== targetEnded) {
            checkbox.click();
        }
        
        const doneBtn = dialog.querySelector('form.external-link-relationship-dialog button.positive, form.external-link-relationship-dialog button[type="submit"]');
        if (!doneBtn) {
            throw new Error("Done/Submit button not found in relationship dialog");
        }
        doneBtn.click();
        
        await waitForElementToDisappear('#external-link-relationship-dialog');
    }

    // Set ended state for multiple relationship rows sequentially
    async function setMultipleRowsEndedState(rows, targetEnded) {
        for (const row of rows) {
            try {
                await setRowEndedState(row, targetEnded);
            } catch (e) {
                console.error("[Relationship Ender] Error setting row ended state:", e);
            }
        }
    }

    // Set UI loading state & stealth modal hiding
    function setProcessing(processing, targetElement = null) {
        isProcessing = processing;
        const container = document.querySelector('.external-links-editor-container') || document.body;
        if (processing) {
            container.classList.add('relationship-ender-processing');
            document.body.classList.add('relationship-ender-hide-dialog');
            document.documentElement.classList.add('relationship-ender-hide-dialog');
            if (targetElement) targetElement.classList.add('relationship-ender-loading');
        } else {
            container.classList.remove('relationship-ender-processing');
            document.body.classList.remove('relationship-ender-hide-dialog');
            document.documentElement.classList.remove('relationship-ender-hide-dialog');
            document.querySelectorAll('.relationship-ender-loading').forEach(el => el.classList.remove('relationship-ender-loading'));
        }
    }

    // Trigger native click on button bypassing our interceptor
    function triggerNativeClick(button) {
        bypassing = true;
        const eventTypes = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
        eventTypes.forEach(type => {
            try {
                if (type.startsWith('pointer')) {
                    button.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
                } else {
                    button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
                }
            } catch (e) {
                button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
            }
        });
        bypassing = false;
    }

    // State machine click handler
    async function handleRemoveClick(button) {
        if (isProcessing) return;
        
        const row = button.closest('tr');
        if (!row) return;
        
        const rowType = getRowType(row);
        if (!rowType) return;
        
        const key = getRowKey(row);
        if (!key) return;
        
        // Get or sync current state
        let currentState = rowStates.get(key);
        const actualState = getInitialState(row);
        if (currentState === undefined) {
            currentState = actualState;
        } else if (actualState === 2) {
            currentState = 2; // Natively deleted state overrides tracked state
        }
        
        setProcessing(true, button);
        
        try {
            if (rowType === 'relationship') {
                if (currentState === 0) {
                    await setRowEndedState(row, true);
                    rowStates.set(key, 1);
                    console.log(`[Relationship Ender] Marked relationship as ended: ${key}`);
                } else if (currentState === 1) {
                    await setRowEndedState(row, false);
                    rowStates.set(key, 2);
                    console.log(`[Relationship Ender] Marked relationship as deleted: ${key}`);
                    triggerNativeClick(button);
                } else if (currentState === 2) {
                    rowStates.set(key, 0);
                    console.log(`[Relationship Ender] Restored relationship: ${key}`);
                    triggerNativeClick(button);
                }
            } else if (rowType === 'url') {
                const relRows = getRelationshipRows(row);
                
                if (currentState === 0) {
                    if (relRows.length > 0) {
                        await setMultipleRowsEndedState(relRows, true);
                        rowStates.set(key, 1);
                        console.log(`[Relationship Ender] Marked all relationships as ended for URL: ${key}`);
                    } else {
                        rowStates.set(key, 2);
                        console.log(`[Relationship Ender] Deleted URL directly: ${key}`);
                        triggerNativeClick(button);
                    }
                } else if (currentState === 1) {
                    if (relRows.length > 0) {
                        await setMultipleRowsEndedState(relRows, false);
                    }
                    rowStates.set(key, 2);
                    console.log(`[Relationship Ender] Marked URL and relationships as deleted: ${key}`);
                    triggerNativeClick(button);
                } else if (currentState === 2) {
                    rowStates.set(key, 0);
                    console.log(`[Relationship Ender] Restored URL and relationships: ${key}`);
                    triggerNativeClick(button);
                }
            }
        } catch (e) {
            console.error("[Relationship Ender] State transition error:", e);
        } finally {
            setProcessing(false);
        }
    }

// Intercept clicks on remove-item buttons in capture phase (ONLY within External Links)
const interceptEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
interceptEvents.forEach(eventType => {
    document.addEventListener(eventType, function (e) {
        // 1. Ensure the click originated inside the external links container
        const container = e.target.closest('.external-links-editor-container');
        if (!container) return;

        // 2. Locate the remove button inside this container
        const button = e.target.closest('.remove-item, [title*="Remove"], [title*="remove"], [title*="Delete"], [title*="delete"], button.nobutton.icon');
        if (bypassing) return;
        if (!button) return;

        // Prevent MusicBrainz from executing its native handlers
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        // Execute state machine on 'click' event
        if (eventType === 'click') {
            handleRemoveClick(button);
        }
    }, true);
});

})();
