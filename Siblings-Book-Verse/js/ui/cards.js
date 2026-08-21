import { esc } from "../core/util.js";
import { authorText } from "../data/identity.js";
import { faces, readerPhoto } from "./faces.js";
import { cardBar, versionNote, versionTag, versionKind } from "./cardactions.js";

export { faces, readerPhoto };

// The fallback sits BEHIND the image and <img> is only emitted with a URL, so a
// dead link and an absent one both reveal the title.
export function cover(book, { size = "card" } = {}) {
  const url = size === "large" ? (book.coverAlt || book.cover) : (book.cover || book.coverAlt);
  const alt = book.coverAlt && book.coverAlt !== url ? book.coverAlt : (book.cover !== url ? book.cover : "");
  const fallback = `<span class="cover__fallback">${esc(book.title || "Untitled")}</span>`;
  if (!url) return fallback;
  const second = alt ? ` data-fallback-src="${esc(alt)}"` : "";
  return `${fallback}<img src="${esc(url)}" alt="" loading="lazy" decoding="async"${second}>`;
}

function genreChips(book, limit = 2) {
  const list = (book.genres && book.genres.length ? book.genres : [book.genre]).filter(Boolean);
  if (!list.length) return "";
  return `<div class="card__genres">${list.slice(0, limit).map(genre => `<span class="chip">${esc(genre)}</span>`).join("")}</div>`;
}

function facts(book) {
  const bits = [authorText(book) || book.author || "Unknown author"];
  if (book.year) bits.push(String(book.year));
  if (book.pages) bits.push(`${book.pages} pp`);
  return bits.join(" · ");
}

export function cardMarkup(book, options = {}) {
  const queued = book.queued ? '<span class="card__tag card__tag--queued">Readlist</span>' : "";
  const read = book.read && !options.hideReadTag ? '<span class="card__tag card__tag--read">Read</span>' : "";
  const facePile = book.readers?.length ? `<div class="card__faces">${faces(book.readers)}</div>` : "";

  // The tag carries the sentence on hover. The button carries the same one on a
  // tap, and is the only one of the two a phone shows.
  const note = versionNote(book);
  const kind = versionKind(book);
  const tag = note ? versionTag(note, kind) : "";
  const state = book.read ? " is-read" : book.queued || kind === "queued" ? " is-queued" : kind === "version" ? " is-version" : "";

  return `
    <article class="card${state}" data-book-key="${esc(book.id || book.key || book.title)}" tabindex="0" role="button" aria-label="${esc(book.title)}${note ? `. ${esc(note)}` : ""}">
      <div class="card__cover">
        ${cover(book)}
        ${queued}${read}${tag}${facePile}
      </div>
      <div class="card__body">
        <h3 class="card__title">${esc(book.title)}</h3>
        <p class="card__facts">${esc(facts(book))}</p>
        ${genreChips(book)}
        ${cardBar(book, options)}
      </div>
    </article>`;
}

export function renderGrid(host, books, options = {}) {
  if (!host) return;
  host.innerHTML = books.map(book => cardMarkup(book, options)).join("");
  wireCoverFallbacks(host);
}

// Bound, not inlined, so the URL never has to survive an HTML attribute twice.
export function wireCoverFallbacks(root) {
  root.querySelectorAll("img[data-fallback-src]").forEach(img => {
    img.addEventListener("error", function once() {
      const next = img.getAttribute("data-fallback-src");
      img.removeAttribute("data-fallback-src");
      img.removeEventListener("error", once);
      if (next) img.src = next; else img.remove();
    });
  });
}

// An empty <p> still takes its margin, so a blank note leaves a gap that looks
// like something failed to render.
export function emptyState(title, note) {
  const line = note ? `<p class="empty__note">${esc(note)}</p>` : "";
  return `<div class="empty"><p class="empty__title">${esc(title)}</p>${line}</div>`;
}

export function skeletonGrid(count = 12) {
  return Array.from({ length: count }, () => '<div class="skel"><div class="skel__cover"></div><div class="skel__line"></div><div class="skel__line skel__line--short"></div></div>').join("");
}
