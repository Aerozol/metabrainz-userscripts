// ==UserScript==
// @name MusicBrainz Hide Streaming Link Edits
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Adds a button to filter relationship and URL edits (e.g. streaming links) out of MusicBrainz edit history pages.
// @version      1
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Hide%20Relationship%20Edits.user.js
// @updateURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20Hide%20Relationship%20Edits.user.js
// @license      MIT
// @author       Gemini
// @match        *://*.musicbrainz.org/*/edits*
// @match        *://*.musicbrainz.org/*/open-edits*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // The arguments for the filter that excludes 'Add Relationship' (ID 90) and
    // 'Add URL' (ID 233) edit types. These are the most common for streaming links.
    const EXCLUDED_EDIT_TYPES = '90,233';

    // --- Utility Functions ---

    /**
     * Finds the existing "Refine this search" link. This link is critical
     * because its href contains the internal database ID (e.g., args.0=672107)
     * needed to filter edits by the specific entity.
     * @returns {HTMLAnchorElement | null}
     */
    function findRefineLink() {
        // Search all anchor tags within the page that link to the search form
        // and contain the text 'Refine this search' or 'Refine this search'.
        const allLinks = document.querySelectorAll('a[href*="search/edits"]');

        for (const link of allLinks) {
            // Check for the exact text content or strong text content
            if (link.textContent.trim().includes('Refine this search') || link.textContent.trim().includes('Refine this search')) {
                return link;
            }
        }
        return null;
    }

    /**
     * Determines the current filter state and builds the target URL for toggling the filter.
     * @param {string} currentHref The base URL provided by the 'Refine this search' link.
     * @returns {{targetHref: string, buttonText: string, isCurrentlyFiltered: boolean}}
     */
    function getTargetUrls(currentHref) {
        // Use the current page URL (window.location.href) for checking the existing state.
        const currentUrl = new URL(window.location.href);
        const params = currentUrl.searchParams;

        // Check if the relationship exclusion filter is already active.
        const isCurrentlyFiltered = params.get('conditions.1.field') === 'type' &&
                                   params.get('conditions.1.operator') === '!=' &&
                                   params.get('conditions.1.args') === EXCLUDED_EDIT_TYPES;

        let targetHref;
        let buttonText;
        const refineUrl = new URL(currentHref); // URL from the Refine link

        if (isCurrentlyFiltered) {
            // State: Currently filtered -> Action: Remove filter
            buttonText = 'Show All Relationship Edits';

            // Start with the Refine link's URL (which has the correct conditions.0.* entity filter)
            const urlToModifyBack = new URL(refineUrl.href);

            // 1. Remove the 'form_only=yes' parameter, which is specific to the link, not the final search result.
            urlToModifyBack.searchParams.delete('form_only');

            // 2. The URL now acts as the correct un-filtered, entity-specific edit search link.
            targetHref = urlToModifyBack.href;

        } else {
            // State: Not filtered -> Action: Apply filter
            buttonText = 'Hide Relationship Edits';

            const urlToModify = new URL(currentHref);

            // 1. Clean up: Remove the 'form_only=yes' parameter if present.
            urlToModify.searchParams.delete('form_only');

            // 2. Add our exclusion filter (conditions.1.*)
            urlToModify.searchParams.set('conditions.1.field', 'type');
            urlToModify.searchParams.set('conditions.1.operator', '!='); // Will be encoded to %21%3D
            urlToModify.searchParams.set('conditions.1.args', EXCLUDED_EDIT_TYPES); // '90,233'

            // 3. Add the required final parameter to match the desired final URL state.
            urlToModify.searchParams.set('field', 'Please choose a condition'); // Will be encoded to Please+choose+a+condition

            targetHref = urlToModify.href;
        }

        return { targetHref, buttonText, isCurrentlyFiltered };
    }

    // --- Main Execution ---

    const refineLink = findRefineLink();

    if (!refineLink) {
        // If the 'Refine this search' link is not found, we cannot generate the correct URL.
        console.log('MusicBrainz Hide Relationship Edits: Could not find "Refine this search" link.');
        return;
    }

    // Get the base URL from the refine link (which contains the entity ID filter)
    const currentHref = refineLink.href;
    const { targetHref, buttonText, isCurrentlyFiltered } = getTargetUrls(currentHref);

    // Create the quick-filter button template.
    const filterButtonTemplate = document.createElement('a');
    filterButtonTemplate.href = targetHref;
    filterButtonTemplate.textContent = buttonText;
    filterButtonTemplate.classList.add('btn', 'btn-mini'); // Use btn-mini for better fit next to the submit button

    // Add styling based on the current state, using standard MB button classes
    if (isCurrentlyFiltered) {
        filterButtonTemplate.classList.add('filter-active', 'btn-danger'); // Use red/danger style when filter is active
    } else {
        filterButtonTemplate.classList.add('filter-inactive', 'btn-success'); // Use green/success style when filter is available
    }


    // 1. Find all locations where the "Submit votes" button is located (top and bottom of the edit list).
    // This targets the specific container: div.align-right.row.no-label > span.buttons
    const submitButtonSpans = document.querySelectorAll('.align-right.row.no-label > span.buttons');

    if (submitButtonSpans.length > 0) {
        // Insert the button into every "buttons" span found.
        submitButtonSpans.forEach(span => {
            const filterButton = filterButtonTemplate.cloneNode(true);
            filterButton.style.marginRight = '10px'; // Add space before the 'Submit votes' button
            span.prepend(filterButton);
        });
    } else {
        // Fallback: Insert the button near the "Refine this search" link
        filterButtonTemplate.style.marginLeft = '10px';
        refineLink.parentNode.insertBefore(filterButtonTemplate, refineLink.nextSibling);
    }

})();
