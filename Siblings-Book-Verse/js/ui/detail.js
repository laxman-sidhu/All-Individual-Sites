import { esc, cleanLines } from "../core/util.js";
import { authorText } from "../data/identity.js";
import { library } from "../data/library.js";
import { readlist } from "../data/readlist.js";
import { details, moreByAuthor, similarBooks, otherEditions, editionIsbns, ebookLinks } from "../books/discover.js";
import { cover, faces, cardMarkup, wireCoverFallbacks, skeletonGrid } from "./cards.js";
import { cardBar } from "./cardactions.js";
import { wireCardActions } from "./actions.js";
import { wireEdgeFades } from "./scrollfade.js";

// In-card controls that must not also open the modal. Add new ones here.
export const IN_CARD = ".cardact, .cardbar, .card__info";

let host = null;
let current = null;
const strip = new Map();

function shell() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "detail";
  host.innerHTML = '<div class="detail__wash" data-close></div><div class="detail__panel" role="dialog" aria-modal="true"><div class="detail__scroll"></div></div>';
  document.body.appendChild(host);
  host.addEventListener("click", event => { if (event.target.closest("[data-close]")) closeDetail(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && host.classList.contains("is-open")) closeDetail(); });
  return host;
}

export function closeDetail() {
  if (!host) return;
  host.classList.remove("is-open");
  document.body.classList.remove("is-locked");
  current = null;
  setTimeout(() => { if (!host.classList.contains("is-open")) host.querySelector(".detail__scroll").innerHTML = ""; }, 220);
}

// An em dash holds the row where a vanishing cell would reshape every book.
function cell(label, value) {
  return `<div class="stat"><p class="stat__label">${esc(label)}</p><p class="stat__value">${value ? esc(value) : "—"}</p></div>`;
}

function links(book) {
  const out = [];
  // A scanned copy, where one exists. Neither API hosts a file, so this points
  // at the Internet Archive: readable and downloadable when the scan is public,
  // borrow-only otherwise, and absent when there is no scan at all.
  const ebook = ebookLinks(book);
  if (ebook) {
    out.push(`<a class="btn btn--read" href="${esc(ebook.read)}" target="_blank" rel="noopener">${esc(ebook.label)}</a>`);
    if (ebook.pdf) out.push(`<a class="btn" href="${esc(ebook.pdf)}" target="_blank" rel="noopener">PDF</a>`);
  }
  if (book.previewLink) out.push(`<a class="btn btn--solid" href="${esc(book.previewLink)}" target="_blank" rel="noopener">Preview</a>`);
  if (book.infoLink) out.push(`<a class="btn" href="${esc(book.infoLink)}" target="_blank" rel="noopener">${book.source === "openlibrary" ? "Open Library" : "Google Books"}</a>`);
  const search = book.isbn13 || book.isbn10
    ? `https://openlibrary.org/isbn/${encodeURIComponent(book.isbn13 || book.isbn10)}`
    : `https://openlibrary.org/search?q=${encodeURIComponent(book.title)}`;
  if (book.source !== "openlibrary") out.push(`<a class="btn" href="${esc(search)}" target="_blank" rel="noopener">Open Library</a>`);
  return out.join("");
}

function body(book) {
  const author = authorText(book) || "Unknown author";
  const factBits = [author];
  if (book.year) factBits.push(String(book.year));
  if (book.pages) factBits.push(`${book.pages} pages`);
  if (book.rating) factBits.push(`★ ${book.rating}${book.ratingCount ? ` (${book.ratingCount.toLocaleString()})` : ""}`);

  const readRow = book.readers?.length
    ? `<div class="detail__read">${faces(book.readers, { size: "big" })}<span>Read by ${esc(book.readers.join(", "))}</span></div>`
    : "";

  const subjects = (book.genres || []).slice(0, 10);
  const subjectRow = subjects.length
    ? `<div class="detail__section"><p class="detail__label">Subjects</p><div class="chipset chipset--static">${subjects.map(s => `<span class="chip">${esc(s)}</span>`).join("")}</div></div>`
    : "";

  const blurbBlock = about(book);

  return `
    <button class="detail__x" type="button" data-close aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>

    <div class="detail__head">
      <div class="detail__cover">${cover(book, { size: "large" })}</div>
      <div class="detail__intro">
        <h2 class="detail__title">${esc(book.title)}</h2>
        ${book.subtitle ? `<p class="detail__subtitle">${esc(book.subtitle)}</p>` : ""}
        <p class="detail__facts">${esc(factBits.join(" · "))}</p>
        ${readRow}
        <div class="detail__bar" data-detail-bar>${cardBar(book)}</div>
    ${book.queued && book.queued_for ? `<p class="detail__source">On ${esc(book.queued_for)}'s readlist.</p>` : ""}
        <div class="detail__links">${links(book)}</div>
      </div>
    </div>

    <div class="detail__section">
      <p class="detail__label">The details</p>
      <div class="detail__grid">
        ${cell("First published", book.year)}
        ${cell("Pages", book.pages)}
        ${cell("Publisher", book.publisher)}
        ${cell("Language", book.language)}
        ${cell("Edition", book.edition)}
        ${cell("ISBN", book.isbn13 || book.isbn10)}
        ${cell("Rating", book.rating ? `${book.rating} / 5` : "")}
        ${cell("Our shelf", book.sheet_genre || book.genre)}
      </div>
    </div>

    <div class="detail__section" data-editions hidden>
      <div data-editions-body></div>
    </div>

    ${blurbBlock}
    ${subjectRow}

    <div class="detail__section" data-strip="author" hidden>
      <p class="detail__label">More by ${esc((book.authors || [])[0] || "this author")}</p>
      <div class="rail" data-rail="author"></div>
    </div>
    <div class="detail__section" data-strip="similar" hidden>
      <p class="detail__label">Readers also shelve</p>
      <div class="rail" data-rail="similar"></div>
    </div>`;
}

// Real paragraphs: these summaries are written in short lines on purpose.
function paragraphs(text) {
  return String(text || "")
    .split(/\n{2,}|\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p>${esc(line)}</p>`)
    .join("");
}

// Ours first. A publisher's blurb is a fallback, not a replacement.
function about(book) {
  const ours = cleanLines(book.sheetSummary);
  const theirs = cleanLines(book.description);
  const text = ours || theirs;
  if (!text) return "";

  const label = ours ? "What we said about it" : "About this book";
  const source = ours
    ? ""
    : `<p class="detail__source">From ${book.source === "openlibrary" ? "Open Library" : "Google Books"}.</p>`;

  return `<div class="detail__section">
    <p class="detail__label">${label}</p>
    <div class="detail__prose${ours ? " detail__prose--blurb" : ""}">${paragraphs(text)}</div>
    ${source}
  </div>`;
}

function annotate(book) {
  library.annotate(book);
  readlist.annotate(book);
  const entry = library.find(book);
  if (entry?.summary) book.sheetSummary = entry.summary;
  if (entry?.cover && !book.cover) book.cover = entry.cover;
  return book;
}

export async function openDetail(seed) {
  const node = shell();
  const scroll = node.querySelector(".detail__scroll");
  current = { ...seed };
  annotate(current);

  scroll.innerHTML = body(current);
  wireCoverFallbacks(scroll);
  node.classList.add("is-open");
  document.body.classList.add("is-locked");
  scroll.scrollTop = 0;

  wireCardActions(scroll, () => current, () => {
    scroll.querySelector("[data-detail-bar]").innerHTML = cardBar(current);
  });

  scroll.addEventListener("click", event => {
    const card = event.target.closest(".rail .card");
    if (!card || event.target.closest(IN_CARD)) return;
    const book = strip.get(card.dataset.bookKey);
    if (book) openDetail(book);
  });

  // After the panel is on screen: a modal filled in late beats a blank one.
  const full = await details(current).catch(() => current);
  if (!node.classList.contains("is-open")) return;
  current = annotate({ ...current, ...full });
  scroll.innerHTML = body(current);
  wireCoverFallbacks(scroll);

  loadEditions(scroll);
  loadRail(scroll, "author", () => moreByAuthor(current));
  loadRail(scroll, "similar", () => similarBooks(current));
}

// --- other editions ---------------------------------------------------------

// Not a catalogue: the only question worth answering is whether a different
// printing is already on one of our shelves.
async function loadEditions(scroll) {
  const section = scroll.querySelector("[data-editions]");
  const slot = scroll.querySelector("[data-editions-body]");
  if (!section || !slot) return;

  let editions = [];
  try { editions = await otherEditions(current); } catch { editions = []; }
  if (!scroll.isConnected || !editions.length) return;

  // Every printing is known now, so the flags settle instead of being guessed.
  const isbns = editionIsbns(editions);
  current.editionIsbns = [...new Set([...(current.editionIsbns || []), ...isbns])];
  annotate(current);

  const read = library.findByIsbns(isbns);
  const queued = readlist.findByIsbns(isbns);
  const shelved = library.find(current) || read;
  const html = elsewhereNote(read, queued, current) + onFileNote(shelved);
  if (!html) return;

  slot.innerHTML = html;
  section.hidden = false;
}

// A note only earns its place when the match is a DIFFERENT printing: saying
// "Siddhesh read this" about the edition already open says nothing.
function elsewhereNote(read, queued, book) {
  const here = new Set([book.isbn13, book.isbn10].filter(Boolean));
  const notes = [];

  if (read && !here.has(read.isbn)) {
    notes.push(`<p class="editions__note editions__note--read">Another edition of this is on ${esc(read.readers.join(" and "))}'s shelf`
      + `${read.isbn ? ` <span class="editions__isbn">${esc(read.isbn)}</span>` : ""}.</p>`);
  }
  if (queued && !here.has(queued.isbn) && (!read || read.isbn !== queued.isbn)) {
    notes.push(`<p class="editions__note editions__note--queued">Another edition is on ${esc(queued.reader || "a")}'s readlist`
      + `${queued.isbn ? ` <span class="editions__isbn">${esc(queued.isbn)}</span>` : ""}.</p>`);
  }
  return notes.join("");
}

// The printings already written down for it, which is the editions page's job
// to list rather than this modal's.
function onFileNote(entry) {
  const count = entry?.versions?.length || 0;
  if (!count) return "";
  return `<p class="editions__note"><a href="editions.html?book=${encodeURIComponent(entry.key)}">`
    + `${count} other printing${count === 1 ? "" : "s"} of this are on file</a>.</p>`;
}

async function loadRail(scroll, name, producer) {
  const section = scroll.querySelector(`[data-strip="${name}"]`);
  const rail = scroll.querySelector(`[data-rail="${name}"]`);
  if (!section || !rail) return;
  rail.innerHTML = skeletonGrid(4);
  section.hidden = false;

  let books = [];
  try { books = await producer(); } catch { books = []; }
  if (!books.length) { section.hidden = true; return; }

  books.forEach(book => { annotate(book); strip.set(book.id || book.title, book); });
  rail.innerHTML = books.map(book => cardMarkup(book, { noActions: true })).join("");
  wireCoverFallbacks(rail);
  wireEdgeFades(rail);
}

// Bound once per grid: stopPropagation is not enough when the card handler
// sits on the same container.
export function wireCardOpen(host, lookup) {
  if (!host) return;
  const open = target => {
    const card = target.closest(".card");
    if (!card || target.closest(IN_CARD)) return;
    const book = lookup(card);
    if (book) openDetail(book);
  };
  host.addEventListener("click", event => open(event.target));
  host.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!event.target.classList?.contains("card")) return;
    event.preventDefault();
    open(event.target);
  });
}
