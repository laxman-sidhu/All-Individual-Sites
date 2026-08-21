import { esc } from "../core/util.js";
import { writesEnabled } from "../data/auth.js";
import { faces } from "./faces.js";

const GLYPHS = {
  bookmark: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
  check: '<path d="M4 12.5l5.2 5L20 6.5"/>',
  editions: '<path d="M12 3.4l8 4.1-8 4.1-8-4.1z"/><path d="M4 12l8 4.1 8-4.1"/><path d="M4 16.4l8 4.1 8-4.1"/>',
  spinner: ""
};

function button(action, glyph, label, on) {
  return `<button class="cardact${on ? " is-on" : ""}" type="button" data-act="${action}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${on ? "true" : "false"}">
    <svg viewBox="0 0 24 24" ${on ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${GLYPHS[glyph]}</svg>
  </button>`;
}

// A different printing of something on a shelf is not the same as having it,
// so it gets its own colour and its own sentence rather than being quietly
// counted as read.
export function versionNote(book) {
  if (book.read || book.queued) return "";
  if (book.version_read) {
    const who = (book.version_readers || []).join(" and ");
    // A title-and-author match is a guess until the ISBN is filed, and the
    // sentence says which of the two this is.
    if (book.version_via === "guess") {
      return who ? `Probably another edition — same title and author as one ${who} read` : "Probably another edition of a book on the shelf";
    }
    return who ? `Another edition is read by ${who}` : "Another edition of this is on the shelf";
  }
  if (book.version_queued) {
    const who = book.version_queued_for;
    if (book.version_queued_via === "guess") {
      return who ? `Probably another edition — same title and author as one on ${who}'s readlist` : "Probably another edition of a book on a readlist";
    }
    return who ? `Another edition is on ${who}'s readlist` : "Another edition of this is on a readlist";
  }
  return "";
}

// Which shelf the other edition sits on, and therefore which colour the card
// takes. A printing of something QUEUED is still a queued book, so it keeps the
// violet rather than borrowing the yellow that means "read another edition".
export function versionKind(book) {
  if (book.read || book.queued) return "";
  if (book.version_read) return "version";
  if (book.version_queued) return "queued";
  return "";
}

// The label and the button say the same thing to two different devices: the
// label on hover, the button on a tap. The stylesheet shows one or the other.
export function versionTag(note, kind = "version") {
  const queued = kind === "queued";
  const tone = queued ? " card__tag--version-queued" : "";
  return `<span class="card__tag card__tag--version${tone}" data-tip="${esc(note)}">${queued ? "Readlist edition" : "Other edition"}</span>`
    + `<button class="card__info" type="button" data-tip="${esc(note)}" aria-label="${esc(note)}">i</button>`;
}

// The rating belongs on the same line as the controls, not trailing the author.
function ratingChip(book) {
  if (!book.rating) return "";
  const count = Number(book.ratingCount) || 0;
  const label = count ? `${count.toLocaleString()} ratings` : "rating";
  return `<span class="card__rating" title="${esc(label)}">★ ${esc(book.rating)}`
    + `${count ? `<span class="card__ratingn">(${count.toLocaleString()})</span>` : ""}</span>`;
}

// Filing a printing is only offered where it would mean something: not on a
// book we have, and not on one the sheet already names by its ISBN.
function filable(book) {
  return !book.read && !book.queued && book.version_via !== "isbn" && book.version_queued_via !== "isbn";
}

// Queueing something already read is a contradiction, so both are never offered.
export function cardBar(book, options = {}) {
  const rating = ratingChip(book);
  const who = book.queued && book.queued_for ? `<span class="cardbar__who">for ${esc(book.queued_for)}</span>` : "";
  const controls = options.noActions || !writesEnabled();

  // A bar with nothing in either half is not drawn at all.
  if (controls && !rating && !who) return "";

  const buttons = controls ? "" : [
    book.read ? "" : button("readlist", "bookmark", book.queued ? "Take off the readlist" : "Add to a readlist", book.queued),
    filable(book) ? button("version", "editions", "Mark as another edition of a book we have read", false) : "",
    button("read", "check", book.read ? "Remove from read books" : "Mark as read", book.read)
  ].join("");

  return `<div class="cardbar">
    <div class="cardbar__left">${rating}${who}</div>
    <div class="cardbar__right">${buttons}</div>
  </div>`;
}

// The badges rebuild with the bar, or a filled tick leaves the tag contradicting it.
export function repaint(cardEl, book) {
  if (!cardEl) return;
  const bar = cardEl.querySelector(".cardbar");
  if (bar) bar.outerHTML = cardBar(book);

  const kind = versionKind(book);
  cardEl.classList.toggle("is-read", Boolean(book.read));
  cardEl.classList.toggle("is-queued", Boolean(book.queued) || kind === "queued");
  cardEl.classList.toggle("is-version", kind === "version");

  const note = versionNote(book);
  const coverEl = cardEl.querySelector(".card__cover");
  if (coverEl) {
    coverEl.querySelectorAll(".card__tag, .card__info, .card__faces").forEach(node => node.remove());
    if (note) coverEl.insertAdjacentHTML("beforeend", versionTag(note, kind));
    if (book.queued) coverEl.insertAdjacentHTML("beforeend", '<span class="card__tag card__tag--queued">Readlist</span>');
    if (book.read) coverEl.insertAdjacentHTML("beforeend", '<span class="card__tag card__tag--read">Read</span>');
    // Redrawn, not just cleared: it was removed and never put back.
    if (book.readers?.length) coverEl.insertAdjacentHTML("beforeend", `<div class="card__faces">${faces(book.readers)}</div>`);
  }
}

// The pressed control reports its own state.
export function busy(buttonEl, on) {
  if (!buttonEl) return;
  buttonEl.classList.toggle("is-busy", Boolean(on));
  buttonEl.disabled = Boolean(on);
}
