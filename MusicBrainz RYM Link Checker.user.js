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
  const REQUEST_DELAY = 1000; // 1 second between requests to respect MB rate limit

  // Request queue for rate limiting
  const requestQueue = []
  let isProcessingQueue = false

  // URL normalization functions
  function normalizeRYMUrl(url) {
    if (!url){
      return  null;
    }
    try {
      // Remove query parameters and fragments
      let cleanUrl = url.split("?")[0].split("#")[0]
      // Ensure https
      cleanUrl = cleanUrl.replace(/^http:/, "https:")
      // Normalize case for path components (but preserve domain case)
      const urlObj = new URL(cleanUrl)
      urlObj.pathname = urlObj.pathname.toLowerCase()
      if(urlObj.pathname.split("/")[1] == "label"){
        urlObj.pathname = urlObj.pathname.split("/").slice(0,3).join("/") + "/";
      }
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

  function createMBzUrl(entityType, mbid){
    return `https://musicbrainz.org/${entityType}/${mbid}`;
  }

  function lookupURLs(urlList, offset = 0){
    console.log(urlList.length, " urls, offset is ", offset);
    let urlsObj = {};
    for(let i = offset; i < Math.min(urlList.length, offset + 100); i++){
      if(urlList[i]){
        let existingCallback = urlsObj[urlList[i].url]?.callback;
        if(existingCallback){
          urlsObj[urlList[i].url].callback = (results) => {
            existingCallback(results);
            urlList[i].callback(results);
          }
        }else{
          urlsObj[urlList[i].url] = urlList[i];
        }
      }
    }
    queueRequest(() => {
      let combinedURL = `${MB_API}url?fmt=json`;
      let includes = [];
      for(const [url, {entityType, callback}] of Object.entries(urlsObj)){
        combinedURL += "&resource=" + url;
        includes.push(entityType);
      }
      combinedURL += "&inc=";
      includes = Array.from(new Set(includes));
      for(const i in includes){
        if(i != 0){
          combinedURL += "+";
        }
        combinedURL += includes[i] + "-rels";
      }
      console.debug(combinedURL);
      GM_xmlhttpRequest({
        method: "GET",
        url: combinedURL,
        onload: (response) => {
          const data = JSON.parse(response.responseText);
          console.debug(data);
          if(!data.error){
            for(const urlItem of data.urls){
              const {entityType, callback} = urlsObj[urlItem.resource];
              const results = urlItem.relations
                    .map((rel) => {
                      if(rel["target-type"] == "release_group"){
                        rel["target-type"] = "release-group";
                        rel["release-group"] = rel["release_group"];
                      }
                      return rel;
                    })
                    .filter((rel) => rel["target-type"] == entityType)
                    .map((rel) => {
                      return {
                        success: true,
                        type: entityType,
                        id: rel[entityType].id,
                        url: urlItem.resource,
                      }});
              callback(results);
              urlsObj[urlItem.resource].callback = null;
            }
          }
          for(const {entityType, callback} of Object.values(urlsObj)){
            if(callback){
              callback([{type: entityType,
                         success: false,}]);
            }
          }
          if(urlList.length > (offset + 100)){
            lookupURLs(urlList, offset + 100);
          }
        },
        onerror: (response) => {
          console.error(response);
          for(const {entityType, callback} of urls.values()){
            callback([{entityType: entityType,
                       success: false}]);
          }
        }
      })
    })
  }

  function lookupURL(entityType, url, callback){
    lookupURLs([{url: url, entityType: entityType, callback: callback}]);
  }

  // UI creation functions
  function createLoadingIcon() {
    const a = document.createElement("a");
    a.className = "RYM-Link-Checker-Loading-Icon";
    a.textContent = " ⏳";
    a.title = "Searching MusicBrainz...";
    a.style.marginLeft = "0.25em";
    a.style.textDecoration = "none";
    a.style.fontSize = "0.9em";
    return a;
  }

  function createIconWithClick(found, mbUrl, mbid, name, rymUrl, entityType) {
    const isArtist = (entityType == "artist");
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
    a.target = "_blank"

    if (found) {
      if (mbUrl) a.href = mbUrl
    } else {
      if (isArtist && mbUrl) {
        // TODO seed rymUrl
      } else {
        // For others, link to search
        let searchType = entityType;
        if(searchType == "release-group"){
          searchType = "release_group";
        }
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

  function handleCallback (element, name){
    return (results) => {
      element.removeChild(element.querySelector(".RYM-Link-Checker-Loading-Icon"));
      for(const result of results){
        const icon = createIconWithClick(result.success,
				                                 createMBzUrl(result.type, result.id),
				                                 results.id, name, result.url, result.type);
        element.appendChild(icon);
      }
    }
  }

  // Release page functions (existing)
  function checkReleaseGroup() {
    const albumTitleDiv = document.querySelector(".album_title")
    if (!albumTitleDiv) {
      console.warn("No album title found");
      return [];
    }

    const titleText = albumTitleDiv.childNodes[0]?.textContent?.trim()
    if (!titleText) {
      console.warn("Could not extract album title text");
      return [];
    }

    // Enhanced title extraction with multiple strategies
    const albumTitle = titleText.replace(/\s+\d{4}\s*$/, "").trim() // Remove year at the end

    if (!albumTitle) {
      console.warn("Could not extract album title");
      return [];
    }

    console.info("Checking release group:", albumTitle)

    const loadingIcon = createLoadingIcon()
    albumTitleDiv.appendChild(loadingIcon)

    return {
      url: getCurrentRYMUrl(),
      entityType: "release-group",
      callback: handleCallback(albumTitleDiv, albumTitle),
    };
  }

  function checkRelease() {
    const titleElem = document.querySelector("h1.entity_title")
    if (!titleElem) {
      console.debug("No release title found")
      return [];
    }

    const releaseTitle = titleElem.textContent.trim()
    console.info("Checking release:", releaseTitle)

    const loadingIcon = createLoadingIcon()
    titleElem.appendChild(loadingIcon)

    return {
      url: getCurrentRYMUrl(),
      entityTitle: "release",
      callback: handleCallback(titleElem, releaseTitle)
    };
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
          return null;
        }

        const artistRymUrl = getArtistRYMUrl(artistLink)
        console.info("Checking main artist:", name, "against URL:", artistRymUrl)

        const loadingIcon = createLoadingIcon()
        artistLink.appendChild(loadingIcon)

        return {
          url: artistRymUrl,
          entityType: "artist",
          callback: handleCallback(artistLink, name)
        };
      }
    }
  }

  function checkSecondaryArtistsAndClassifiers() {
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    if (classifiersSpan) {
      const classifierLinks = classifiersSpan.querySelectorAll('a[href*="/classifiers/"]')
      classifierLinks.forEach((link) => {
        const name = link.textContent.trim()
        if (!name) {
          return;
        }

        console.debug("Classifier:", name, "- showing not applicable icon")
        link.appendChild(createNotApplicableIcon("classifiers not supported"))
      })
    }
  }

  function checkLabels() {
    const classifiersSpan = document.querySelector(".release_info_classifiers")
    let links = [];
    if (classifiersSpan) {
      const labelLinks = classifiersSpan.querySelectorAll('a[href*="/label/"]')
      labelLinks.forEach((link) => {
        const name = link.textContent.trim()
        if (!name) {
          return;
        }
        console.info("Checking label:", name)
        const loadingIcon = createLoadingIcon()
        link.appendChild(loadingIcon)
        links.push({
          url: normalizeRYMUrl(link.href),
          entityType: "label",
          callback: handleCallback(link, name),
        });
      });
    }
    return links;
  }

  function checkFeaturedArtists() {
    const featuredCredits = document.querySelectorAll(".featured_credit a.artist")
    let links = [];
    featuredCredits.forEach((link) => {
      const name = link.textContent.trim()
      if (!name) {
        return;
      }

      const artistRymUrl = getArtistRYMUrl(link)
      console.info("Checking featured artist:", name, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      links.push({
        url: artistRymUrl,
        entityType: "artist",
        callback: handleCallback(link, name),
      });
    });
    return links;
  }

  function checkArtists(selector, label) {
    const artists = document.querySelectorAll(selector)
    if (artists.length === 0) {
      console.debug(`No ${label} artists found for selector: ${selector}`)
      return [];
    }

    let links = [];
    
    artists.forEach((link) => {
      const name = link.textContent.trim()
      if (!name) {
        return;
      }

      const artistRymUrl = getArtistRYMUrl(link)
      console.info(`Checking ${label} artist:`, name, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      links.push({
        url: artistRymUrl,
        entityType: "artist",
        callback: handleCallback(link, name)});
    })
    return links;
  }

  // Artist page functions (existing)
  function checkArtistPageName() {
    const artistNameDiv = document.querySelector(".artist_name")
    if (!artistNameDiv) {
      console.warn("No artist name div found");
      return [];
    }

    const artistNameHeader = artistNameDiv.querySelector("h1.artist_name_hdr")
    if (!artistNameHeader) {
      console.warn("No artist name header found");
      return [];
    }

    const artistName = artistNameHeader.textContent.trim()
    if (!artistName) {
      console.warn("Could not extract artist name");
      return [];
    }

    console.info("Checking artist page name:", artistName)

    const loadingIcon = createLoadingIcon()
    artistNameHeader.appendChild(loadingIcon)

    return {
      url: getCurrentRYMUrl(),
      entityType: "artist",
      callback: handleCallback(artistNameHeader, artistName)
    };
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
    let links = [];
    releaseLinks.forEach((link) => {
      const releaseTitle = link.textContent.trim()
      if (!releaseTitle) {
        return;
      }

      const releaseRymUrl = getReleaseRYMUrl(link)
      if (!releaseRymUrl) {
        console.debug("Could not get RYM URL for release:", releaseTitle)
        return;
      }

      console.info("Checking discography release:", releaseTitle, "against URL:", releaseRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      // Check for release-group (album) rather than specific release
      links.push({
        url: releaseRymUrl,
        entityType: "release-group",
        callback: handleCallback(link, releaseTitle,
        )});
    })
    return links;
  }

  // NEW: Label page functions
  function checkLabelPageName() {
    const labelNameDiv = document.querySelector(".page_company_music_section_name_inner")
    if (!labelNameDiv) {
      console.warn("No label name div found");
      return [];
    }

    const labelNameHeader = labelNameDiv.querySelector("h1")
    if (!labelNameHeader) {
      console.warn("No label name header found");
      return [];
    }

    const labelName = labelNameHeader.textContent.trim()
    if (!labelName) {
      console.warn("Could not extract label name");
      return [];
    }

    console.info("Checking label page name:", labelName)

    const loadingIcon = createLoadingIcon()
    labelNameHeader.appendChild(loadingIcon)

    return {
      url: getCurrentRYMUrl(),
      entityType: "label",
      callback: handleCallback(labelNameHeader, labelName),
    };
  }

  function checkLabelDiscographyReleases() {
    const discographyDiv = document.querySelector("#component_discography_items_frame")
    if (!discographyDiv) {
      console.debug("No label discography section found")
      return [];
    }

    // Find all release links in the label discography
    const releaseLinks = discographyDiv.querySelectorAll(".component_discography_item_link.release")
    console.info(`Found ${releaseLinks.length} releases in label discography`)
    let links = [];
    releaseLinks.forEach((link) => {
      const releaseTitle = link.textContent.trim()
      if (!releaseTitle) {
        return;
      }

      const releaseRymUrl = getReleaseRYMUrl(link)
      if (!releaseRymUrl) {
        console.debug("Could not get RYM URL for release:", releaseTitle)
        return;
      }

      console.info("Checking label discography release:", releaseTitle, "against URL:", releaseRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)

      // Check for release-group (album) rather than specific release
      links.push({
        url: releaseRymUrl,
        entityType: "release-group",
        callback: handleCallback(link, releaseTitle),
      });
    });
    return links;
  }

  function checkLabelDiscographyArtists() {
    const discographyDiv = document.querySelector("#component_discography_items_frame")
    if (!discographyDiv) {
      console.debug("No label discography section found")
      return [];
    }

    // Find all artist links in the label discography
    const artistLinks = discographyDiv.querySelectorAll("a.artist")
    console.info(`Found ${artistLinks.length} artists in label discography`)
    let links = [];
    artistLinks.forEach((link) => {
      const artistName = link.textContent.trim()
      if (!artistName) {
        return;
      }

      const artistRymUrl = getArtistRYMUrl(link)
      console.info("Checking label discography artist:", artistName, "against URL:", artistRymUrl)

      const loadingIcon = createLoadingIcon()
      link.appendChild(loadingIcon)
      links.push({
        url: artistRymUrl,
        entityType: "artist",
        callback: handleCallback(link, artistName),
      });
    });
    return links;
  }

  // Main run functions
  function runReleasePageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for release page...")
    let urls = [checkReleaseGroup(),
      checkRelease(),
      checkMainArtist(),
      checkSecondaryArtistsAndClassifiers(),
      checkLabels(),
      checkFeaturedArtists(),
      checkArtists(".release_pri_artists a", "primary"),
      checkArtists(".tracklist_line a.artist", "tracklist")]
      .flat();
    lookupURLs(urls);
    console.info("All release page checks initiated")
  }

  function runArtistPageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for artist page...")
    let urls = [checkArtistPageName(), checkDiscographyReleases()]
      .flat();
    lookupURLs(urls);
    console.info("All artist page checks initiated")
  }

  function runLabelPageChecks() {
    console.info("Starting enhanced RYM-MusicBrainz checker for label page...")
    let urls = [checkLabelPageName(),
      checkLabelDiscographyReleases(),
      checkLabelDiscographyArtists()]
      .flat();
    lookupURLs(urls);
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
