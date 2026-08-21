/* --------------------------------------------------------------------------
   GALLERY LOGIC  -  windowed / virtualized grid
   --------------------------------------------------------------------------
   The page can hold hundreds of photos and videos and stay smooth because it
   never loads them all at once. Three ideas do the heavy lifting:

   1. RESERVE HEIGHT UP FRONT. Every tile is given its final height the moment
      the page builds - from real dimensions if the manifest provides them, or
      from a neutral square placeholder otherwise. So the page has its correct
      total height (and an accurate scrollbar) before a single image downloads.

   2. MOUNT ON DEMAND. A tile only attaches its real <img>/<video> when it is
      about to scroll into view (an IntersectionObserver watches each tile with
      a ~1.5-screen lookahead). Tiles far below the fold cost almost nothing.

   3. UNMOUNT WHEN FAR AWAY. Tiles that scroll more than ~6 screens off get
      their media detached again, so memory stays flat even with 300+ items.
      Their reserved height never changes, so nothing shifts.

   Media is loaded from the `assets/Gallery/` folder using one of two strategies:
     1. Directory listing - fetch `assets/Gallery/` and parse the HTML index
        (works on Apache/nginx static servers with autoindex on).
     2. File-list JSON    - fetch `assets/FileNames.json`. Works on every static
        host (GitHub Pages, Netlify, Vercel). Two accepted shapes:
          { "files": ["a.webp", "b.mp4", ...] }                      (current)
          { "files": [{ "name": "a.webp", "w": 1200, "h": 800 }, ...] }  (optional)
        Adding w/h is OPTIONAL - when present, tiles get their exact height with
        zero layout shift and off-screen images never need to load just to be
        measured. Plain filename strings keep working exactly as before.
     Tries (1) first; falls back to (2). If both fail, shows the empty state.

   To regenerate assets/FileNames.json, run this in cmd from the assets/ folder:
     (echo {"files":[ & (for %F in (Gallery\*.jpg Gallery\*.jpeg Gallery\*.png Gallery\*.gif Gallery\*.webp Gallery\*.avif Gallery\*.mp4 Gallery\*.webm Gallery\*.mov Gallery\*.m4v) do @echo "%~nxF",) & echo ]}) > FileNames.json
   (then remove the trailing comma after the last entry, or use the .bat helper.)
   -------------------------------------------------------------------------- */

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];

/* How far ahead of the viewport (in screen-heights) to start loading a tile,
   and how far behind to unload it again. Mount window is generous enough that
   tiles are ready before you reach them; unmount window is large enough that
   normal scrolling never tears down something you're about to see again. */
const MOUNT_SCREENS  = 1.5;
const UNMOUNT_SCREENS = 6;

/* Default placeholder shape used to reserve a tile's height before its real
   dimensions are known (1 = square). Snapped to the true ratio once loaded. */
const DEFAULT_ASPECT = 1;

function classify(filename) {
  const ext = (String(filename).toLowerCase().match(/\.[^.]+$/) || [''])[0];
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

/* Normalize one manifest entry to { name, w, h }. Accepts a bare filename
   string, or an object carrying optional width/height under several key names. */
function normalizeEntry(entry) {
  if (typeof entry === 'string') return { name: entry, w: 0, h: 0 };
  if (entry && typeof entry === 'object') {
    const name = entry.name || entry.file || entry.filename;
    if (!name) return null;
    const w = Number(entry.w || entry.width)  || 0;
    const h = Number(entry.h || entry.height) || 0;
    return { name: String(name), w, h };
  }
  return null;
}

/* ─── FILE-LIST LOADERS ─── */

/* Strategy 1: parse a server-side directory listing. Returns [{name,w,h}]. */
async function fetchByDirectoryListing() {
  try {
    const res = await fetch('assets/Gallery/');
    if (!res.ok) return [];
    const html = await res.text();
    if (html.trim().startsWith('{') || html.trim().startsWith('[')) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('?') || href.startsWith('#')) return;
      if (href === '../' || href === './' || href.endsWith('/')) return;
      if (/^[a-z]+:\/\//i.test(href) && !href.includes(location.host)) return;
      const name = decodeURIComponent(href.split('/').pop().split('?')[0]);
      if (classify(name)) out.push({ name, w: 0, h: 0 });
    });
    return out;
  } catch (e) {
    return [];
  }
}

/* Strategy 2: read assets/FileNames.json. Returns [{name,w,h}]. */
async function fetchByManifest() {
  try {
    const res = await fetch('assets/FileNames.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data
               : (data && Array.isArray(data.files) ? data.files : null);
    if (!list) return [];
    const out = [];
    list.forEach(e => {
      const n = normalizeEntry(e);
      if (n && classify(n.name)) out.push(n);
    });
    return out;
  } catch (e) {
    return [];
  }
}

/* Load the file list using both strategies (directory listing first). */
async function loadGallery() {
  let files = await fetchByDirectoryListing();
  if (files.length === 0) files = await fetchByManifest();
  return files;
}

/* ─── LAYOUT METRICS ───
   Read the grid's row unit, gap and a real column width ONCE (and again on
   resize). Everything downstream computes spans from these cached numbers, so
   loading an image never forces a per-image layout read - the old code's main
   source of jank. */
const GRID = document.getElementById('galleryGrid');
const metrics = { colWidth: 0, rowH: 6, gap: 12 };
let DEFAULT_SPAN = 1;

function measureMetrics() {
  const cs = getComputedStyle(GRID);
  metrics.rowH = parseFloat(cs.getPropertyValue('grid-auto-rows')) || 6;
  metrics.gap  = parseFloat(cs.getPropertyValue('row-gap'))
              || parseFloat(cs.getPropertyValue('gap')) || 12;
  // Measure an actual rendered cell - accounts for the `1fr` distribution that
  // a pure template calculation would miss.
  const cell = GRID.firstElementChild;
  if (cell) {
    const w = cell.getBoundingClientRect().width;
    if (w) metrics.colWidth = w;
  }
  if (!metrics.colWidth) metrics.colWidth = 160; // pre-build fallback estimate
  DEFAULT_SPAN = spanFor(1, DEFAULT_ASPECT);
}

/* Convert an aspect ratio into a grid-row span using the cached column width.
   span N occupies: N*rowH + (N-1)*gap  →  N = (px + gap) / (rowH + gap). */
function spanFor(w, h) {
  if (!w || !h || !metrics.colWidth) return DEFAULT_SPAN || 1;
  const px = metrics.colWidth * (h / w);
  return Math.max(1, Math.ceil((px + metrics.gap) / (metrics.rowH + metrics.gap)));
}

function reserveSpan(it) {
  const span = (it.w && it.h) ? spanFor(it.w, it.h) : DEFAULT_SPAN;
  it.el.style.gridRowEnd = 'span ' + span;
}

/* ─── ITEM STATE ─── */
let ITEMS = [];

/* Build a lightweight placeholder cell - no media yet. The real <img>/<video>
   is attached later by mountMedia() when the tile nears the viewport. */
function createCell(it, i) {
  const el = document.createElement('div');
  el.className = 'gallery-item is-placeholder';
  el.dataset.index = String(i);
  el.dataset.kind = it.kind;
  if (it.kind === 'video') {
    const badge = document.createElement('span');
    badge.className = 'gallery-video-badge';
    badge.textContent = 'Video';
    el.appendChild(badge);
  }
  el.addEventListener('click', () => openModalAt(i));
  it.el = el;
  return el;
}

/* Attach the real media to a tile. Called when the tile scrolls near view. */
function mountMedia(it) {
  if (it.mounted) return;
  it.mounted = true;

  if (it.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'media';
    img.alt = it.name;
    img.decoding = 'async';
    img.loading = 'lazy';            // harmless extra backstop
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        it.w = img.naturalWidth;
        it.h = img.naturalHeight;
        it.loaded = true;
        reserveSpan(it);             // snap to true ratio (no getBoundingClientRect)
      }
      it.el.classList.remove('is-placeholder');
      img.classList.add('loaded');
    }, { once: true });
    img.addEventListener('error', () => { it.el.style.display = 'none'; }, { once: true });
    img.src = it.url;
    it.media = img;
    it.el.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.className = 'media';
    video.src = it.url;
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth && video.videoHeight) {
        it.w = video.videoWidth;
        it.h = video.videoHeight;
        it.loaded = true;
        reserveSpan(it);
      }
      it.el.classList.remove('is-placeholder');
      video.classList.add('loaded');
    }, { once: true });
    video.addEventListener('error', () => { it.el.style.display = 'none'; }, { once: true });
    it.media = video;
    it.el.insertBefore(video, it.el.firstChild); // keep the badge layered on top
  }
}

/* Detach media from a tile that has scrolled far away - frees memory/decoded
   bitmaps. The reserved height is kept, so re-mounting causes no layout shift. */
function unmountMedia(it) {
  if (!it.mounted) return;
  it.mounted = false;
  const m = it.media;
  if (m) {
    if (it.kind === 'video') { try { m.pause(); } catch (_) {} }
    m.removeAttribute('src');
    if (it.kind === 'video' && m.load) { try { m.load(); } catch (_) {} }
    m.remove();
  }
  it.media = null;
  it.el.classList.add('is-placeholder');
}

/* ─── WINDOWING (IntersectionObservers) ───
   mountObs fires when a tile enters the lookahead zone → attach media.
   evictObs fires when a tile leaves the larger zone → detach media. */
let mountObs = null;
let evictObs = null;

function setupObservers() {
  const vh = window.innerHeight || 800;
  if (mountObs) mountObs.disconnect();
  if (evictObs) evictObs.disconnect();

  mountObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const it = ITEMS[+e.target.dataset.index];
        if (it) mountMedia(it);
      }
    }
  }, { root: null, rootMargin: Math.round(vh * MOUNT_SCREENS) + 'px 0px' });

  evictObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) {
        const it = ITEMS[+e.target.dataset.index];
        if (it) unmountMedia(it);
      }
    }
  }, { root: null, rootMargin: Math.round(vh * UNMOUNT_SCREENS) + 'px 0px' });

  ITEMS.forEach(it => { mountObs.observe(it.el); evictObs.observe(it.el); });
}

/* Recompute spans on resize (column width changes). Uses each item's known
   dimensions where it has them, the default square otherwise. Debounced, and
   does no per-image layout reads. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    measureMetrics();
    ITEMS.forEach(reserveSpan);
    setupObservers(); // viewport height changed → refresh the windows
  }, 150);
}, { passive: true });

/* ─── MODAL STATE & BEHAVIOUR ─── */
const galleryState = { items: [], index: 0 };

/* Warm the next/previous image so arrow navigation feels instant. */
function preloadNeighbors() {
  const n = galleryState.items.length;
  if (n < 2) return;
  [1, -1].forEach(d => {
    const it = galleryState.items[((galleryState.index + d) % n + n) % n];
    if (it && it.kind === 'image') { const im = new Image(); im.src = it.url; }
  });
}

function openModalAt(index) {
  if (!galleryState.items.length) return;
  const n = galleryState.items.length;
  galleryState.index = ((index % n) + n) % n;
  const item = galleryState.items[galleryState.index];
  const stage = document.getElementById('modalStage');
  stage.innerHTML = '';
  if (item.kind === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.name;
    stage.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = item.url;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    stage.appendChild(video);
  }
  document.getElementById('modalCounter').textContent =
    `${galleryState.index + 1} / ${n}`;
  const showNav = n > 1;
  document.getElementById('modalPrev').hidden = !showNav;
  document.getElementById('modalNext').hidden = !showNav;
  const modal = document.getElementById('modal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  preloadNeighbors();
}

function closeModal() {
  const modal = document.getElementById('modal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
  const stage = document.getElementById('modalStage');
  const v = stage.querySelector('video');
  if (v) { try { v.pause(); } catch (_) {} }
  stage.innerHTML = '';
}

function shift(delta) {
  openModalAt(galleryState.index + delta);
}

/* ─── INIT ─── */
async function init() {
  const loadingEl = document.getElementById('galleryLoading');
  const grid      = document.getElementById('galleryGrid');
  const empty     = document.getElementById('galleryEmpty');
  const meta      = document.getElementById('galleryMeta');

  const files = await loadGallery();
  loadingEl.hidden = true;

  if (files.length === 0) {
    empty.hidden = false;
    return;
  }

  ITEMS = files.map((f, i) => ({
    name: f.name,
    url: 'assets/Gallery/' + f.name,
    kind: classify(f.name),
    w: f.w || 0,
    h: f.h || 0,
    el: null,
    media: null,
    mounted: false,
    loaded: false,
    index: i,
  }));
  galleryState.items = ITEMS;

  grid.hidden = false;

  // Phase 1 - build every placeholder cell in one fragment, insert once.
  const frag = document.createDocumentFragment();
  ITEMS.forEach((it, i) => frag.appendChild(createCell(it, i)));
  grid.appendChild(frag);

  // Phase 2 - measure real geometry, then reserve each tile's true height so
  // the page is its correct length before any media downloads.
  measureMetrics();
  ITEMS.forEach(reserveSpan);

  // Phase 3 - start the windowed loading (or mount everything if IO is absent).
  if ('IntersectionObserver' in window) {
    setupObservers();
  } else {
    ITEMS.forEach(mountMedia);
  }

  document.getElementById('itemCount').innerHTML =
    `<strong>${files.length}</strong> ${files.length === 1 ? 'item' : 'items'}`;
  meta.hidden = false;
}

/* ─── EVENT BINDINGS ─── */
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalPrev').addEventListener('click', (e) => {
  e.stopPropagation();
  shift(-1);
});
document.getElementById('modalNext').addEventListener('click', (e) => {
  e.stopPropagation();
  shift(1);
});
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  const open = document.getElementById('modal').classList.contains('open');
  if (!open) return;
  if (e.key === 'Escape')           closeModal();
  else if (e.key === 'ArrowRight') { e.preventDefault(); shift(1); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); shift(-1); }
});

init();

