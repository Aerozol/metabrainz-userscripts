// ==UserScript==
// @name         MusicBrainz RYM Link Checker
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @description  Show if RYM artists/labels/release-groups are linked from MusicBrainz.
// @version      3.2
// @downloadURL  https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20RYM%20Link%20Checker.user.js
// @updateURL    https://raw.githubusercontent.com/Aerozol/metabrainz-userscripts/master/MusicBrainz%20RYM%20Link%20Checker.user.js
// @license      MIT
// @author       chatGPT
// @match        https://rateyourmusic.com/release/*
// @match        https://rateyourmusic.com/artist/*
// @match        https://rateyourmusic.com/label/*
// @grant        GM_xmlhttpRequest
// @connect      musicbrainz.org
// ==/UserScript==

(function () {
  const MB_API = "https://musicbrainz.org/ws/2/"
  const REQUEST_DELAY = 1100 // 1.1 seconds between requests to respect MB rate limit
  const MAX_SEARCH_RESULTS = 5 // Check up to 5 results for matches

  // Enhanced caching system
  class EnhancedMBCache {
    constructor(name, version) {
      this.name = name
      this.version = version
      this.cache = new Map()
      this.pendingRequests = new Map()
      this.loadFromStorage()
    }

    loadFromStorage() {
      try {
        const stored = localStorage.getItem(`${this.name}_v${this.version}`)
        if (stored) {
          const data = JSON.parse(stored)
          this.cache = new Map(Object.entries(data))
          console.debug("Loaded cache from storage:", this.cache.size, "entries")
        }
      } catch (e) {
        console.error("Failed to load cache from storage:", e)
      }
    }

    saveToStorage() {
      try {
        const data = Object.fromEntries(this.cache)
        localStorage.setItem(`${this.name}_v${this.version}`, JSON.stringify(data))
        console.debug("Saved cache to storage:", this.cache.size, "entries")
      } catch (e) {
        console.error("Failed to save cache to storage:", e)
      }
    }

    get(key) {
      return this.cache.get(key)
    }

    set(key, value) {
      this.cache.set(key, value)
      this.saveToStorage()
    }

    has(key) {
      return this.cache.has(key)
    }
  }

  // Initialize enhanced cache
  const mbCache = new EnhancedMBCache("RYM_MBLINKS_CACHE", "3")

  // Request queue for rate limiting
  const requestQueue = []
  let isProcessingQueue = false

  // URL normalization functions
  function normalizeRYMUrl(url) {
    if (!url) return null

    try {
      // Remove query parameters and fragments
      let cleanUrl = url.split("?")[0].split("#")[0]

      // Ensure https
      cleanUrl = cleanUrl.replace(/^http:/, "https:")

      // Remove trailing slash
      cleanUrl = cleanUrl.replace(/\/$/, "")

      // Normalize case for path components (but preserve domain case)
      const urlObj = new URL(cleanUrl)
      urlObj.pathname = urlObj.pathname.toLowerCase()

      return urlObj.href
    } catch (e) {
      console.error("Failed to normalize URL:", url, e)
      return url
    }
  }

  function getCurrentRYMUrl() {
    return normalizeRYMUrl(window.location.href)
  }

  function getArtistRYMUrl(artistLink) {
    try {
      const href = artistLink.getAttribute("href")
      if (href) {
        const fullUrl = new URL(href, window.location.origin).href
        return normalizeRYMUrl(fullUrl)
      }
    } catch (e) {
      console.error("Failed to get artist RYM URL:", e)
    }
    return getCurrentRYMUrl() // fallback
  }

  function getReleaseRYMUrl(releaseLink) {
    try {
      const href = releaseLink.getAttribute("href")
      if (href) {
        const fullUrl = new URL(href, window.location.origin).href
        return normalizeRYMUrl(fullUrl)
      }
    } catch (e) {
      console.error("Failed to get release RYM URL:", e)
    }
    return null
  }

  // Enhanced search functions
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

  function queueRequest(requestFunction) {
    requestQueue.push({ execute: requestFunction })
    processRequestQueue()
  }

  // Enhanced MusicBrainz search with multiple strategies
  function searchMusicBrainzEntity(entityType, searchTerm, rymUrl, callback) {
    const cacheKey = `${entityType}:${searchTerm}:${rymUrl}`

    // Check cache first
    if (mbCache.has(cacheKey)) {
      console.debug("Using cached result for", entityType, searchTerm)
      const result = mbCache.get(cacheKey)
      callback(result.found, result.mbUrl, result.mbid)
      return
    }

    // Check if request is already pending
    if (mbCache.pendingRequests.has(cacheKey)) {
      console.debug("Request already pending for", entityType, searchTerm)
      mbCache.pendingRequests.get(cacheKey).push(callback)
      return
    }

    // Create new pending request
    mbCache.pendingRequests.set(cacheKey, [callback])

    // Multiple search strategies
    const searchStrategies = [
      searchTerm, // exact search
      searchTerm.replace(/[^\w\s]/g, ""), // remove special characters
      searchTerm
        .replace(/\s+/g, " ")
        .trim(), // normalize whitespace
    ]

    // Remove duplicates
    const uniqueStrategies = [...new Set(searchStrategies)]

    searchWithStrategies(entityType, uniqueStrategies, rymUrl, 0, (found, mbUrl, mbid) => {
      const result = { found, mbUrl, mbid }
      mbCache.set(cacheKey, result)

      // Call all pending callbacks
      const callbacks = mbCache.pendingRequests.get(cacheKey) || []
      mbCache.pendingRequests.delete(cacheKey)
      callbacks.forEach((cb) => cb(found, mbUrl, mbid))
    })
  }

  function searchWithStrategies(entityType, strategies, rymUrl, strategyIndex, callback) {
    if (strategyIndex >= strategies.length) {
      console.debug("All search strategies exhausted for", entityType)
      callback(false, null, null)
      return
    }

    const searchTerm = strategies[strategyIndex]
    console.debug(`Trying search strategy ${strategyIndex + 1}/${strategies.length} for ${entityType}: "${searchTerm}"`)

    queueRequest(() => {
      const searchUrl = `${MB_API}${entityType}/?query=${encodeURIComponent(searchTerm)}&fmt=json&limit=${MAX_SEARCH_RESULTS}`
      console.debug("Searching MusicBrainz:", searchUrl)

      GM_xmlhttpRequest({
        method: "GET",
        url: searchUrl,
        onload: (response) => {
          try {
            const data = JSON.parse(response.responseText)
            const entityKey = entityType === "release-group" ? "release-groups" : `${entityType}s`
            const results = data[entityKey] || []

            if (results.length === 0) {
              console.debug(`No results for strategy ${strategyIndex + 1}, trying next strategy`)
              searchWithStrategies(entityType, strategies, rymUrl, strategyIndex + 1, callback)
              return
            }

            console.debug(`Found ${results.length} results for strategy ${strategyIndex + 1}, checking for RYM links`)
            checkMultipleResultsForRYMLink(entityType, results, rymUrl, 0, (found, mbUrl, mbid) => {
              if (found) {
                console.info(`Found matching RYM link using strategy ${strategyIndex + 1}!`)
                callback(found, mbUrl, mbid)
              } else {
                console.debug(`No RYM link found with strategy ${strategyIndex + 1}, trying next strategy`)
                searchWithStrategies(entityType, strategies, rymUrl, strategyIndex + 1, callback)
              }
            })
          } catch (e) {
            console.error("Error parsing search response:", e)
            searchWithStrategies(entityType, strategies, rymUrl, strategyIndex + 1, callback)
          }
        },
        onerror: (error) => {
          console.error("Search request failed:", error)
          searchWithStrategies(entityType, strategies, rymUrl, strategyIndex + 1, callback)
        },
      })
    })
  }

  function checkMultipleResultsForRYMLink(entityType, results, rymUrl, resultIndex, callback) {
    if (resultIndex >= results.length || resultIndex >= MAX_SEARCH_RESULTS) {
      console.debug("No matching RYM relationship found in any results")
      callback(false, null, null)
      return
    }

    const match = results[resultIndex]
    const mbid = match.id
    const mbUrl = `https://musicbrainz.org/${entityType}/${mbid}`

    console.debug(
      `Checking result ${resultIndex + 1}/${Math.min(results.length, MAX_SEARCH_RESULTS)}: ${match.name || match.title}`,
    )

    queueRequest(() => {
      const detailUrl = `${MB_API}${entityType}/${mbid}?inc=url-rels&fmt=json`
      GM_xmlhttpRequest({
        method: "GET",
        url: detailUrl,
        onload: (detailResponse) => {
          try {
            const details = JSON.parse(detailResponse.responseText)
            const urls = details.relations || []

            // Enhanced URL matching with multiple normalization strategies
            const hasRym = urls.some((rel) => {
              if (!rel.url || !rel.url.resource) return false

              const mbRymUrl = normalizeRYMUrl(rel.url.resource)
              const targetRymUrl = normalizeRYMUrl(rymUrl)

              // Try multiple matching strategies
              return (
                mbRymUrl === targetRymUrl ||
                mbRymUrl.toLowerCase() === targetRymUrl.toLowerCase() ||
                mbRymUrl.replace(/\/$/, "") === targetRymUrl.replace(/\/$/, "")
              )
            })

            if (hasRym) {
              console.info(`Found matching RYM relationship in result ${resultIndex + 1}!`)
              callback(true, mbUrl, mbid)
            } else {
              // Try next result
              checkMultipleResultsForRYMLink(entityType, results, rymUrl, resultIndex + 1, callback)
            }
          } catch (e) {
            console.error("Error parsing entity details:", e)
            checkMultipleResultsForRYMLink(entityType, results, rymUrl, resultIndex + 1, callback)
          }
        },
        onerror: (error) => {
          console.error("Detail request failed:", error)
          checkMultipleResultsForRYMLink(entityType, results, rymUrl, resultIndex + 1, callback)
        },
      })
    })
  }

  // UI creation functions
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

  function createIconWithClick(found, mbUrl, mbid, name, rymUrl, isArtist = false, entityType = "artist") {
    const a = document.createElement("a")
    a.textContent = found ? " ✅" : " ❌"
    a.title = found
      ? `Linked to this RYM page (MBID: ${mbid})`
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
              `Popup blocked! Please open manually:\n${mbArtistEditUrl}\n\nAnd add this URL as an external link:\n${rymUrl}`,
            )
          }
        })
      } else {
        // For others, link to search
        const searchType = entityType === "release-group" ? "release_group" : entityType
        a.href = `https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=${searchType}&method=indexed`
      }
    }
    return a
  }

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

  // Page detection functions
  function isReleasePage() {
    return window.location.pathname.includes("/release/")
  }

  function isArtistPage() {
    return window.location.pathname.includes("/artist/")
  }

  function isLabelPage() {
    return window.location.pathname.includes("/label/")
  }

  // Release page functions (existing)
  function checkReleaseGroup() {
    const albumTitleDiv = document.querySelector(".album_title")
    if (!albumTitleDiv) {
      console.debug("No album title found")
      return
    }

    const titleText = albumTitleDiv.childNodes[0]?.textContent?.trim()
    if (!titleText) {
      console.debug("Could not extract album title text")
      return
    }

    // Enhanced title extraction with multiple strategies
    const albumTitle = titleText.replace(/\s+\d{4}\s*$/, "").trim() // Remove year at the end

    if (!albumTitle) {
      console.debug("Could not extract album title")
      return
    }

    console.info("Checking release group:", albumTitle)

    const loadingIcon = createLoadingIcon()
    albumTitleDiv.appendChild(loadingIcon)

    const currentUrl = getCurrentRYMUrl()
    searchMusicBrainzEntity("release-group", albumTitle, currentUrl, (found, mbUrl, mbid) => {
      albumTitleDiv.removeChild(loadingIcon)
      const icon = createIconWithClick(found, mbUrl, mbid, albumTitle, currentUrl, false, "release-group")
      albumTitleDiv.appendChild(icon)
    })
  }

  function checkRelease() {
    const titleElem = document.querySelector("h1.entity_title")
    if (!titleElem) {
      console.debug("No release title found")
      return
    }

    const releaseTitle = titleElem.textContent.trim()
    console.info("Checking release:", releaseTitle)

    const loadingIcon = createLoadingIcon()
    titleElem.appendChild(loadingIcon)

    const currentUrl = getCurrentRYMUrl()
    searchMusicBrainzEntity("release", releaseTitle, currentUrl, (found, mbUrl, mbid) => {
      titleElem.removeChild(loadingIcon)
      const icon = createIconWithClick(found, mbUrl, mbid, releaseTitle, currentUrl, false, "release")
      titleElem.appendChild(icon)
    })
  }

  function checkMainArtist() {
    const artistCell = document.querySelector("tbody tr th.info_hdr")
    if (artistCell && artistCell.textContent.trim() === "Artist") {
      const artistLink = artistCell.parentElement.querySelector("td a.artist")
      if (artistLink) {
        const name = artistLink.textContent.trim()

        if (name === "Various Artists") {
          console.debug("Main artist is Various Artists - showing not applicable icon")
          artistLink.appendChild(createNotApplicableIcon("special artist entity"))
          return
        }

        const artistRymUrl = getArtistRYMUrl(artistLink)
        console.info("Checking main artist:", name, "against URL:", artistRymUrl)

        const loadingIcon = createLoadingIcon()
        artistLink.appendChild(loadingIcon)

        searchMusicBrainzEntity("artist", name, artistRymUrl, (found, mbUrl, mbid) => {
          artistLink.removeChild(loadingIcon)
          const icon = createIconWithClick(found, mbUrl, mbid, name, artistRymUrl, true, "artist")
          artistLink.appendChild(icon)
        })
      }
    }
  }

  function checkSecondaryArtistsAndClassifiers() {
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    if (classifiersSpan) {
      const classifierLinks = classifiersSpan.querySelectorAll('a[href*="/classifiers/"]')
      classifierLinks.forEach((link) => {
        const name = link.textContent.trim()
        if (!name) return

        console.debug("Classifier:", name, "- showing not applicable icon")
        link.appendChild(createNotApplicableIcon("classifiers not supported"))
      })
    }
  }

  function checkLabels() {
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    if (classifiersSpan) {
      const labelLinks = classifiersSpan.querySelectorAll('a[href*="/label/"]')
      labelLinks.forEach((link) => {
        const name = link.textContent.trim()
        if (!name) return

        console.info("Checking label:", name)

        const loadingIcon = createLoadingIcon()
        link.appendChild(loadingIcon)

        const currentUrl = getCurrentRYMUrl()
        searchMusicBrainzEntity("label", name, currentUrl, (found, mbUrl, mbid) => {
          link.removeChild(loadingIcon)
          const icon = createIconWithClick(found, mbUrl, mbid, name, currentUrl, false, "label")
          link.appendChild(icon)
        })
      })
    }
  }

  function checkFeaturedArtists() {
    const featuredCredits = document.querySelectorAll(".featured_credit a.artist")
    featuredCredits.forEach((link) => {
      const name = link.textContent.trim()
      if (!name) return

      const artistRymUrl = getArtistRYMUrl(link)
      console.info("Checking featured artist:", name, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      searchMusicBrainzEntity("artist", name, artistRymUrl, (found, mbUrl, mbid) => {
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(found, mbUrl, mbid, name, artistRymUrl, true, "artist")
        link.appendChild(icon)
      })
    })
  }

  function checkArtists(selector, label) {
    const artists = document.querySelectorAll(selector)
    if (artists.length === 0) {
      console.debug(`No ${label} artists found for selector: ${selector}`)
      return
    }

    artists.forEach((link) => {
      const name = link.textContent.trim()
      if (!name) return

      const artistRymUrl = getArtistRYMUrl(link)
      console.info(`Checking ${label} artist:`, name, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      searchMusicBrainzEntity("artist", name, artistRymUrl, (found, mbUrl, mbid) => {
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(found, mbUrl, mbid, name, artistRymUrl, true, "artist")
        link.appendChild(icon)
      })
    })
  }

  // Artist page functions (existing)
  function checkArtistPageName() {
    const artistNameDiv = document.querySelector(".artist_name")
    if (!artistNameDiv) {
      console.debug("No artist name div found")
      return
    }

    const artistNameHeader = artistNameDiv.querySelector("h1.artist_name_hdr")
    if (!artistNameHeader) {
      console.debug("No artist name header found")
      return
    }

    const artistName = artistNameHeader.textContent.trim()
    if (!artistName) {
      console.debug("Could not extract artist name")
      return
    }

    console.info("Checking artist page name:", artistName)

    const loadingIcon = createLoadingIcon()
    artistNameHeader.appendChild(loadingIcon)

    const currentUrl = getCurrentRYMUrl()
    searchMusicBrainzEntity("artist", artistName, currentUrl, (found, mbUrl, mbid) => {
      artistNameHeader.removeChild(loadingIcon)
      const icon = createIconWithClick(found, mbUrl, mbid, artistName, currentUrl, true, "artist")
      artistNameHeader.appendChild(icon)
    })
  }

  function checkDiscographyReleases() {
    const discographyDiv = document.querySelector(".section_artist_discography")
    if (!discographyDiv) {
      console.debug("No discography section found")
      return
    }

    // Find all release links in the discography
    const releaseLinks = discographyDiv.querySelectorAll(".disco_mainline a.album")
    console.info(`Found ${releaseLinks.length} releases in discography`)

    releaseLinks.forEach((link) => {
      const releaseTitle = link.textContent.trim()
      if (!releaseTitle) return

      const releaseRymUrl = getReleaseRYMUrl(link)
      if (!releaseRymUrl) {
        console.debug("Could not get RYM URL for release:", releaseTitle)
        return
      }

      console.info("Checking discography release:", releaseTitle, "against URL:", releaseRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      // Check for release-group (album) rather than specific release
      searchMusicBrainzEntity("release-group", releaseTitle, releaseRymUrl, (found, mbUrl, mbid) => {
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(found, mbUrl, mbid, releaseTitle, releaseRymUrl, false, "release-group")
        link.appendChild(icon)
      })
    })
  }

  // NEW: Label page functions
  function checkLabelPageName() {
    const labelNameDiv = document.querySelector(".page_company_music_section_name_inner")
    if (!labelNameDiv) {
      console.debug("No label name div found")
      return
    }

    const labelNameHeader = labelNameDiv.querySelector("h1")
    if (!labelNameHeader) {
      console.debug("No label name header found")
      return
    }

    const labelName = labelNameHeader.textContent.trim()
    if (!labelName) {
      console.debug("Could not extract label name")
      return
    }

    console.info("Checking label page name:", labelName)

    const loadingIcon = createLoadingIcon()
    labelNameHeader.appendChild(loadingIcon)

    const currentUrl = getCurrentRYMUrl()
    searchMusicBrainzEntity("label", labelName, currentUrl, (found, mbUrl, mbid) => {
      labelNameHeader.removeChild(loadingIcon)
      const icon = createIconWithClick(found, mbUrl, mbid, labelName, currentUrl, false, "label")
      labelNameHeader.appendChild(icon)
    })
  }

  function checkLabelDiscographyReleases() {
    const discographyDiv = document.querySelector("#component_discography_items_frame")
    if (!discographyDiv) {
      console.debug("No label discography section found")
      return
    }

    // Find all release links in the label discography
    const releaseLinks = discographyDiv.querySelectorAll(".component_discography_item_link.release")
    console.info(`Found ${releaseLinks.length} releases in label discography`)

    releaseLinks.forEach((link) => {
      const releaseTitle = link.textContent.trim()
      if (!releaseTitle) return

      const releaseRymUrl = getReleaseRYMUrl(link)
      if (!releaseRymUrl) {
        console.debug("Could not get RYM URL for release:", releaseTitle)
        return
      }

      console.info("Checking label discography release:", releaseTitle, "against URL:", releaseRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      // Check for release-group (album) rather than specific release
      searchMusicBrainzEntity("release-group", releaseTitle, releaseRymUrl, (found, mbUrl, mbid) => {
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(found, mbUrl, mbid, releaseTitle, releaseRymUrl, false, "release-group")
        link.appendChild(icon)
      })
    })
  }

  function checkLabelDiscographyArtists() {
    const discographyDiv = document.querySelector("#component_discography_items_frame")
    if (!discographyDiv) {
      console.debug("No label discography section found")
      return
    }

    // Find all artist links in the label discography
    const artistLinks = discographyDiv.querySelectorAll("a.artist")
    console.info(`Found ${artistLinks.length} artists in label discography`)

    artistLinks.forEach((link) => {
      const artistName = link.textContent.trim()
      if (!artistName) return

      const artistRymUrl = getArtistRYMUrl(link)
      console.info("Checking label discography artist:", artistName, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      searchMusicBrainzEntity("artist", artistName, artistRymUrl, (found, mbUrl, mbid) => {
        link.removeChild(loadingIcon)
        const icon = createIconWithClick(found, mbUrl, mbid, artistName, artistRymUrl, true, "artist")
        link.appendChild(icon)
      })
    })
  }

  // Main run functions
  function runReleasePageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for release page...")

    checkReleaseGroup()
    checkRelease()
    checkMainArtist()
    checkSecondaryArtistsAndClassifiers()
    checkLabels()
    checkFeaturedArtists()
    checkArtists(".release_pri_artists a", "primary")
    checkArtists(".tracklist_line a.artist", "tracklist")

    console.info("All release page checks initiated")
  }

  function runArtistPageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for artist page...")

    checkArtistPageName()
    checkDiscographyReleases()

    console.info("All artist page checks initiated")
  }

  function runLabelPageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for label page...")

    checkLabelPageName()
    checkLabelDiscographyReleases()
    checkLabelDiscographyArtists()

    console.info("All label page checks initiated")
  }

  function run() {
    if (isReleasePage()) {
      runReleasePageChecks()
    } else if (isArtistPage()) {
      runArtistPageChecks()
    } else if (isLabelPage()) {
      runLabelPageChecks()
    } else {
      console.debug("Unknown page type, skipping checks")
    }
  }

  // Wait for page to load, then run
  setTimeout(run, 1500)
})();
