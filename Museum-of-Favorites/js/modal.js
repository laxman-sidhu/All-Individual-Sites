/**
 * Museum of Favorites — Exhibit modal
 * Fullscreen glass modal showing one exhibit. When an exhibit has more
 * than one image it becomes a carousel: previous / next arrows, progress
 * dots, circular (wrap-around) navigation, keyboard arrows and swipe —
 * all with a smooth directional slide + fade. Closes on the ✕ button,
 * the Escape key, or a click on the backdrop.
 */

import { qs, cloneTpl, hydrateImage } from "./utils.js";

const PLACEHOLDER = "assets/placeholders/exhibit.svg";

let modal, stageEl, trackEl, nameEl, dotsEl, closeBtn, prevBtn, nextBtn;
let lastTrigger = null;

let images = [];      // current exhibit's image URLs
let slides = [];      // <img>-bearing slide elements, index-aligned
let current = 0;      // active slide index

function ensureRefs() {
  modal = qs("#exhibit-modal");
  if (!modal) return false;
  stageEl = qs(".modal__stage", modal);
  trackEl = qs(".modal__track", modal);
  nameEl = qs(".modal__name", modal);
  dotsEl = qs(".modal__dots", modal);
  closeBtn = qs(".modal__close", modal);
  prevBtn = qs(".modal__nav--prev", modal);
  nextBtn = qs(".modal__nav--next", modal);
  return true;
}

/**
 * Size the stage so the ACTIVE image is as large as possible within the
 * viewport while keeping its natural aspect ratio. Because every slide
 * fills the stage with object-fit: contain, sizing to the current image
 * makes it fill the frame perfectly, and the size animates as you move
 * between images of different shapes.
 */
function sizeStage() {
  if (!stageEl || !slides.length) return;
  const img = slides[current] && slides[current].querySelector("img");
  if (!img) return;

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return;

  const styles = getComputedStyle(modal);
  const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);

  // Available area sits above the reserved dots band (folded into padY).
  const availW = window.innerWidth - padX;
  const availH = window.innerHeight - padY;

  // Start from a no-crop fit (contain).
  const containScale = Math.min(availW / nw, availH / nh);
  let sw = nw * containScale;
  let sh = nh * containScale;

  // Portrait images that end up shorter than the area leave a big gap above
  // the bottom-fixed dots. Grow clearly-portrait images to fill more height,
  // cropping the sides only slightly (object-fit: cover), up to a capped
  // amount. Landscape, square and near-square images are left contained
  // (no crop), centred as usual.
  const MAX_CROP = 0.18; // at most ~18% trimmed from each side
  const isPortrait = nw / nh <= 0.78; // clearly taller than wide (2:3, 3:4…)
  if (isPortrait && sw >= availW - 1 && availH - sh > 2) {
    sh = Math.min(availH, sh / (1 - 2 * MAX_CROP));
    sw = availW;
  }

  stageEl.style.width = `${Math.round(sw)}px`;
  stageEl.style.height = `${Math.round(sh)}px`;
}

/** Build one slide element for a given URL (from the #tpl-modal-slide template). */
function makeSlide(url) {
  const slide = cloneTpl("tpl-modal-slide");
  const img = qs("img", slide);

  img.addEventListener("load", () => {
    // Re-fit the stage once the active image reports real dimensions.
    if (slides[current] === slide) sizeStage();
  });
  img.src = url || PLACEHOLDER;
  hydrateImage(img);

  return slide;
}

/** Render slides + dots for the current `images` set. */
function buildCarousel() {
  trackEl.replaceChildren();
  dotsEl.replaceChildren();
  slides = [];

  images.forEach((url, index) => {
    const slide = makeSlide(url);
    if (index === 0) slide.classList.add("is-active");
    trackEl.appendChild(slide);
    slides.push(slide);
  });

  const multiple = images.length > 1;
  modal.classList.toggle("has-carousel", multiple);

  if (multiple) {
    images.forEach((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "modal__dot" + (index === 0 ? " is-active" : "");
      dot.setAttribute("aria-label", `Go to image ${index + 1}`);
      dot.addEventListener("click", () => goTo(index));
      dotsEl.appendChild(dot);
    });
  }
}

/** Move to `index` (with wrap-around), sliding in the shortest direction. */
function goTo(index, dirHint) {
  const total = slides.length;
  if (total < 2) return;

  const next = ((index % total) + total) % total; // safe modulo → circular
  if (next === current) return;

  // Direction: +1 slides forward (new enters from right), -1 backward.
  let dir = dirHint;
  if (!dir) dir = next > current ? 1 : -1;

  const incoming = slides[next];
  const outgoing = slides[current];

  // Prime the incoming slide off-screen on the entering side, no transition.
  incoming.classList.add("is-entering");
  incoming.style.transition = "none";
  incoming.style.transform = `translateX(${dir * 100}%)`;
  incoming.style.opacity = "0";

  // Force reflow so the primed position is committed before we animate.
  void incoming.offsetWidth;

  incoming.style.transition = "";
  incoming.classList.add("is-active");
  incoming.classList.remove("is-entering");
  incoming.style.transform = "translateX(0)";
  incoming.style.opacity = "1";

  outgoing.classList.remove("is-active");
  outgoing.style.transform = `translateX(${dir * -100}%)`;
  outgoing.style.opacity = "0";

  // Tidy inline styles once the transition settles.
  const cleanup = () => {
    outgoing.style.transform = "";
    outgoing.style.opacity = "";
    outgoing.removeEventListener("transitionend", cleanup);
  };
  outgoing.addEventListener("transitionend", cleanup);

  current = next;

  [...dotsEl.children].forEach((dot, i) =>
    dot.classList.toggle("is-active", i === current)
  );

  sizeStage();
}

function next() { goTo(current + 1, 1); }
function prev() { goTo(current - 1, -1); }

/** Open the modal for one exhibit. `image` may be a URL or an array. */
export function openModal({ name, image, images: imageList }, trigger = null) {
  if (!modal && !ensureRefs()) return;

  lastTrigger = trigger;

  // Accept either an images array or a single image string.
  images = Array.isArray(imageList) && imageList.length
    ? imageList.slice()
    : [image || PLACEHOLDER];

  current = 0;
  nameEl.textContent = name;

  // Size the stage without animating on open (avoids a grow-from-zero
  // flash); the smooth size transition is restored for navigation.
  stageEl.style.transition = "none";
  stageEl.style.width = "";
  stageEl.style.height = "";

  buildCarousel();

  // Size to the first image (immediately if it is already cached).
  const firstImg = slides[0] && slides[0].querySelector("img");
  if (firstImg && firstImg.complete && firstImg.naturalWidth > 0) sizeStage();

  requestAnimationFrame(() => {
    stageEl.style.transition = "";
  });

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  closeBtn.focus();
}

export function closeModal() {
  if (!modal) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  if (lastTrigger) {
    lastTrigger.focus();
    lastTrigger = null;
  }
}

/** Wire up close + navigation interactions. Call once per page. */
export function initModal() {
  if (!ensureRefs()) return;

  closeBtn.addEventListener("click", closeModal);
  qs(".modal__backdrop", modal).addEventListener("click", closeModal);

  if (prevBtn) prevBtn.addEventListener("click", prev);
  if (nextBtn) nextBtn.addEventListener("click", next);

  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("is-open")) return;

    if (event.key === "Escape") {
      closeModal();
      return;
    }

    if (images.length > 1) {
      if (event.key === "ArrowRight") { event.preventDefault(); next(); return; }
      if (event.key === "ArrowLeft")  { event.preventDefault(); prev(); return; }
    }

    // Minimal focus trap — keep Tab cycling across the visible controls.
    if (event.key === "Tab") {
      event.preventDefault();
      closeBtn.focus();
    }
  });

  // Swipe support on touch devices.
  let touchX = null;
  stageEl.addEventListener("touchstart", (e) => {
    touchX = e.changedTouches[0].clientX;
  }, { passive: true });

  stageEl.addEventListener("touchend", (e) => {
    if (touchX === null || images.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
    touchX = null;
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (modal.classList.contains("is-open")) sizeStage();
  });
}
