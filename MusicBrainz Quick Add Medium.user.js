// ==UserScript==
// @name         MusicBrainz Quick Add Medium
// @namespace    https://github.com/Aerozol/metabrainz-userscripts
// @version      2.2
// @description  Customizable buttons for adding mediums with specific formats in the release editor
// @author       ChatGPT
// @match        *://*.musicbrainz.org/release/*/edit*
// @match        *://*.beta.musicbrainz.org/release/add
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_FORMATS = ['Digital Media', 'CD'];
  const STORAGE_KEY = 'mbPreferredFormats';
  const preferredFormats = GM_getValue(STORAGE_KEY, DEFAULT_FORMATS);

  const STATIC_FORMATS = {
    'CD': '1',
    'Copy Control CD': '61',
    'Data CD': '43',
    'DTS CD': '44',
    'Enhanced CD': '42',
    'HDCD': '25',
    'Mixed Mode CD': '129',
    'CD-R': '33',
    '8cm CD': '34',
    '8cm CD-R': '210',
    'Blu-spec CD': '35',
    'Minimax CD': '165',
    'SHM-CD': '36',
    'HQCD': '37',
    'CD-i': '209',
    'CD+G': '39',
    '8cm CD+G': '40',
    'Digital Media': '12',
    'Phonograph record': '73',
    'Vinyl': '7',
    '7" Vinyl': '29',
    '10" Vinyl': '30',
    '12" Vinyl': '31',
    'Flexi-disc': '51',
    '7" Flexi-disc': '52',
    '3" Vinyl': '207',
    'Shellac': '53',
    '7" Shellac': '56',
    '10" Shellac': '54',
    '12" Shellac': '55',
    'Acetate': '203',
    '7" Acetate': '204',
    '10" Acetate': '205',
    '12" Acetate': '206',
    'Cassette': '8',
    'Microcassette': '83',
    'DVD': '2',
    'Data DVD': '94',
    'DVD-Audio': '18',
    'Data DVD-R': '93',
    'DVD-R Video': '92',
    'DVD-Video': '19',
    'MiniDVD': '166',
    'MiniDVD-Audio': '168',
    'MiniDVD-Video': '169',
    'Minimax DVD': '167',
    'Minimax DVD-Audio': '170',
    'Minimax DVD-Video': '171',
    'SACD': '3',
    'SACD (2 channels)': '84',
    'SACD (multichannel)': '85',
    'Hybrid SACD': '38',
    'Hybrid SACD (CD layer)': '63',
    'Hybrid SACD (SACD layer)': '64',
    'Hybrid SACD (SACD layer, 2 channels)': '87',
    'Hybrid SACD (SACD layer, multichannel)': '86',
    'SHM-SACD': '57',
    'SHM-SACD (2 channels)': '89',
    'SHM-SACD (multichannel)': '88',
    'DualDisc': '4',
    'DualDisc (CD side)': '67',
    'DualDisc (DVD-Video side)': '66',
    'DualDisc (DVD-Audio side)': '65',
    'DualDisc (DVD side)': '130',
    'MiniDisc': '6',
    'Blu-ray': '20',
    'Blu-ray-R': '79',
    'CDV': '41',
    'VCD': '22',
    'SVCD': '23',
    'LaserDisc': '5',
    '8" LaserDisc': '71',
    '12" LaserDisc': '72',
    'SD Card': '62',
    'microSD': '164',
    'slotMusic': '27',
    'USB Flash Drive': '26',
    'VHS': '21',
    'Other': '13',
    'Betacam SP': '131',
    'Betamax': '24',
    'Cartridge': '9',
    '8-Track Cartridge': '78',
    'HiPac': '75',
    'PlayTape': '74',
    'ROM cartridge': '208',
    'CED': '60',
    'DAT': '11',
    'DataPlay': '128',
    'DCC': '16',
    'Download Card': '46',
    'DVDplus': '47',
    'DVDplus (CD side)': '70',
    'DVDplus (DVD-Video side)': '69',
    'DVDplus (DVD-Audio side)': '68',
    'Edison Diamond Disc': '50',
    'Floppy Disk': '76',
    '3.5" Floppy Disk': '49',
    '5.25" Floppy Disk': '91',
    'Zip Disk': '77',
    'HD-DVD': '17',
    'KiT Album': '95',
    'Pathé disc': '58',
    'Piano Roll': '15',
    'Playbutton': '45',
    'Reel-to-reel': '10',
    'Tefifon': '90',
    'UMD': '28',
    'VHD': '59',
    'VinylDisc': '48',
    'VinylDisc (CD side)': '82',
    'VinylDisc (DVD side)': '80',
    'VinylDisc (Vinyl side)': '81',
    'Wax Cylinder': '14'
  };

  function forceValue(select, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createEmbeddedBox() {
    const tracklistPanel = document.querySelector('#tracklist');
    if (!tracklistPanel) return;

    const container = document.createElement('div');
    container.className = 'mb-embedded-add-buttons';
    container.style = 'margin-top: 20px; position: relative;';

    const fieldset = document.createElement('fieldset');
    fieldset.className = 'guesscase';

    const legend = document.createElement('legend');
    legend.textContent = 'Quick add medium';

    fieldset.appendChild(legend);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'buttons';
    buttonRow.style = 'margin: 10px;';

    for (const label of preferredFormats) {
      if (!(label in STATIC_FORMATS)) continue;

      const btn = document.createElement('button');
      btn.textContent = label;
      btn.type = 'button';
      Object.assign(btn.style, {
        marginRight: '6px',
        padding: '2px 6px',
        fontSize: '12px',
        border: '1px solid #ccc',
        borderRadius: '4px',
        background: '#f0f0f0',
        cursor: 'pointer'
      });
      btn.addEventListener('click', e => {
        if (e.shiftKey) {
          setFirstEmptyMediumFormat(label);
        } else {
          clickAddMediumWithFormat(label, e.altKey);
        }
      });
      buttonRow.appendChild(btn);
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = '⚙️';
    settingsBtn.title = 'Choose formats to show as buttons';
    Object.assign(settingsBtn.style, {
      padding: '2px 6px',
      fontSize: '12px',
      border: '1px solid #ccc',
      borderRadius: '4px',
      background: '#f0f0f0',
      cursor: 'pointer'
    });
    settingsBtn.addEventListener('click', openSettings);
    buttonRow.appendChild(settingsBtn);

    fieldset.appendChild(buttonRow);
    container.appendChild(fieldset);

    const tip = document.createElement('div');
    tip.textContent = '?';
    tip.title = 'Alt+Click: Add medium & mark tracklist unknown.\nShift+Click: Set format on first existing medium with no format.';
    tip.style.cssText = `
      position: absolute;
      margin-top: 8px;
      top: 6px;
      right: 10px;
      width: 16px;
      height: 16px;
      font-size: 12px;
      background: #ccc;
      border-radius: 50%;
      text-align: center;
      line-height: 16px;
      cursor: help;
      opacity: 0.7;
    `;

    container.appendChild(tip);
    tracklistPanel.appendChild(container);
  }

  function clickAddMediumWithFormat(label, alsoCheckUnknownTracks) {
    const addButton = document.querySelector('button[data-click="open"]');
    if (!addButton) return;

    addButton.click();
    const watcher = setInterval(() => {
      const popupAdd = document.querySelector('button[data-click="addMedium"]');
      if (popupAdd && !popupAdd.disabled) {
        popupAdd.click();
        clearInterval(watcher);
        setTimeout(() => {
          setNewestMediumFormat(label);
          if (alsoCheckUnknownTracks) checkUnknownTracklistBox();
        }, 300);
      }
    }, 300);
  }

  function setNewestMediumFormat(label) {
    const selects = document.querySelectorAll('select[id^="medium-format-"]');
    if (selects.length === 0 || !(label in STATIC_FORMATS)) return;
    const lastSelect = selects[selects.length - 1];
    forceValue(lastSelect, STATIC_FORMATS[label]);
  }

  function setFirstEmptyMediumFormat(label) {
    const selects = document.querySelectorAll('select[id^="medium-format-"]');
    if (!selects.length || !(label in STATIC_FORMATS)) return;
    for (const select of selects) {
      if (!select.value) {
        forceValue(select, STATIC_FORMATS[label]);
        break;
      }
    }
  }

  function checkUnknownTracklistBox() {
    const checkboxes = document.querySelectorAll('input[id="tracks-unknown"]');
    if (checkboxes.length) {
      const lastBox = checkboxes[checkboxes.length - 1];
      if (!lastBox.checked) lastBox.click();
    }
  }

  function openSettings() {
    const dialog = document.createElement('div');
    dialog.style = `
      position:fixed; top:50%; left:50%; transform:translate(-50%, -50%);
      z-index:10000; padding:0; background:white; border:1px solid #aaa;
      border-radius:8px; width:300px; max-height:80vh; overflow:auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; flex-direction: column;
    `;

    const stickyControls = document.createElement('div');
    stickyControls.style = `
      position: sticky; top: 0; background: white;
      padding: 12px; border-bottom: 1px solid #ccc; z-index: 1;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Select format buttons';
    title.style.margin = '0 0 6px 0';
    stickyControls.appendChild(title);

    const save = document.createElement('button');
    save.textContent = 'Save and reload page';
    save.addEventListener('click', () => {
      const selected = Array.from(dialog.querySelectorAll('input:checked')).map(cb => cb.value);
      GM_setValue(STORAGE_KEY, selected);
      dialog.remove();
      location.reload();
    });

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.marginLeft = '10px';
    cancel.addEventListener('click', () => dialog.remove());

    stickyControls.appendChild(save);
    stickyControls.appendChild(cancel);
    dialog.appendChild(stickyControls);

    const list = document.createElement('div');
    list.style.padding = '12px';
    for (const format of Object.keys(STATIC_FORMATS).sort()) {
      const label = document.createElement('label');
      label.style.display = 'block';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = format;
      checkbox.checked = preferredFormats.includes(format);
      checkbox.style.marginRight = '6px';

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(format));
      list.appendChild(label);
    }

    dialog.appendChild(list);
    document.body.appendChild(dialog);
  }

  window.addEventListener('load', () => {
    createEmbeddedBox();
  });
})();
