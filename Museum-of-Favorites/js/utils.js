/**
 * Museum of Favorites — Utilities
 * Small shared helpers used across modules.
 */

/** querySelector shorthand. */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** querySelectorAll shorthand, returned as a real array. */
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Debounce: delays `fn` until `wait` ms have passed without a new call.
 * Used for the search input so we don't filter on every keystroke.
 */
export function debounce(fn, wait = 200) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Clone a <template>'s single root element by id. Keeps markup in the
 * HTML files — JS just clones and fills these.
 */
export function cloneTpl(id) {
  const tpl = document.getElementById(id);
  return tpl.content.firstElementChild.cloneNode(true);
}

/**
 * Minimal CSV parser that understands quoted fields, escaped quotes
 * and CRLF line endings — enough for Google Sheets CSV exports.
 * Returns an array of rows, each row an array of cell strings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++; // swallow CRLF pair
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  // Trailing cell / row without a final newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** True when the visitor prefers reduced motion. */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Read a query-string parameter from the current URL. */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * Wire an <img> element so it fades in once loaded and falls back to
 * the museum placeholder if the URL is broken.
 */
export function hydrateImage(img, fallbackSrc = "assets/placeholders/exhibit.svg") {
  const markLoaded = () => img.classList.add("is-loaded");

  img.addEventListener("load", markLoaded, { once: true });
  img.addEventListener(
    "error",
    () => {
      if (img.src.endsWith(fallbackSrc)) return; // placeholder itself failed
      img.src = fallbackSrc;
    },
    { once: false }
  );

  // Cached images may already be complete before listeners attach.
  if (img.complete && img.naturalWidth > 0) markLoaded();
}
