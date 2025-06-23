// ==UserScript==
// @name         MusicBrainz RYM Link Checker
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Show if RYM releases/artists/labels/release-groups exist on MusicBrainz.
// @author       chatGPT
// @match        https://rateyourmusic.com/release/*
// @grant        GM_xmlhttpRequest
// @connect      musicbrainz.org
// ==/UserScript==

;(() => {
  const MB_API = "https://musicbrainz.org/ws/2/"
  const DEBUG = true
  const CURRENT_RYM_URL = window.location.href.split("?")[0]
  const REQUEST_DELAY = 1100 // 1.1 seconds between requests to respect MB rate limit

  // Cache to store results and prevent duplicate API calls
  const cache = new Map()
  const pendingRequests = new Map()

  // Request queue for rate limiting
  const requestQueue = []
  let isProcessingQueue = false

  function log(...args) {
    if (DEBUG) console.log("[MB]", ...args)
  }

  // Process the request queue with rate limiting
  function processRequestQueue() {
    if (isProcessingQueue || requestQueue.length === 0) {
      return
    }

    isProcessingQueue = true

    const processNext = () => {
      if (requestQueue.length === 0) {
        isProcessingQueue = false
        return
      }

      const request = requestQueue.shift()
      request.execute()

      // Schedule next request after delay
      setTimeout(processNext, REQUEST_DELAY)
    }

    processNext()
  }

  // Add request to queue
  function queueRequest(requestFunction) {
    requestQueue.push({ execute: requestFunction })
    processRequestQueue()
  }

  // Create loading indicator
  function createLoadingIcon() {
    const a = document.createElement("a")
    a.textContent = " ⏳"
    a.title = "Searching MusicBrainz..."
    a.style.marginLeft = "0.25em"
    a.style.textDecoration = "none"
    a.style.fontSize = "0.9em"
    a.style.color = "#666"
    return a
  }

  // Create icon with optional click handler for artists to seed RYM URL
  function createIconWithClick(found, mbUrl, name, rymUrlToCheck, isArtist = false, entityType = "artist") {
    const a = document.createElement("a")
    a.textContent = found ? " ✅" : " ❌"
    a.title = found
      ? `Linked to this RYM page`
      : isArtist
        ? `Not linked to this RYM page; click to seed RYM link on MB artist`
        : `Not linked to this RYM page; click to search on MusicBrainz`
    a.style.marginLeft = "0.25em"
    a.style.textDecoration = "none"
    a.style.fontSize = "0.9em"
    a.style.color = found ? "green" : "gray"
    a.target = "_blank"

    if (found) {
      if (mbUrl) a.href = mbUrl
    } else {
      if (isArtist && mbUrl) {
        a.href = "javascript:void(0)"
        a.style.cursor = "pointer"
        a.addEventListener("click", (e) => {
          e.preventDefault()
          const mbArtistEditUrl = mbUrl + "/edit"

          const win = window.open(mbArtistEditUrl, "_blank")
          if (win) {
            win.focus()
          } else {
            alert(
              `Popup blocked! Please open manually:\n${mbArtistEditUrl}\n\nAnd add this URL as an external link:\n${rymUrlToCheck}`,
            )
          }
        })
      } else {
        // For others, link to search
        // Fix release-group search type for MusicBrainz
        const searchType = entityType === "release-group" ? "release_group" : entityType
        a.href = `https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=${searchType}&method=indexed`
      }
    }
    return a
  }

  // Create not applicable icon
  function createNotApplicableIcon(reason = "special artist entity") {
    const a = document.createElement("a")
    a.textContent = " ➖"
    a.title = reason
    a.style.marginLeft = "0.25em"
    a.style.textDecoration = "none"
    a.style.fontSize = "0.9em"
    a.style.color = "#999"
    return a
  }

  // Fetch MB entity with caching and rate limiting
  function fetchEntityWithRYMLinkWithUrl(entityType, name, rymUrlToCheck, loadingIcon, callback) {
    const cacheKey = `${entityType}:${name}:${rymUrlToCheck}`

    // Check if we already have this result cached
    if (cache.has(cacheKey)) {
      log("Using cached result for", entityType, name)
      const result = cache.get(cacheKey)
      callback(result.found, result.mbUrl)
      return
    }

    // Check if there's already a pending request for this exact query
    if (pendingRequests.has(cacheKey)) {
      log("Request already pending for", entityType, name, "- adding to queue")
      pendingRequests.get(cacheKey).push(callback)
      return
    }

    // Create new request and add to pending
    pendingRequests.set(cacheKey, [callback])

    // Queue the actual API request
    queueRequest(() => {
      const searchUrl = `${MB_API}${entityType}/?query=${encodeURIComponent(name)}&fmt=json&limit=1`
      log("Searching MusicBrainz for", entityType, name, "→", searchUrl)

      GM_xmlhttpRequest({
        method: "GET",
        url: searchUrl,
        onload: (response) => {
          try {
            const data = JSON.parse(response.responseText)
            const entityKey = entityType === "release-group" ? "release-groups" : `${entityType}s`
            const match = data[entityKey] && data[entityKey][0]

            if (!match) {
              log("No MB entity found for", name)
              const result = { found: false, mbUrl: null }
              cache.set(cacheKey, result)

              // Call all pending callbacks
              const callbacks = pendingRequests.get(cacheKey)
              pendingRequests.delete(cacheKey)
              callbacks.forEach((cb) => cb(result.found, result.mbUrl))
              return
            }

            const mbid = match.id
            const mbUrl = `https://musicbrainz.org/${entityType}/${mbid}`

            log("Found MB entity, now checking URL relationships for", name)

            // Queue the second request for URL relationships
            queueRequest(() => {
              const detailUrl = `${MB_API}${entityType}/${mbid}?inc=url-rels&fmt=json`
              GM_xmlhttpRequest({
                method: "GET",
                url: detailUrl,
                onload: (detailResponse) => {
                  try {
                    const details = JSON.parse(detailResponse.responseText)
                    const urls = details.relations || []
                    const hasRym = urls.some(
                      (rel) =>
                        rel.url && rel.url.resource && rel.url.resource.toLowerCase() === rymUrlToCheck.toLowerCase(),
                    )

                    const result = { found: hasRym, mbUrl: mbUrl }
                    cache.set(cacheKey, result)

                    // Call all pending callbacks
                    const callbacks = pendingRequests.get(cacheKey)
                    pendingRequests.delete(cacheKey)
                    callbacks.forEach((cb) => cb(result.found, result.mbUrl))
                  } catch (e) {
                    log("Error parsing entity details:", e)
                    const result = { found: false, mbUrl: mbUrl }
                    cache.set(cacheKey, result)

                    const callbacks = pendingRequests.get(cacheKey)
                    pendingRequests.delete(cacheKey)
                    callbacks.forEach((cb) => cb(result.found, result.mbUrl))
                  }
                },
              })
            })
          } catch (e) {
            log("Error parsing search response:", e)
            const result = { found: false, mbUrl: null }
            cache.set(cacheKey, result)

            const callbacks = pendingRequests.get(cacheKey)
            pendingRequests.delete(cacheKey)
            callbacks.forEach((cb) => cb(result.found, result.mbUrl))
          }
        },
      })
    })
  }

  // NEW: Check release group (album title at top)
  function checkReleaseGroup() {
    const albumTitleDiv = document.querySelector(".album_title")
    if (!albumTitleDiv) {
      log("No album title found")
      return
    }

    // Extract the album title (everything before the year and input field)
    const titleText = albumTitleDiv.childNodes[0].textContent.trim()
    const albumTitle = titleText.replace(/\s+\d{4}\s*$/, "").trim() // Remove year at the end

    if (!albumTitle) {
      log("Could not extract album title")
      return
    }

    log("Release group title:", albumTitle)

    // Add loading icon immediately
    const loadingIcon = createLoadingIcon()
    albumTitleDiv.appendChild(loadingIcon)

    fetchEntityWithRYMLinkWithUrl("release-group", albumTitle, CURRENT_RYM_URL, loadingIcon, (linked, mbUrl) => {
      // Replace loading icon with result
      albumTitleDiv.removeChild(loadingIcon)
      albumTitleDiv.appendChild(createIconWithClick(linked, mbUrl, albumTitle, CURRENT_RYM_URL, false, "release-group"))
    })
  }

  // Check release title against MB release with link back to current page URL
  function checkRelease() {
    const titleElem = document.querySelector("h1.entity_title")
    if (!titleElem) {
      log("No release title found")
      return
    }
    const releaseTitle = titleElem.textContent.trim()
    log("Release title:", releaseTitle)

    // Add loading icon immediately for release
    const loadingIcon = createLoadingIcon()
    titleElem.appendChild(loadingIcon)

    fetchEntityWithRYMLinkWithUrl("release", releaseTitle, CURRENT_RYM_URL, loadingIcon, (linked, mbUrl) => {
      // Replace loading icon with result
      titleElem.removeChild(loadingIcon)
      titleElem.appendChild(createIconWithClick(linked, mbUrl, releaseTitle, CURRENT_RYM_URL, false, "release"))
    })
  }

  // Check main artist field in the info table
  function checkMainArtist() {
    // Look for the artist in the info table
    const artistCell = document.querySelector("tbody tr th.info_hdr")
    if (artistCell && artistCell.textContent.trim() === "Artist") {
      const artistLink = artistCell.parentElement.querySelector("td a.artist")
      if (artistLink) {
        const name = artistLink.textContent.trim()

        // Check if it's Various Artists
        if (name === "Various Artists") {
          log("Main artist is Various Artists - showing not applicable icon")
          artistLink.appendChild(createNotApplicableIcon("special artist entity"))
          return
        }

        let artistRymUrl
        try {
          const artistHref = artistLink.getAttribute("href")
          if (artistHref) {
            artistRymUrl = new URL(artistHref, window.location.origin).href.split("?")[0]
          }
        } catch (e) {
          artistRymUrl = CURRENT_RYM_URL // fallback to page URL if error
        }

        log("Main artist:", name, "checking against RYM URL:", artistRymUrl)

        // Add loading icon immediately
        const loadingIcon = createLoadingIcon()
        artistLink.appendChild(loadingIcon)

        fetchEntityWithRYMLinkWithUrl("artist", name, artistRymUrl, loadingIcon, (linked, mbUrl) => {
          // Replace loading icon with result
          artistLink.removeChild(loadingIcon)
          const icon = createIconWithClick(linked, mbUrl, name, artistRymUrl, true, "artist")
          artistLink.appendChild(icon)
        })
      }
    }
  }

  // Check secondary artists and classifiers in the artist field
  function checkSecondaryArtistsAndClassifiers() {
    // Look for items in the release_info_classifiers span
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    if (classifiersSpan) {
      // Check classifiers (like "Footmahi") - show N/A icon
      const classifierLinks = classifiersSpan.querySelectorAll('a[href*="/classifiers/"]')
      classifierLinks.forEach((link) => {
        const name = link.textContent.trim()
        if (!name) return

        log("Classifier:", name, "- showing not applicable icon")
        link.appendChild(createNotApplicableIcon("classifiers not supported"))
      })
    }
  }

  // Check labels in the release_info_classifiers span
  function checkLabels() {
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    if (classifiersSpan) {
      const labelLinks = classifiersSpan.querySelectorAll('a[href*="/label/"]')
      labelLinks.forEach((link, index) => {
        const name = link.textContent.trim()
        if (!name) return

        log("Label:", name, "checking against RYM URL:", CURRENT_RYM_URL)

        // Add loading icon immediately
        const loadingIcon = createLoadingIcon()
        link.appendChild(loadingIcon)

        fetchEntityWithRYMLinkWithUrl("label", name, CURRENT_RYM_URL, loadingIcon, (linked, mbUrl) => {
          // Replace loading icon with result
          link.removeChild(loadingIcon)
          const icon = createIconWithClick(linked, mbUrl, name, CURRENT_RYM_URL, false, "label")
          link.appendChild(icon)
        })
      })
    }
  }

  // Check featured artists in tracklist
  function checkFeaturedArtists() {
    const featuredCredits = document.querySelectorAll(".featured_credit a.artist")
    featuredCredits.forEach((link, index) => {
      const name = link.textContent.trim()
      if (!name) return

      let artistRymUrl
      try {
        const artistHref = link.getAttribute("href")
        if (artistHref) {
          artistRymUrl = new URL(artistHref, window.location.origin).href.split("?")[0]
        }
      } catch (e) {
        artistRymUrl = CURRENT_RYM_URL // fallback to page URL if error
      }

      log("Featured artist:", name, "checking against RYM URL:", artistRymUrl)

      // Add loading icon immediately
      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      fetchEntityWithRYMLinkWithUrl("artist", name, artistRymUrl, loadingIcon, (linked, mbUrl) => {
        // Replace loading icon with result
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(linked, mbUrl, name, artistRymUrl, true, "artist")
        link.appendChild(icon)
      })
    })
  }

  // Check artist anchors with their individual RYM URLs against MB artists
  function checkArtists(selector, label) {
    const artists = document.querySelectorAll(selector)
    if (artists.length === 0) {
      log(`No ${label} artists found for selector: ${selector}`)
    }
    artists.forEach((link, index) => {
      const name = link.textContent.trim()
      if (!name) return

      let artistRymUrl
      try {
        const artistHref = link.getAttribute("href")
        if (artistHref) {
          artistRymUrl = new URL(artistHref, window.location.origin).href.split("?")[0]
        }
      } catch (e) {
        artistRymUrl = CURRENT_RYM_URL // fallback to page URL if error
      }

      log(`${label} artist:`, name, "checking against RYM URL:", artistRymUrl)

      // Add loading icon immediately
      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      fetchEntityWithRYMLinkWithUrl("artist", name, artistRymUrl, loadingIcon, (linked, mbUrl) => {
        // Replace loading icon with result
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(linked, mbUrl, name, artistRymUrl, true, "artist")
        link.appendChild(icon)
      })
    })
  }

  function run() {
    checkReleaseGroup() // NEW: Check release group at top
    checkRelease()
    checkMainArtist()
    checkSecondaryArtistsAndClassifiers() // UPDATED: Now handles classifiers with N/A icon
    checkLabels()
    checkFeaturedArtists()
    checkArtists(".release_pri_artists a", "primary")
    checkArtists(".tracklist_line a.artist", "tracklist")
  }

  setTimeout(run, 1500)
})()
