/* ================================================================
   MEMORIES ALBUM  ·  script.js
   Page-flip logic, photo management, Google Drive integration,
   ambient music synthesizer
   ================================================================ */

'use strict';

/* ================================================================
   CONSTANTS & STATE
   ================================================================ */
const isAdmin = new URLSearchParams(location.search).has('admin');

const HARDCODED_PHOTOS = [
  // Add your Google Drive file IDs or full share links here!
  // e.g. '1BxiMVs0X...', or 'https://drive.google.com/file/d/1BxiMVs0X.../view'
  'https://drive.google.com/file/d/1XJeCzn_W9Tg4P4xp772vmUL2dOOXwFSA/view?usp=drive_link',
  'https://drive.google.com/file/d/1ig4OJvlQRxo05aXvjIVpyUVPnvIhjb6k/view?usp=drive_link'
];


const STORAGE_PHOTOS = 'memoriesAlbum_photos_v2';
const STORAGE_TITLE = 'memoriesAlbum_title';
const STORAGE_APIKEY = 'memoriesAlbum_apikey';

const BACK_QUOTES = [
  'The best thing to hold onto in life is each other.',
  'In every conceivable manner, the family is link to our past and bridge to our future.',
  'Every picture tells a story worth telling.',
  'Cherish every moment, for they become tomorrow\'s treasured memories.',
  'A family is a little world created by love.',
  'Home is where the heart is — and yours is in every photo here.',
];

let photos = [];    // { id, src, caption, source }
let pendingBatch = [];    // photos staged in add-modal preview
let currentLeaf = 0;    // 0 = cover; increments each page-flip
let totalLeaves = 0;
let isAnimating = false;
let captionId = null;  // photo id being edited
let fetchedDrive = [];    // photos from Drive folder fetch

/* ================================================================
   DOM REFERENCES
   ================================================================ */
const $ = id => document.getElementById(id);
const book = $('book');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const pageLabel = $('pageLabel');
const pageDots = $('pageDots');
const addPhotoBtn = $('addPhotoBtn');
const gdriveBtn = $('gdriveBtn');

const toast = $('toast');

/* ================================================================
   AUDIO CONTROLLER
   ================================================================ */
const bgAudio = $('bgAudio');
const STORAGE_MUSIC = 'memoriesAlbum_music';

class AudioController {
  constructor() {
    this.playing = false;
    this.defaultSrc = 'assets/romantic.mp3';
    // Small delay to ensure bgAudio is in DOM if loaded async
    setTimeout(() => this.loadSrc(), 0);
  }
  
  loadSrc() {
    if (!bgAudio) return;
    const customUrl = localStorage.getItem(STORAGE_MUSIC);
    bgAudio.src = customUrl || this.defaultSrc;
  }
  
  setSrc(url) {
    if (url) {
      localStorage.setItem(STORAGE_MUSIC, url);
    } else {
      localStorage.removeItem(STORAGE_MUSIC);
    }
    this.loadSrc();
    if (this.playing && bgAudio) bgAudio.play().catch(e => console.log('Audio play failed', e));
  }
  
  getSrc() {
    return localStorage.getItem(STORAGE_MUSIC) || '';
  }

  start() {
    if (!bgAudio) return;
    this.playing = true;
    bgAudio.play().catch(e => console.log('Audio autoplay prevented', e));
  }

  stop() {
    if (!bgAudio) return;
    this.playing = false;
    bgAudio.pause();
  }

  toggle() {
    this.playing ? this.stop() : this.start();
    return this.playing;
  }
}

const music = new AudioController();

/* ================================================================
   PERSISTENCE
   ================================================================ */
function loadPhotos() {
  photos = [];

  // Load hardcoded photos
  HARDCODED_PHOTOS.forEach(urlOrId => {
    const id = gdriveFileId(urlOrId) || urlOrId;
    if (id) {
      photos.push({ id: 'hc_' + id, src: driveThumbUrl(id), caption: '', source: 'gdrive' });
    }
  });

  // If admin, also load from localStorage for previewing
  if (isAdmin) {
    try {
      const raw = localStorage.getItem(STORAGE_PHOTOS);
      if (raw) {
        const localPhotos = JSON.parse(raw);
        // Avoid duplicates if a photo was added both locally and hardcoded
        localPhotos.forEach(p => {
          if (!photos.find(hp => hp.id === p.id || hp.id === 'hc_' + p.id.replace('gd_', ''))) {
            photos.push(p);
          }
        });
      }
    } catch (e) { }
  }
}

function savePhotos() {
  if (!isAdmin) return; // Clients don't save
  try {
    // Only save photos that are NOT hardcoded
    const photosToSave = photos.filter(p => !p.id.startsWith('hc_'));
    localStorage.setItem(STORAGE_PHOTOS, JSON.stringify(photosToSave));
  } catch {
    showToast('⚠️ Storage full — some photos may not persist. Consider removing old ones.');
  }
}

function getTitle() {
  return localStorage.getItem(STORAGE_TITLE) || 'Our Memories';
}

function saveTitle(t) {
  localStorage.setItem(STORAGE_TITLE, t.trim() || 'Our Memories');
}

/* ================================================================
   PHOTO HELPERS
   ================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function addPhotos(batch) {
  photos.push(...batch);
  savePhotos();
  renderBook();
  showToast(`✨ ${batch.length} photo${batch.length !== 1 ? 's' : ''} added!`);
  // Auto-navigate to first photo so user can see them
  if (currentLeaf === 0) {
    setTimeout(() => goNext(), 450);
  }
}

function removePhoto(id) {
  if (!confirm('Remove this photo from the album?')) return;
  photos = photos.filter(p => p.id !== id);
  savePhotos();
  // Stay on the same page (but clamp if needed)
  renderBook();
  showToast('Photo removed');
}

function updateCaption(id, caption) {
  const p = photos.find(ph => ph.id === id);
  if (p) { p.caption = caption; savePhotos(); renderBook(); }
}

/* ================================================================
   GOOGLE DRIVE UTILITIES
   ================================================================ */
function gdriveFileId(url) {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/d\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) return url.trim();
  return null;
}

function driveThumbUrl(id, size = 800) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${size}`;
}

/* ================================================================
   BOOK DATA MODEL
   ================================================================
   Pages array: [cover, photo[0], photo[1], ..., photo[N-1], back-cover]
   Leaf k:  front = pages[2k], back = pages[2k+1]
   currentLeaf = k means leaves 0…k-1 are flipped.
   ================================================================ */
function buildPages() {
  const pages = [{ type: 'cover' }];
  photos.forEach(p => pages.push({ type: 'photo', photo: p }));
  pages.push({ type: 'back' });
  // Pad to even length
  if (pages.length % 2 !== 0) pages.push({ type: 'empty' });
  return pages;
}

/* ================================================================
   BOOK RENDERING
   ================================================================ */
function renderBook() {
  const pages = buildPages();
  totalLeaves = pages.length / 2;
  if (currentLeaf > totalLeaves) currentLeaf = totalLeaves;

  // Remove all previous leaves (keep endpapers)
  book.querySelectorAll('.leaf').forEach(l => l.remove());

  for (let k = 0; k < totalLeaves; k++) {
    const front = pages[2 * k];
    const back = pages[2 * k + 1];
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.dataset.idx = k;

    const faceF = document.createElement('div');
    faceF.className = 'leaf-front';
    faceF.appendChild(buildPageEl(front, 'front', 2 * k, pages.length));

    const faceB = document.createElement('div');
    faceB.className = 'leaf-back';
    faceB.appendChild(buildPageEl(back, 'back', 2 * k + 1, pages.length));

    leaf.appendChild(faceF);
    leaf.appendChild(faceB);
    book.appendChild(leaf);
  }

  applyFlipState();
  updateNav();
  updateStatus();
}

/* ---- Page element factory ---- */
function buildPageEl(page, face, pageIdx, total) {
  if (!page || page.type === 'empty') return emptyPage();
  switch (page.type) {
    case 'cover': return coverFront();
    case 'back': return coverBack();
    case 'photo': return photoPage(page.photo, face, pageIdx);
    default: return emptyPage();
  }
}

/* ---- Front Cover ---- */
function coverFront() {
  const div = document.createElement('div');
  div.className = 'cover-page cover-front';
  div.innerHTML = `
    <div class="cv-corner tl"></div>
    <div class="cv-corner tr"></div>
    <div class="cv-corner bl"></div>
    <div class="cv-corner br"></div>
    <div class="cover-content">
      <div class="cover-emblem-ring">
        <span class="cover-emblem-icon">📷</span>
      </div>
      <div class="cover-rule"></div>
      <div class="cover-title"
           ${isAdmin ? 'contenteditable="true" spellcheck="false" title="Click to edit title"' : ''}
           id="coverTitleEl"
           aria-label="Album title">${escHtml(getTitle())}</div>
      <div class="cover-subtitle">A Cherished Collection</div>
      <div class="cover-rule"></div>
    </div>
    <div class="cover-year">${new Date().getFullYear()}</div>
  `;

  // Wire up editable title
  requestAnimationFrame(() => {
    const el = div.querySelector('#coverTitleEl');
    if (!el) return;
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
    el.addEventListener('blur', () => {
      saveTitle(el.textContent);
      showToast('✏️ Title saved!');
    });
  });

  return div;
}

/* ---- Back Cover ---- */
function coverBack() {
  const quote = BACK_QUOTES[Math.floor(Math.random() * BACK_QUOTES.length)];
  const div = document.createElement('div');
  div.className = 'cover-page cover-back';
  div.innerHTML = `
    <div class="cv-corner tl"></div>
    <div class="cv-corner tr"></div>
    <div class="cv-corner bl"></div>
    <div class="cv-corner br"></div>
    <div class="back-cover-content">
      <div class="back-cover-icon">✨</div>
      <div class="back-cover-line"></div>
      <div class="back-cover-quote">${escHtml(quote)}</div>
      <div class="back-cover-line"></div>
      <div class="back-cover-icon">📸</div>
    </div>
  `;
  return div;
}

/* ---- Photo Page ---- */
function photoPage(photo, face, pageIdx) {
  const div = document.createElement('div');
  div.className = 'content-page';

  div.innerHTML = `
    <div class="page-ornament">✦</div>
    <div class="photo-frame">
      <div class="photo-wrapper">
        <img class="photo-img"
             src="${photo.src}"
             alt="${escHtml(photo.caption || 'Memory')}"
             loading="lazy"
             draggable="false">
        ${isAdmin ? `
        <button class="photo-delete-btn" data-id="${escHtml(photo.id)}" title="Remove photo">✕</button>
        <button class="photo-caption-btn" data-id="${escHtml(photo.id)}" title="Edit caption">✏</button>
        ` : ''}
      </div>
    </div>
    <div class="photo-caption">${escHtml(photo.caption || '')}</div>
    <div class="page-num">${pageIdx}</div>
  `;

  // Image error handler — shows a friendly placeholder if image fails to load
  const img = div.querySelector('.photo-img');
  img.onerror = function () {
    this.style.display = 'none';
    const ph = document.createElement('div');
    ph.className = 'img-error';
    ph.innerHTML = `<span class="img-error-icon">🖼️</span>
      <span>Image could not load.<br>For Drive photos, ensure the file is<br>shared as <em>"Anyone with the link"</em>.</span>`;
    this.parentNode.insertBefore(ph, this.nextSibling);
  };

  const deleteBtn = div.querySelector('.photo-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      removePhoto(photo.id);
    });
  }

  const captionBtn = div.querySelector('.photo-caption-btn');
  if (captionBtn) {
    captionBtn.addEventListener('click', e => {
      e.stopPropagation();
      openCaptionModal(photo.id, photo.caption);
    });
  }

  return div;
}

/* ---- Empty Page ---- */
function emptyPage() {
  const div = document.createElement('div');
  div.className = 'content-page';
  div.innerHTML = `
    <div class="empty-page-inner">
      <div class="empty-page-icon">🖼️</div>
      <div class="empty-page-label">Add photos to fill this page</div>
    </div>
  `;
  return div;
}

/* ================================================================
   FLIP STATE MANAGEMENT
   ================================================================ */
function applyFlipState() {
  const leaves = book.querySelectorAll('.leaf');
  leaves.forEach((leaf, i) => {
    leaf.classList.toggle('flipped', i < currentLeaf);
    // Z-index: flipped leaves → lower = more "under"; unflipped → higher = more on top
    leaf.style.zIndex = i < currentLeaf
      ? (i + 1)
      : (totalLeaves - i + 1);
  });
}

/* ================================================================
   PAGE NAVIGATION
   ================================================================ */
function goNext() {
  if (isAnimating || currentLeaf >= totalLeaves) return;
  isAnimating = true;

  const leaves = book.querySelectorAll('.leaf');
  const target = leaves[currentLeaf];
  if (!target) { isAnimating = false; return; }

  target.style.zIndex = 9999;
  target.classList.add('animating');

  // Start the CSS flip
  requestAnimationFrame(() => {
    target.classList.add('flipped');
  });

  setTimeout(() => {
    currentLeaf++;
    target.classList.remove('animating');
    applyFlipState();
    updateNav();
    updateStatus();
    isAnimating = false;
  }, 900);
}

function goPrev() {
  if (isAnimating || currentLeaf <= 0) return;
  isAnimating = true;

  const leaves = book.querySelectorAll('.leaf');
  const target = leaves[currentLeaf - 1];
  if (!target) { isAnimating = false; return; }

  target.style.zIndex = 9999;
  target.classList.add('animating');

  requestAnimationFrame(() => {
    target.classList.remove('flipped');
  });

  setTimeout(() => {
    currentLeaf--;
    target.classList.remove('animating');
    applyFlipState();
    updateNav();
    updateStatus();
    isAnimating = false;
  }, 900);
}

/* ================================================================
   UI STATUS
   ================================================================ */
function updateNav() {
  prevBtn.disabled = currentLeaf === 0;
  nextBtn.disabled = currentLeaf >= totalLeaves;
}

function updateStatus() {
  if (currentLeaf === 0) {
    pageLabel.textContent = 'Cover';
  } else if (currentLeaf >= totalLeaves) {
    pageLabel.textContent = 'Back Cover';
  } else {
    const L = currentLeaf * 2 - 1;
    const R = currentLeaf * 2;
    pageLabel.textContent = `Pages ${L} – ${R}`;
  }

  // Dot indicators (cap at 14 dots)
  const total = Math.min(totalLeaves + 1, 14);
  const pos = Math.min(currentLeaf, total - 1);
  pageDots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'pdot' +
      (i < pos ? ' visited' : '') +
      (i === pos ? ' active' : '');
    pageDots.appendChild(d);
  }
}

/* ================================================================
   BOOK CLICK → NAVIGATE
   ================================================================ */
document.getElementById('bookScene').addEventListener('click', e => {
  if (e.target.closest('[contenteditable], button, input, textarea, a')) return;
  if (isAnimating) return;
  const rect = book.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x > rect.width / 2) goNext();
  else goPrev();
});

/* ================================================================
   ADD PHOTO MODAL — LOCAL FILES
   ================================================================ */
const addOverlay = $('addPhotoOverlay');
const uploadArea = $('uploadArea');
const fileInput = $('fileInput');
const previewSec = $('previewSection');
const previewGrid = $('previewGrid');
const previewCnt = $('previewCount');

function openAddModal() {
  pendingBatch = [];
  previewSec.style.display = 'none';
  previewGrid.innerHTML = '';
  $('driveLinkInput').value = '';
  addOverlay.classList.add('open');
}

function closeAddModal() {
  addOverlay.classList.remove('open');
  pendingBatch = [];
}

// Drag & drop
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (files.length) processLocalFiles(files);
});
uploadArea.addEventListener('click', () => fileInput.click());
$('pickFilesBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) processLocalFiles([...fileInput.files]);
  fileInput.value = '';
});

function processLocalFiles(files) {
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const photo = { id: uid(), src: e.target.result, caption: '', source: 'local' };
      pendingBatch.push(photo);
      addPendingThumb(photo);
    };
    reader.readAsDataURL(file);
  });
}

function addPendingThumb(photo) {
  previewSec.style.display = 'flex';
  const el = document.createElement('div');
  el.className = 'prev-thumb';
  el.dataset.id = photo.id;
  el.innerHTML = `
    <img src="${escHtml(photo.src)}" alt="Preview" loading="lazy">
    <button class="prev-thumb-del" type="button" title="Remove">✕</button>
  `;
  el.querySelector('.prev-thumb-del').addEventListener('click', e => {
    e.stopPropagation();
    pendingBatch = pendingBatch.filter(p => p.id !== photo.id);
    el.remove();
    updatePreviewCount();
    if (pendingBatch.length === 0) previewSec.style.display = 'none';
  });
  previewGrid.appendChild(el);
  updatePreviewCount();
}

function updatePreviewCount() {
  previewCnt.textContent = `${pendingBatch.length} photo${pendingBatch.length !== 1 ? 's' : ''}`;
}

$('addAllBtn').addEventListener('click', () => {
  if (!pendingBatch.length) return;
  addPhotos([...pendingBatch]);
  closeAddModal();
});

/* ---- Single Drive Link (inside Add Photo modal) ---- */
$('addDriveLinkBtn').addEventListener('click', () => {
  const url = $('driveLinkInput').value.trim();
  if (!url) return;
  const id = gdriveFileId(url);
  if (!id) { showToast('❌ Could not parse Drive link'); return; }

  const src = driveThumbUrl(id);
  const photo = { id: 'gd_' + id, src, caption: '', source: 'gdrive' };

  const img = new Image();
  img.onload = () => {
    if (!pendingBatch.find(p => p.id === photo.id)) {
      pendingBatch.push(photo);
      addPendingThumb(photo);
    }
    $('driveLinkInput').value = '';
    showToast('✅ Drive image loaded!');
  };
  img.onerror = () => showToast('❌ Could not load image — is it shared publicly?');
  img.src = src;
});

/* ================================================================
   GOOGLE DRIVE FOLDER MODAL
   ================================================================ */
const gdriveOverlay = $('gdriveOverlay');

function openDriveModal() {
  const saved = localStorage.getItem(STORAGE_APIKEY) || '';
  $('apiKeyInput').value = saved;
  $('folderUrlInput').value = '';
  $('fetchStatus').textContent = '';
  $('fetchStatus').className = 'fetch-status';
  $('fetchedGrid').style.display = 'none';
  $('addFetchedBtn').style.display = 'none';
  fetchedDrive = [];
  $('fetchedGrid').innerHTML = '';
  gdriveOverlay.classList.add('open');
}

$('fetchFolderBtn').addEventListener('click', async () => {
  const apiKey = $('apiKeyInput').value.trim();
  const folderUrl = $('folderUrlInput').value.trim();
  const statusEl = $('fetchStatus');
  const gridEl = $('fetchedGrid');
  const addBtn = $('addFetchedBtn');

  if (!apiKey) { showToast('⚠️ Enter your Google API key'); return; }
  if (!folderUrl) { showToast('⚠️ Enter a folder URL'); return; }

  const m = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!m) { showToast('❌ Could not parse folder URL'); return; }
  const folderId = m[1];

  localStorage.setItem(STORAGE_APIKEY, apiKey);

  statusEl.textContent = '⏳ Fetching images…';
  statusEl.className = 'fetch-status';
  gridEl.style.display = 'none';
  addBtn.style.display = 'none';
  gridEl.innerHTML = '';
  fetchedDrive = [];

  try {
    const url = `https://www.googleapis.com/drive/v3/files`
      + `?q='${folderId}'+in+parents+and+mimeType+contains+'image/'+and+trashed=false`
      + `&key=${encodeURIComponent(apiKey)}&fields=files(id,name)&pageSize=50`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) {
      statusEl.textContent = `❌ ${data.error.message}`;
      statusEl.className = 'fetch-status err';
      return;
    }

    const files = data.files || [];
    if (!files.length) {
      statusEl.textContent = 'No images found in this folder.';
      return;
    }

    statusEl.textContent = `✅ Found ${files.length} image${files.length !== 1 ? 's' : ''}`;
    statusEl.className = 'fetch-status ok';

    gridEl.style.display = 'grid';
    files.forEach(file => {
      const photo = {
        id: 'gd_' + file.id,
        src: driveThumbUrl(file.id),
        caption: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
        source: 'gdrive',
      };
      fetchedDrive.push(photo);

      const el = document.createElement('div');
      el.className = 'fetched-thumb';
      el.innerHTML = `<img src="${escHtml(photo.src)}" alt="${escHtml(file.name)}" loading="lazy">`;
      gridEl.appendChild(el);
    });

    addBtn.style.display = 'block';

  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    statusEl.className = 'fetch-status err';
  }
});

$('addFetchedBtn').addEventListener('click', () => {
  if (!fetchedDrive.length) return;
  const count = fetchedDrive.length;
  addPhotos([...fetchedDrive]);
  gdriveOverlay.classList.remove('open');
  fetchedDrive = [];
  showToast(`✨ ${count} Drive photos imported!`);
});

/* ---- Bulk Links tab ---- */
$('addBulkLinksBtn').addEventListener('click', () => {
  const lines = $('bulkLinksInput').value
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const batch = [];
  let bad = 0;
  lines.forEach(url => {
    const id = gdriveFileId(url);
    if (id) {
      batch.push({ id: 'gd_' + id + '_' + uid(), src: driveThumbUrl(id), caption: '', source: 'gdrive' });
    } else bad++;
  });

  if (!batch.length) { showToast('❌ No valid Drive links found'); return; }
  addPhotos(batch);
  gdriveOverlay.classList.remove('open');
  $('bulkLinksInput').value = '';
  showToast(bad
    ? `✅ Added ${batch.length} photos (${bad} bad links skipped)`
    : `✨ ${batch.length} photos imported from Drive!`);
});

/* ================================================================
   CAPTION MODAL
   ================================================================ */
const captionOverlay = $('captionOverlay');

function openCaptionModal(id, current) {
  captionId = id;
  $('captionInput').value = current || '';
  captionOverlay.classList.add('open');
  setTimeout(() => $('captionInput').focus(), 280);
}

$('saveCaptionBtn').addEventListener('click', () => {
  if (captionId) {
    updateCaption(captionId, $('captionInput').value.trim());
    showToast('Caption saved!');
  }
  captionOverlay.classList.remove('open');
  captionId = null;
});

$('captionInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('saveCaptionBtn').click();
});

/* ================================================================
   MODAL OPEN / CLOSE WIRING
   ================================================================ */
addPhotoBtn.addEventListener('click', openAddModal);
$('closeAddPhoto').addEventListener('click', closeAddModal);
addOverlay.addEventListener('click', e => { if (e.target === addOverlay) closeAddModal(); });

gdriveBtn.addEventListener('click', openDriveModal);
$('closeGdrive').addEventListener('click', () => gdriveOverlay.classList.remove('open'));
gdriveOverlay.addEventListener('click', e => { if (e.target === gdriveOverlay) gdriveOverlay.classList.remove('open'); });

$('closeCaption').addEventListener('click', () => { captionOverlay.classList.remove('open'); captionId = null; });
captionOverlay.addEventListener('click', e => { if (e.target === captionOverlay) { captionOverlay.classList.remove('open'); captionId = null; } });

/* ---- Music Modal ---- */
const musicOverlay = $('musicOverlay');
const musicTrackBtn = $('musicTrackBtn');
if (musicTrackBtn) {
  musicTrackBtn.addEventListener('click', () => {
    $('musicUrlInput').value = music.getSrc();
    musicOverlay.classList.add('open');
  });
}
if ($('closeMusic')) {
  $('closeMusic').addEventListener('click', () => musicOverlay.classList.remove('open'));
  musicOverlay.addEventListener('click', e => { if (e.target === musicOverlay) musicOverlay.classList.remove('open'); });
}
if ($('saveMusicBtn')) {
  $('saveMusicBtn').addEventListener('click', () => {
    music.setSrc($('musicUrlInput').value.trim());
    musicOverlay.classList.remove('open');
    showToast('Music track updated!');
  });
}

/* ---- Tab switching in Drive modal ---- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    $(tab.dataset.tab + 'Pane').classList.remove('hidden');
  });
});



/* ================================================================
   KEYBOARD NAVIGATION
   ================================================================ */
document.addEventListener('keydown', e => {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goNext(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPrev(); }
});

/* ================================================================
   TOUCH / SWIPE NAVIGATION
   ================================================================ */
let swipeX = 0;
const bookScene = $('bookScene');
bookScene.addEventListener('touchstart', e => {
  swipeX = e.touches[0].clientX;
}, { passive: true });
bookScene.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - swipeX;
  if (Math.abs(dx) > 50) dx < 0 ? goNext() : goPrev();
});

/* ================================================================
   PREV / NEXT BUTTONS
   ================================================================ */
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);

/* ================================================================
   AMBIENT PARTICLES
   ================================================================ */
function initParticles() {
  const container = $('particles');
  const glyphs = ['🌸', '🌺', '🌹', '🥀', '❥', '♥', '❀', '✿'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    p.style.cssText = `
      left: ${Math.random() * 100}vw;
      font-size: ${(Math.random() * 14 + 10)}px;
      color: ${Math.random() > 0.5
        ? 'rgba(183,36,64,0.6)'
        : 'rgba(212,175,55,0.5)'};
      animation-duration: ${(Math.random() * 15 + 10)}s;
      animation-delay:    ${(Math.random() * 18)}s;
    `;
    container.appendChild(p);
  }
}

/* ================================================================
   EXPORT / SHARE  — generates a self-contained read-only HTML album
   ================================================================ */
const exportBtn = $('exportBtn');

exportBtn.addEventListener('click', () => {
  if (photos.length === 0) {
    showToast('⚠️ Add some photos first before exporting!');
    return;
  }
  exportAlbum();
});

function exportAlbum() {
  showToast('⏳ Building your album file…');
  setTimeout(() => {
    try {
      const html = generateReadonlyHTML();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (getTitle() || 'album').replace(/[^\w\s-]/g, '').trim() + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('🎉 Album exported! Open the .html file to share.');
    } catch (e) {
      showToast('❌ Export failed: ' + e.message);
    }
  }, 100);
}

function generateReadonlyHTML() {
  const title = getTitle();
  const photosJson = JSON.stringify(photos.map(p => ({
    id: p.id,
    src: p.src,
    caption: p.caption || ''
  })));
  const quotesJson = JSON.stringify(BACK_QUOTES);
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} ✨</title>
<meta name="description" content="A beautiful photo album — ${safeTitle}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Dancing+Script:wght@600;700&family=Lato:wght@300;400;700&display=swap" rel="stylesheet">
<style>${readonlyCSS()}</style>
</head>
<body>
<div class="ambient-bg"></div>
<audio id="bgAudio" src="${escHtml(localStorage.getItem(STORAGE_MUSIC) || 'assets/romantic.mp3')}" loop></audio>
<div class="particles" id="particles"></div>
<header class="ro-bar">
  <div class="ro-album-title">${safeTitle}</div>
  <div class="ro-status">
    <div class="page-dots" id="pageDots"></div>
    <span class="page-label" id="pageLabel">Cover</span>
  </div>
  <button class="ro-music" id="musicBtn" title="Toggle music">🎵</button>
</header>
<main class="scene">
  <button class="nav-arrow" id="prevBtn" disabled aria-label="Previous page">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none"><polyline points="15 18 9 12 15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div class="book-scene" id="bookScene">
    <div class="book-drop-shadow"></div>
    <div class="book-container">
      <div class="book" id="book">
        <div class="endpaper left-endpaper"></div>
        <div class="endpaper right-endpaper"></div>
      </div>
    </div>
  </div>
  <button class="nav-arrow" id="nextBtn" aria-label="Next page">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none"><polyline points="9 18 15 12 9 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
</main>
<script>
'use strict';
const ALBUM_TITLE=${JSON.stringify(title)};
const PHOTOS=${photosJson};
const BACK_QUOTES=${quotesJson};
${readonlyJS()}
<\/script>
</body>
</html>`;
}

/* ---- Readonly CSS (self-contained, no external files) ---- */
function readonlyCSS() {
  return `:root{
  --cover-deep:#601323;--cover-mid:#8b1c31;--cover-light:#b72440;--cover-spine:#380a13;
  --gold:#C9A453;--gold-light:#E5C87A;--gold-dim:#9B7833;
  --page-bg:#FFFDF6;--page-line:rgba(180,160,120,0.08);
  --ink-dark:#2A1E10;--ink-mid:#5A4A35;--ink-light:#8A7A60;
  --page-w:400px;--page-h:555px;
  --font-display:'Playfair Display',Georgia,serif;
  --font-script:'Dancing Script',cursive;
  --font-body:'Lato',-apple-system,sans-serif;
  --flip-dur:0.85s;--flip-ease:cubic-bezier(0.645,0.045,0.355,1.000);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{height:100%}
body{min-height:100vh;font-family:var(--font-body);display:flex;flex-direction:column;overflow:hidden;user-select:none;-webkit-user-select:none;background:linear-gradient(145deg,#FFF3F5 0%,#F5E8D0 45%,#FFEDF0 100%)}
.ambient-bg{position:fixed;inset:0;z-index:0;background:radial-gradient(ellipse 60% 50% at 15% 50%,rgba(212,175,55,.13) 0%,transparent 60%),radial-gradient(ellipse 55% 45% at 85% 20%,rgba(139,28,49,.15) 0%,transparent 55%),radial-gradient(ellipse 50% 55% at 55% 85%,rgba(183,36,64,.1) 0%,transparent 60%),linear-gradient(145deg,#FFF3F5 0%,#F5E8D0 45%,#FFEDF0 100%);pointer-events:none}
.particles{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.particle{position:absolute;top:-5vh;opacity:0;animation:floatDown linear infinite;color:var(--cover-light)}
@keyframes floatDown{0%{transform:translateY(0) rotate(0deg);opacity:0}8%{opacity:.65}90%{opacity:.45}100%{transform:translateY(105vh) rotate(540deg);opacity:0}}
.ro-bar{position:relative;z-index:200;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;background:rgba(255,255,255,.85);backdrop-filter:blur(20px);border-bottom:1px solid rgba(201,164,83,.25);box-shadow:0 2px 24px rgba(0,0,0,.07)}
.ro-album-title{font-family:var(--font-script);font-size:20px;color:var(--cover-mid);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ro-status{display:flex;flex-direction:column;align-items:center;gap:5px;flex:2}
.page-label{font-family:var(--font-display);font-size:12px;font-style:italic;color:var(--ink-mid)}
.page-dots{display:flex;gap:5px;align-items:center}
.pdot{width:7px;height:7px;border-radius:50%;background:rgba(139,28,49,.18);transition:all .3s}
.pdot.visited{background:var(--gold)}.pdot.active{background:var(--cover-mid);transform:scale(1.4)}
.ro-music{background:none;border:1.5px solid rgba(139,28,49,.18);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .22s;flex-shrink:0}
.ro-music:hover{background:var(--cover-mid);border-color:transparent}
.ro-music.playing{background:linear-gradient(135deg,var(--gold-dim),var(--gold));border-color:transparent}
.scene{position:relative;z-index:1;flex:1;display:flex;align-items:center;justify-content:center;padding:18px 0;overflow:hidden}
.nav-arrow{flex-shrink:0;width:50px;height:50px;border:none;border-radius:50%;background:rgba(255,255,255,.82);backdrop-filter:blur(10px);color:var(--cover-mid);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 18px rgba(0,0,0,.12);transition:all .25s;margin:0 12px}
.nav-arrow:hover:not(:disabled){background:var(--cover-mid);color:white;transform:scale(1.1);box-shadow:0 5px 22px rgba(139,28,49,.38)}
.nav-arrow:disabled{opacity:.28;cursor:not-allowed}
.book-scene{position:relative;perspective:2800px;perspective-origin:50% 50%}
.book-drop-shadow{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);width:calc(var(--page-w)*1.7);height:36px;background:radial-gradient(ellipse at center,rgba(0,0,0,.38) 0%,transparent 72%);filter:blur(10px);z-index:0;pointer-events:none}
.book-container{position:relative;z-index:1}
.book{position:relative;width:calc(var(--page-w)*2);height:var(--page-h);transform-style:preserve-3d}
.book::before{content:'';position:absolute;left:calc(50% - 5px);top:0;width:10px;height:100%;background:linear-gradient(90deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,.12) 35%,rgba(255,255,255,.08) 50%,rgba(0,0,0,.12) 65%,rgba(0,0,0,.35) 100%);z-index:500;pointer-events:none}
.book::after{content:'';position:absolute;inset:0;box-shadow:-6px 0 18px -4px rgba(0,0,0,.3),6px 0 18px -4px rgba(0,0,0,.22),0 2px 12px -2px rgba(0,0,0,.28);pointer-events:none;z-index:501}
.endpaper{position:absolute;top:0;width:50%;height:100%;z-index:0}
.left-endpaper{left:0;background:repeating-linear-gradient(45deg,transparent,transparent 1px,rgba(255,255,255,.025) 1px,rgba(255,255,255,.025) 2px),linear-gradient(160deg,#601323 0%,#380a13 100%)}
.right-endpaper{left:50%;background:var(--page-bg);background-image:repeating-linear-gradient(0deg,transparent,transparent 27px,var(--page-line) 28px)}
.leaf{position:absolute;left:50%;top:0;width:50%;height:100%;transform-origin:left center;transform-style:preserve-3d;transition:transform var(--flip-dur) var(--flip-ease);cursor:pointer}
.leaf.flipped{transform:rotateY(-180deg)}
.leaf.animating{z-index:9000!important;filter:drop-shadow(-6px 4px 16px rgba(0,0,0,.28))}
.leaf-front,.leaf-back{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
.leaf-back{transform:rotateY(180deg)}
.leaf-front::after{content:'';position:absolute;right:0;top:0;width:24px;height:100%;background:linear-gradient(270deg,rgba(0,0,0,.10) 0%,transparent 100%);pointer-events:none;z-index:5}
.leaf-back::after{content:'';position:absolute;left:0;top:0;width:24px;height:100%;background:linear-gradient(90deg,rgba(0,0,0,.10) 0%,transparent 100%);pointer-events:none;z-index:5}
.cover-page{width:100%;height:100%;position:relative;overflow:hidden}
.cover-front{background:repeating-linear-gradient(45deg,transparent,transparent 1px,rgba(255,255,255,.025) 1px,rgba(255,255,255,.025) 2px),repeating-linear-gradient(-45deg,transparent,transparent 1px,rgba(0,0,0,.02) 1px,rgba(0,0,0,.02) 2px),linear-gradient(155deg,#8b1c31 0%,#b72440 38%,#601323 68%,#380a13 100%)}
.cover-front::before{content:'';position:absolute;inset:9px;border:2px solid rgba(201,164,83,.72);pointer-events:none}
.cover-front::after{content:'';position:absolute;inset:14px;border:1px solid rgba(201,164,83,.28);pointer-events:none}
.cover-back{background:repeating-linear-gradient(45deg,transparent,transparent 1px,rgba(255,255,255,.02) 1px,rgba(255,255,255,.02) 2px),linear-gradient(155deg,#380a13 0%,#601323 50%,#380a13 100%)}
.cover-back::before{content:'';position:absolute;inset:9px;border:2px solid rgba(201,164,83,.5);pointer-events:none}
.cover-back::after{content:'';position:absolute;inset:14px;border:1px solid rgba(201,164,83,.2);pointer-events:none}
.cv-corner{position:absolute;width:36px;height:36px;border:2px solid var(--gold);opacity:.72}
.cv-corner.tl{top:18px;left:18px;border-right:none;border-bottom:none}
.cv-corner.tr{top:18px;right:18px;border-left:none;border-bottom:none}
.cv-corner.bl{bottom:18px;left:18px;border-right:none;border-top:none}
.cv-corner.br{bottom:18px;right:18px;border-left:none;border-top:none}
.cover-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:50px 28px 40px;gap:12px}
.cover-emblem-ring{width:72px;height:72px;border-radius:50%;border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;background:rgba(201,164,83,.08);box-shadow:0 0 0 5px rgba(201,164,83,.08),0 0 0 8px rgba(201,164,83,.04),0 0 20px rgba(201,164,83,.15);animation:ringPulse 5s ease-in-out infinite;flex-shrink:0}
@keyframes ringPulse{0%,100%{box-shadow:0 0 0 5px rgba(201,164,83,.08),0 0 0 8px rgba(201,164,83,.04),0 0 20px rgba(201,164,83,.15)}50%{box-shadow:0 0 0 5px rgba(201,164,83,.14),0 0 0 9px rgba(201,164,83,.07),0 0 30px rgba(201,164,83,.25)}}
.cover-emblem-icon{font-size:32px;line-height:1}
.cover-rule{width:82%;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:4px 0;flex-shrink:0}
.cover-title{font-family:var(--font-script);font-size:clamp(22px,4vw,38px);color:var(--gold-light);text-align:center;line-height:1.25;text-shadow:0 2px 12px rgba(0,0,0,.55),0 0 30px rgba(201,164,83,.25);width:100%;word-break:break-word}
.cover-subtitle{font-family:var(--font-body);font-weight:300;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:rgba(201,164,83,.65);text-align:center}
.cover-year{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);font-family:var(--font-display);font-style:italic;font-size:12px;color:rgba(201,164,83,.5);white-space:nowrap}
.back-cover-content{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:50px 32px;gap:14px}
.back-cover-icon{font-size:26px;opacity:.65}
.back-cover-line{width:56%;height:1px;background:linear-gradient(90deg,transparent,var(--gold-dim),transparent)}
.back-cover-quote{font-family:var(--font-script);font-size:17px;color:rgba(201,164,83,.75);text-align:center;line-height:1.65;max-width:230px;text-shadow:0 2px 10px rgba(0,0,0,.4)}
.content-page{width:100%;height:100%;background:var(--page-bg);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 22px 36px;gap:10px;background-image:repeating-linear-gradient(0deg,transparent,transparent 27px,var(--page-line) 28px)}
.content-page::before{content:'';position:absolute;inset:7px;border:1px solid rgba(180,155,110,.28);pointer-events:none;z-index:1}
.leaf-back .content-page::after{content:'';position:absolute;right:0;top:0;width:30px;height:100%;background:linear-gradient(270deg,rgba(0,0,0,.055) 0%,transparent 100%);pointer-events:none}
.leaf-front .content-page::after{content:'';position:absolute;left:0;top:0;width:30px;height:100%;background:linear-gradient(90deg,rgba(0,0,0,.055) 0%,transparent 100%);pointer-events:none}
.page-ornament{position:absolute;top:15px;font-size:13px;color:rgba(201,164,83,.45);z-index:2;line-height:1}
.leaf-front .page-ornament{left:18px}.leaf-back .page-ornament{right:18px}
.page-num{position:absolute;bottom:15px;font-family:var(--font-display);font-style:italic;font-size:11px;color:var(--ink-light);z-index:2}
.leaf-front .page-num{right:18px}.leaf-back .page-num{left:18px}
.photo-frame{flex:1;width:100%;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.photo-wrapper{position:relative;display:inline-block;line-height:0}
.photo-img{display:block;max-width:calc(var(--page-w) - 64px);max-height:calc(var(--page-h) - 130px);width:auto;height:auto;border:9px solid #fff;outline:1px solid rgba(0,0,0,.06);box-shadow:0 3px 10px rgba(0,0,0,.14),0 10px 30px rgba(0,0,0,.1);transition:transform .3s,box-shadow .3s}
.photo-img:hover{transform:scale(1.025)}
.photo-caption{font-family:var(--font-display);font-style:italic;font-size:12.5px;color:var(--ink-mid);text-align:center;line-height:1.45;max-width:calc(var(--page-w) - 50px);min-height:16px;flex-shrink:0}
.empty-page-inner{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:.35;pointer-events:none}
.img-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;background:rgba(0,0,0,.04);border-radius:8px;border:2px dashed rgba(0,0,0,.12);min-width:100px;min-height:100px;color:var(--ink-light);font-size:11px;text-align:center;font-family:var(--font-display);font-style:italic;line-height:1.5}
.img-error-icon{font-size:26px;display:block;margin-bottom:4px}
@media(max-width:1050px){:root{--page-w:340px;--page-h:475px}}
@media(max-width:820px){:root{--page-w:280px;--page-h:395px}.nav-arrow{width:42px;height:42px;margin:0 4px}}
@media(max-width:640px){:root{--page-w:220px;--page-h:310px}.cover-title{font-size:18px}.cover-emblem-ring{width:52px;height:52px}.cover-emblem-icon{font-size:22px}.scene{padding:10px 0;touch-action:pan-y}.nav-arrow{position:absolute;z-index:900;background:rgba(255,255,255,0.6)}#prevBtn{left:4px}#nextBtn{right:4px}}
@media(max-width:480px){:root{--page-w:175px;--page-h:245px}.nav-arrow{width:34px;height:34px}.cover-subtitle{display:none}}`;
}

/* ---- Readonly JS (self-contained viewer, no edit controls) ---- */
function readonlyJS() {
  return `
// === MUSIC ENGINE ===
class AudioController{
  constructor(){this.playing=false;var bg=document.getElementById('bgAudio');this.bg=bg;}
  start(){if(this.bg){this.playing=true;this.bg.play().catch(function(e){console.log('Audio autoplay prevented',e)});}}
  stop(){if(this.bg){this.playing=false;this.bg.pause();}}
  toggle(){this.playing?this.stop():this.start();return this.playing;}
}
var music=new AudioController();

// === STATE ===
var currentLeaf=0,totalLeaves=0,isAnimating=false;
var book=document.getElementById('book');
var prevBtn=document.getElementById('prevBtn');
var nextBtn=document.getElementById('nextBtn');
var pageLabel=document.getElementById('pageLabel');
var pageDots=document.getElementById('pageDots');
var musicBtn=document.getElementById('musicBtn');

function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}

// === BOOK DATA ===
function buildPages(){
  var pages=[{type:'cover'}];
  for(var i=0;i<PHOTOS.length;i++)pages.push({type:'photo',photo:PHOTOS[i]});
  pages.push({type:'back'});
  if(pages.length%2!==0)pages.push({type:'empty'});
  return pages;
}

function renderBook(){
  var pages=buildPages();
  totalLeaves=pages.length/2;
  if(currentLeaf>totalLeaves)currentLeaf=totalLeaves;
  var old=book.querySelectorAll('.leaf');
  for(var x=0;x<old.length;x++)old[x].remove();
  for(var k=0;k<totalLeaves;k++){
    var front=pages[2*k],back=pages[2*k+1];
    var leaf=document.createElement('div');leaf.className='leaf';leaf.dataset.idx=k;
    var fF=document.createElement('div');fF.className='leaf-front';fF.appendChild(buildEl(front,'front',2*k,pages.length));
    var fB=document.createElement('div');fB.className='leaf-back';fB.appendChild(buildEl(back,'back',2*k+1,pages.length));
    leaf.appendChild(fF);leaf.appendChild(fB);book.appendChild(leaf);
  }
  applyFlip();updateNav();updateStatus();
}

function buildEl(page,face,idx){
  if(!page||page.type==='empty')return mkEmpty();
  if(page.type==='cover')return mkCover();
  if(page.type==='back')return mkBack();
  if(page.type==='photo')return mkPhoto(page.photo,idx);
  return mkEmpty();
}

function mkCover(){
  var d=document.createElement('div');d.className='cover-page cover-front';
  d.innerHTML='<div class="cv-corner tl"></div><div class="cv-corner tr"></div><div class="cv-corner bl"></div><div class="cv-corner br"></div>'+
    '<div class="cover-content">'+
    '<div class="cover-emblem-ring"><span class="cover-emblem-icon">\u{1F4F7}</span></div>'+
    '<div class="cover-rule"></div>'+
    '<div class="cover-title">'+esc(ALBUM_TITLE)+'</div>'+
    '<div class="cover-subtitle">A Cherished Collection</div>'+
    '<div class="cover-rule"></div>'+
    '</div>'+
    '<div class="cover-year">'+new Date().getFullYear()+'</div>';
  return d;
}

function mkBack(){
  var quote=BACK_QUOTES[Math.floor(Math.random()*BACK_QUOTES.length)];
  var d=document.createElement('div');d.className='cover-page cover-back';
  d.innerHTML='<div class="cv-corner tl"></div><div class="cv-corner tr"></div><div class="cv-corner bl"></div><div class="cv-corner br"></div>'+
    '<div class="back-cover-content">'+
    '<div class="back-cover-icon">\u2728</div>'+
    '<div class="back-cover-line"></div>'+
    '<div class="back-cover-quote">'+esc(quote)+'</div>'+
    '<div class="back-cover-line"></div>'+
    '<div class="back-cover-icon">\ud83d\udcf8</div>'+
    '</div>';
  return d;
}

function mkPhoto(photo,idx){
  var d=document.createElement('div');d.className='content-page';
  var f=document.createElement('div');f.className='photo-frame';
  var w=document.createElement('div');w.className='photo-wrapper';
  var img=document.createElement('img');img.className='photo-img';
  img.src=photo.src;img.alt=esc(photo.caption||'Memory');img.loading='lazy';img.draggable=false;
  img.onerror=function(){this.style.display='none';var ph=document.createElement('div');ph.className='img-error';ph.innerHTML='<span class="img-error-icon">\ud83d\uddbc\ufe0f</span><span>Could not load image</span>';this.parentNode.appendChild(ph);};
  w.appendChild(img);f.appendChild(w);
  var orn=document.createElement('div');orn.className='page-ornament';orn.textContent='\u2726';
  var cap=document.createElement('div');cap.className='photo-caption';cap.textContent=photo.caption||'';
  var num=document.createElement('div');num.className='page-num';num.textContent=idx;
  d.appendChild(orn);d.appendChild(f);d.appendChild(cap);d.appendChild(num);
  return d;
}

function mkEmpty(){
  var d=document.createElement('div');d.className='content-page';
  d.innerHTML='<div class="empty-page-inner"><div style="font-size:38px;opacity:.3">\ud83d\uddbc\ufe0f</div></div>';
  return d;
}

// === FLIP LOGIC ===
function applyFlip(){
  var leaves=book.querySelectorAll('.leaf');
  for(var i=0;i<leaves.length;i++){
    var lf=leaves[i];
    lf.classList.toggle('flipped',i<currentLeaf);
    lf.style.zIndex=i<currentLeaf?(i+1):(totalLeaves-i+1);
  }
}

function goNext(){
  if(isAnimating||currentLeaf>=totalLeaves)return;
  isAnimating=true;
  var leaves=book.querySelectorAll('.leaf'),t=leaves[currentLeaf];
  if(!t){isAnimating=false;return;}
  
  t.style.zIndex=9999;t.classList.add('animating');
  requestAnimationFrame(function(){t.classList.add('flipped');});
  setTimeout(function(){currentLeaf++;t.classList.remove('animating');applyFlip();updateNav();updateStatus();isAnimating=false;},900);
}

function goPrev(){
  if(isAnimating||currentLeaf<=0)return;
  isAnimating=true;
  var leaves=book.querySelectorAll('.leaf'),t=leaves[currentLeaf-1];
  if(!t){isAnimating=false;return;}
  
  t.style.zIndex=9999;t.classList.add('animating');
  requestAnimationFrame(function(){t.classList.remove('flipped');});
  setTimeout(function(){currentLeaf--;t.classList.remove('animating');applyFlip();updateNav();updateStatus();isAnimating=false;},900);
}

function updateNav(){prevBtn.disabled=currentLeaf===0;nextBtn.disabled=currentLeaf>=totalLeaves;}

function updateStatus(){
  if(currentLeaf===0)pageLabel.textContent='Cover';
  else if(currentLeaf>=totalLeaves)pageLabel.textContent='Back Cover';
  else pageLabel.textContent='Pages '+(currentLeaf*2-1)+' \u2013 '+(currentLeaf*2);
  var total=Math.min(totalLeaves+1,14),pos=Math.min(currentLeaf,total-1);
  pageDots.innerHTML='';
  for(var i=0;i<total;i++){
    var dot=document.createElement('span');
    dot.className='pdot'+(i<pos?' visited':'')+(i===pos?' active':'');
    pageDots.appendChild(dot);
  }
}

// === EVENTS ===
document.getElementById('bookScene').addEventListener('click',function(e){
  if(isAnimating)return;
  var r=book.getBoundingClientRect(),x=e.clientX-r.left;
  if(x>r.width/2)goNext();else goPrev();
});
prevBtn.addEventListener('click',goPrev);
nextBtn.addEventListener('click',goNext);
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();goNext();}
  if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();goPrev();}
});
var swipeX=0;
document.getElementById('bookScene').addEventListener('touchstart',function(e){swipeX=e.touches[0].clientX;},{passive:true});
document.getElementById('bookScene').addEventListener('touchend',function(e){
  var dx=e.changedTouches[0].clientX-swipeX;
  if(Math.abs(dx)>50){if(dx<0)goNext();else goPrev();}
});
musicBtn.addEventListener('click',function(){
  var p=music.toggle();
  musicBtn.classList.toggle('playing',p);
  musicBtn.textContent=p?'\ud83d\udd07':'\ud83c\udfb5';
});

// === PARTICLES ===
function initParticles(){
  var c=document.getElementById('particles'),g=['🌸','🌺','🌹','🥀','❥','♥','❀','✿'];
  for(var i=0;i<18;i++){
    var p=document.createElement('span');p.className='particle';
    p.textContent=g[Math.floor(Math.random()*g.length)];
    p.style.cssText='left:'+Math.random()*100+'vw;font-size:'+(Math.random()*14+10)+'px;color:'+(Math.random()>.5?'rgba(183,36,64,.6)':'rgba(212,175,55,.5)')+';animation-duration:'+(Math.random()*15+10)+'s;animation-delay:'+(Math.random()*18)+'s;';
    c.appendChild(p);
  }
}

renderBook();
initParticles();
`;
}

/* ================================================================
   TOAST
   ================================================================ */
let toastTmr;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => toast.classList.remove('show'), 3200);
}

/* ================================================================
   UTILITY
   ================================================================ */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  if (isAdmin) {
    document.body.classList.add('admin-mode');
  }
  loadPhotos();
  renderBook();
  initParticles();
  if (isAdmin && photos.length === 0) {
    setTimeout(() => showToast('📷 Welcome! Click "Add Photo" to start your album'), 1000);
  }

  // Setup interaction to start music automatically
  const startMusic = () => {
    if (!music.playing) {
      music.start();
      const mi = document.getElementById('musicIndicator');
      if (mi) mi.classList.add('playing');
    }
    // Remove listeners after first interaction
    document.removeEventListener('click', startMusic);
    document.removeEventListener('keydown', startMusic);
    document.removeEventListener('touchstart', startMusic);
  };

  document.addEventListener('click', startMusic);
  document.addEventListener('keydown', startMusic);
  document.addEventListener('touchstart', startMusic);
}

init();
