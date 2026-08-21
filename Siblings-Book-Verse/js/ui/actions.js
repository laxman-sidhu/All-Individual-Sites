import { READERS } from "../config.js";
import { esc, clean, cleanLines, titleCase, initials } from "../core/util.js";
import { isOwner, signIn, writesEnabled } from "../data/auth.js";
import { library } from "../data/library.js";
import { readlist } from "../data/readlist.js";
import { markRead, unmarkRead, addToReadlist, removeFromReadlist, addVersion } from "../data/writer.js";
import { details, otherEditions, editionLines } from "../books/discover.js";
import { editionLine } from "../data/editions.js";
import { isbnOf } from "../data/identity.js";
import { toast, pending } from "./toast.js";
import { repaint, busy } from "./cardactions.js";

// --- the dialog shell -------------------------------------------------------

let openDialog = null;

export function closeDialog() {
  if (!openDialog) return;
  const node = openDialog;
  openDialog = null;
  node.classList.remove("is-open");
  setTimeout(() => node.remove(), 200);
  if (!document.querySelector(".dialog")) document.body.classList.remove("is-locked");
}

function dialog({ eyebrow = "", title, body, wide = false }) {
  closeDialog();
  const node = document.createElement("div");
  node.className = `dialog${wide ? " dialog--wide" : ""}`;
  node.innerHTML = `
    <div class="dialog__wash" data-close></div>
    <div class="dialog__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button class="dialog__x" type="button" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      ${eyebrow ? `<p class="dialog__eyebrow">${esc(eyebrow)}</p>` : ""}
      <h2 class="dialog__title">${esc(title)}</h2>
      <div class="dialog__body">${body}</div>
    </div>`;
  document.body.appendChild(node);
  document.body.classList.add("is-locked");
  openDialog = node;

  node.addEventListener("click", event => { if (event.target.closest("[data-close]")) closeDialog(); });
  requestAnimationFrame(() => node.classList.add("is-open"));
  // After the transition, or the field is not yet hittable.
  setTimeout(() => node.querySelector("[data-autofocus]")?.focus(), 220);
  return node;
}

document.addEventListener("keydown", event => { if (event.key === "Escape") closeDialog(); });

// --- the gate ---------------------------------------------------------------

// The sentence reads as an answer where a bare password prompt reads as a wall.
function askOwner() {
  return new Promise(resolve => {
    const node = dialog({
      eyebrow: "Hold on",
      title: "This is the Sawants' book diary",
      body: `<p class="dialog__lead">Only we can change what is on these shelves. Everything else is yours to browse.</p>
        <div class="dialog__row">
          <button class="btn btn--solid" type="button" data-yes>Yes, that's us</button>
          <button class="btn" type="button" data-close>No, go back</button>
        </div>`
    });

    node.addEventListener("click", event => {
      if (event.target.closest("[data-yes]")) showPassword(node, resolve);
    });
    node.addEventListener("dialog:closed", () => resolve(false));
    const observer = new MutationObserver(() => { if (!node.isConnected) { observer.disconnect(); resolve(false); } });
    observer.observe(document.body, { childList: true });
  });
}

function showPassword(node, resolve) {
  const body = node.querySelector(".dialog__body");
  body.innerHTML = `<p class="dialog__lead">Welcome back. The password, then.</p>
    <input class="field" type="password" data-autofocus data-pass placeholder="Password" autocomplete="current-password">
    <p class="dialog__error" data-error hidden>That is not it. Try again.</p>
    <div class="dialog__row">
      <button class="btn btn--solid" type="button" data-go>Sign in</button>
      <button class="btn" type="button" data-close>Cancel</button>
    </div>`;
  body.querySelector("[data-pass]").focus();

  const attempt = () => {
    const field = body.querySelector("[data-pass]");
    if (signIn(field.value)) { closeDialog(); resolve(true); }
    else { body.querySelector("[data-error]").hidden = false; field.select(); }
  };
  body.querySelector("[data-go]").addEventListener("click", attempt);
  body.querySelector("[data-pass]").addEventListener("keydown", event => { if (event.key === "Enter") attempt(); });
}

export async function withOwner(action) {
  if (!writesEnabled()) {
    toast("This copy is read-only. Add the bridge URL and a password in js/config.js.", "fail", 5200);
    return false;
  }
  if (isOwner()) return action();
  const ok = await askOwner();
  if (!ok) return false;
  return action();
}

// --- pickers ----------------------------------------------------------------

function readerChips(selected = []) {
  return READERS.map(reader => {
    const on = selected.includes(reader.name);
    return `<button class="picker" type="button" data-reader="${esc(reader.name)}" aria-pressed="${on}">
      <span class="picker__face"><span class="face__ini">${esc(initials(reader.name))}</span><img src="${esc(reader.photo)}" alt="" loading="lazy"></span>
      <span class="picker__name">${esc(reader.name)}</span>
    </button>`;
  }).join("");
}

// Rebuilt from the sheet, so a hand-typed shelf appears next time. Other is last.
function genreChips(current = "") {
  const known = library.genres().map(entry => entry.label);
  const extra = current && !known.includes(current) ? [current] : [];
  return [...extra, ...known].map(genre =>
    `<button class="chipbtn${genre === current ? " is-on" : ""}" type="button" data-genre="${esc(genre)}">${esc(genre)}</button>`
  ).join("") + '<button class="chipbtn chipbtn--other" type="button" data-genre-other>+ Other</button>';
}

// A trending result has a title, an author and a cover and nothing else, so
// marking one read wrote a blank Summary and ISBN. The lookup is cached, not the
// book: the same title arrives as a different object from the modal.
const enriching = new Map();
const editionCache = new Map();

// Every column the sheet has a header for.
const FILLABLE = ["description", "isbn13", "isbn10", "cover", "coverAlt", "year",
  "publisher", "pages", "language", "genres", "workKey"];

function fill(book, full) {
  for (const field of FILLABLE) {
    const value = full?.[field];
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
    const current = book[field];
    const blank = current == null || current === "" || (Array.isArray(current) && !current.length);
    if (blank) book[field] = value;
  }
  return book;
}

// The ISBN, publisher, language and year, and nothing that costs a second call.
async function enrichBasic(book) {
  const key = book.id || book.title;
  if (!enriching.has(key)) enriching.set(key, details({ ...book }).catch(() => null));
  return fill(book, await enriching.get(key));
}

async function enrich(book) {
  const key = book.id || book.title;
  await enrichBasic(book);

  // The sheet has an Other Versions column, so a row written from here fills it
  // rather than waiting for OtherVersions.gs to be run again by hand.
  if (!editionCache.has(key)) editionCache.set(key, otherEditions(book).catch(() => []));
  const editions = await editionCache.get(key);
  book.versions = editionLines(editions);
  book.version_count = book.versions ? book.versions.split("\n").length : 0;
  return book;
}

// Neither can be guessed: an API knows subjects, not which word we file it under.
function askReadDetails(book) {
  return new Promise(resolve => {
    const suggested = titleCase(clean(book.genres?.[0] || book.genre || ""));
    const state = { readers: [], genre: "", summary: cleanLines(book.description || book.summary || "") };

    const needsFilling = !state.summary;

    const node = dialog({
      eyebrow: "Mark as read",
      title: book.title,
      wide: true,
      body: `
        <p class="dialog__lead">Who finished it?</p>
        <div class="pickers" data-readers>${readerChips()}</div>

        <p class="dialog__lead dialog__lead--gap">Which shelf?</p>
        <div class="chipset" data-genres>${genreChips(suggested)}</div>
        <input class="field field--tight" type="text" data-genre-input placeholder="New shelf name" hidden>

        <details class="fold">
          <summary class="fold__head">Summary <span class="fold__hint">optional, saved to the sheet</span></summary>
          <textarea class="field field--area" data-summary rows="5" placeholder="${needsFilling ? "Looking one up…" : "Whatever you want to remember about it."}">${esc(state.summary)}</textarea>
        </details>

        <p class="dialog__error" data-error hidden>Pick at least one reader and a shelf.</p>
        <div class="dialog__row">
          <button class="btn btn--solid" type="button" data-save>Add to read books</button>
          <button class="btn" type="button" data-close>Cancel</button>
        </div>`
    });

    state.genre = suggested;

    // Always: the ISBN, cover and year are columns too, and starting now means
    // the lookup has landed by the time a shelf is picked.
    enrich(book).then(full => {
      if (!needsFilling) return;
      const field = node.querySelector("[data-summary]");
      if (!field || field.value.trim()) return;
      field.value = cleanLines(full.description || "");
      field.placeholder = "Whatever you want to remember about it.";
      if (!state.genre && full.genres?.length) {
        const shelf = titleCase(clean(full.genres[0]));
        node.querySelector("[data-genre-input]")?.setAttribute("placeholder", `New shelf name (${shelf}?)`);
      }
    });

    node.addEventListener("click", event => {
      const readerBtn = event.target.closest("[data-reader]");
      if (readerBtn) {
        const name = readerBtn.dataset.reader;
        const at = state.readers.indexOf(name);
        if (at === -1) state.readers.push(name); else state.readers.splice(at, 1);
        readerBtn.setAttribute("aria-pressed", at === -1 ? "true" : "false");
        return;
      }

      const genreBtn = event.target.closest("[data-genre]");
      if (genreBtn) {
        state.genre = genreBtn.dataset.genre;
        node.querySelectorAll("[data-genre]").forEach(el => el.classList.toggle("is-on", el === genreBtn));
        node.querySelector("[data-genre-input]").hidden = true;
        return;
      }

      if (event.target.closest("[data-genre-other]")) {
        const field = node.querySelector("[data-genre-input]");
        field.hidden = false;
        field.focus();
        node.querySelectorAll("[data-genre]").forEach(el => el.classList.remove("is-on"));
        state.genre = "";
        return;
      }

      if (event.target.closest("[data-save]")) {
        const typed = clean(node.querySelector("[data-genre-input]").value);
        const genre = titleCase(typed || state.genre);
        const summary = cleanLines(node.querySelector("[data-summary]").value);
        if (!state.readers.length || !genre) { node.querySelector("[data-error]").hidden = false; return; }
        closeDialog();
        resolve({ readers: state.readers.slice(), genre, summary });
      }
    });

    const observer = new MutationObserver(() => { if (!node.isConnected) { observer.disconnect(); resolve(null); } });
    observer.observe(document.body, { childList: true });
  });
}

function askQueueDetails(book) {
  return new Promise(resolve => {
    const suggested = titleCase(clean(book.genres?.[0] || book.genre || ""));
    const node = dialog({
      eyebrow: "Add to readlist",
      title: book.title,
      body: `
        <p class="dialog__lead">Whose readlist?</p>
        <div class="pickers" data-readers>${readerChips()}</div>

        <p class="dialog__lead dialog__lead--gap">Which shelf will it land on?</p>
        <div class="chipset" data-genres>${genreChips(suggested)}</div>
        <input class="field field--tight" type="text" data-genre-input placeholder="New shelf name" hidden>

        <p class="dialog__error" data-error hidden>Pick whose readlist it goes on, and a shelf.</p>
        <div class="dialog__row">
          <button class="btn btn--solid" type="button" data-save>Add to readlist</button>
          <button class="btn" type="button" data-close>Cancel</button>
        </div>`
    });

    let genre = suggested;
    let reader = "";

    // The readlist tab has the same seven columns, so the same lookup runs.
    enrich(book).catch(() => {});

    node.addEventListener("click", event => {
      const readerBtn = event.target.closest("[data-reader]");
      if (readerBtn) {
        const name = readerBtn.dataset.reader;
        reader = reader === name ? "" : name;
        node.querySelectorAll("[data-reader]").forEach(el => el.setAttribute("aria-pressed", el.dataset.reader === reader ? "true" : "false"));
        return;
      }
      const genreBtn = event.target.closest("[data-genre]");
      if (genreBtn) {
        genre = genreBtn.dataset.genre;
        node.querySelectorAll("[data-genre]").forEach(el => el.classList.toggle("is-on", el === genreBtn));
        node.querySelector("[data-genre-input]").hidden = true;
        return;
      }
      if (event.target.closest("[data-genre-other]")) {
        const field = node.querySelector("[data-genre-input]");
        field.hidden = false; field.focus();
        node.querySelectorAll("[data-genre]").forEach(el => el.classList.remove("is-on"));
        genre = "";
        return;
      }
      if (event.target.closest("[data-save]")) {
        const typed = clean(node.querySelector("[data-genre-input]").value);
        const shelf = titleCase(typed || genre);
        // "Readlist of Who ?" is a real column; blank leaves a row no queue claims.
        if (!reader || !shelf) { node.querySelector("[data-error]").hidden = false; return; }
        closeDialog();
        resolve({ genre: shelf, reader });
      }
    });

    const observer = new MutationObserver(() => { if (!node.isConnected) { observer.disconnect(); resolve(null); } });
    observer.observe(document.body, { childList: true });
  });
}

// A printing the sheet has never seen, filed against the book it belongs to.
// The line is built here and written verbatim, so the cell keeps one format.
function askOtherEdition(book) {
  return new Promise(resolve => {
    const entries = library.list({ sort: "title" });
    const guess = library.findVersion(book);
    const options = entries.map(entry =>
      `<option value="${esc(entry.key)}"${entry.key === guess?.key ? " selected" : ""}>${esc(entry.title)}${entry.author ? ` — ${esc(entry.author)}` : ""}</option>`).join("");

    const node = dialog({
      eyebrow: "Another edition",
      title: book.title,
      body: `
        <p class="dialog__lead">Which book on our shelf is this a printing of?</p>
        <span class="selectwrap"><select data-target aria-label="Book on our shelf">${options}</select></span>

        <p class="dialog__lead dialog__lead--gap">This line goes into its Other Versions cell.</p>
        <p class="edline" data-line>Looking this edition up…</p>

        <p class="dialog__error" data-error hidden>That edition has no ISBN, so there is nothing to file.</p>
        <div class="dialog__row">
          <button class="btn btn--solid" type="button" data-save disabled>File it</button>
          <button class="btn" type="button" data-close>Cancel</button>
        </div>`
    });

    let line = "";
    enrichBasic(book).then(full => {
      line = editionLine({ isbn: isbnOf(full), language: full.language, publisher: full.publisher, year: full.year });
      const slot = node.querySelector("[data-line]");
      if (!slot) return;
      slot.textContent = line || "This record carries no ISBN.";
      node.querySelector("[data-error]").hidden = Boolean(line);
      node.querySelector("[data-save]").disabled = !line;
    });

    node.addEventListener("click", event => {
      if (!event.target.closest("[data-save]") || !line) return;
      const key = node.querySelector("[data-target]").value;
      const target = entries.find(entry => entry.key === key);
      if (!target) return;
      closeDialog();
      resolve({ target, line, isbn: isbnOf(book) });
    });

    const observer = new MutationObserver(() => { if (!node.isConnected) { observer.disconnect(); resolve(null); } });
    observer.observe(document.body, { childList: true });
  });
}

function askWhichReader(book) {
  const readers = book.readers || [];
  if (readers.length <= 1) return Promise.resolve(readers[0] || "");
  return new Promise(resolve => {
    const node = dialog({
      eyebrow: "Remove from read books",
      title: book.title,
      body: `<p class="dialog__lead">More than one of you has read this. Whose row should go?</p>
        <div class="pickers">${readers.map(name => `<button class="picker" type="button" data-pick="${esc(name)}">
          <span class="picker__face"><span class="face__ini">${esc(initials(name))}</span><img src="${esc(READERS.find(r => r.name === name)?.photo || "")}" alt="" loading="lazy"></span>
          <span class="picker__name">${esc(name)}</span></button>`).join("")}</div>
        <div class="dialog__row">
          <button class="btn" type="button" data-all>Remove every row</button>
          <button class="btn" type="button" data-close>Cancel</button>
        </div>`
    });
    node.addEventListener("click", event => {
      const pick = event.target.closest("[data-pick]");
      if (pick) { closeDialog(); resolve(pick.dataset.pick); }
      if (event.target.closest("[data-all]")) { closeDialog(); resolve(""); }
    });
    const observer = new MutationObserver(() => { if (!node.isConnected) { observer.disconnect(); resolve(null); } });
    observer.observe(document.body, { childList: true });
  });
}

// --- the writes -------------------------------------------------------------

// Flags are snapshotted first, so a failed write restores exactly what was there.
async function optimistic({ cardEl, buttonEl, book, apply, undo, verb, done, run }) {
  const before = { read: book.read, queued: book.queued, readers: (book.readers || []).slice() };
  apply();
  repaint(cardEl, book);
  busy(buttonEl, true);
  const note = pending(`${verb}...`);

  try {
    await run();
    note.settle(`${done} — ${book.title}`, "ok");
    return true;
  } catch (error) {
    undo ? undo() : Object.assign(book, before);
    repaint(cardEl, book);
    note.fail(error?.message || "The sheet did not accept that.");
    return false;
  } finally {
    // repaint() replaced the element, so the old handle is detached.
    const fresh = cardEl?.querySelector(`[data-act="${buttonEl?.dataset.act}"]`);
    busy(fresh || buttonEl, false);
  }
}

export async function toggleReadlist(book, cardEl, buttonEl) {
  if (book.queued) {
    return optimistic({
      cardEl, buttonEl, book,
      apply: () => { book.queued = false; },
      verb: "Removing from readlist", done: "Removed from readlist",
      run: () => removeFromReadlist(book)
    });
  }
  const answer = await askQueueDetails(book);
  if (!answer) return false;
  book.genre = answer.genre;
  await enrich(book);
  return optimistic({
    cardEl, buttonEl, book,
    apply: () => { book.queued = true; },
    verb: "Adding to readlist", done: "Added to readlist",
    run: () => addToReadlist(book, { genre: answer.genre, reader: answer.reader, summary: book.description || book.summary || "" })
  });
}

export async function toggleRead(book, cardEl, buttonEl) {
  if (book.read) {
    const reader = await askWhichReader(book);
    if (reader === null) return false;
    const readersBefore = (book.readers || []).slice();
    const remaining = reader ? readersBefore.filter(name => name !== reader) : [];
    return optimistic({
      cardEl, buttonEl, book,
      apply: () => { book.readers = remaining; book.read = remaining.length > 0; },
      verb: "Removing from read books", done: "Removed from read books",
      run: () => unmarkRead(book, reader)
    });
  }

  const answer = await askReadDetails(book);
  if (!answer) return false;
  book.genre = answer.genre;
  await enrich(book);
  return optimistic({
    cardEl, buttonEl, book,
    apply: () => { book.read = true; book.readers = answer.readers.slice(); book.queued = false; },
    verb: "Adding to read books", done: "Added to read books",
    run: () => markRead(book, answer)
  });
}

// No optimistic repaint here: nothing on the card is true until the sheet has
// taken the line, and what changes afterwards is the colour of a neighbour.
export async function fileAsEdition(book, cardEl, buttonEl) {
  if (!library.list().length) {
    toast("Nothing has been marked read yet, so there is nothing to file this under.", "fail", 4200);
    return false;
  }
  const answer = await askOtherEdition(book);
  if (!answer) return false;

  busy(buttonEl, true);
  const note = pending("Filing as another edition...");
  try {
    await addVersion(answer.target, { isbn: answer.isbn, line: answer.line });
    library.annotate(book);
    readlist.annotate(book);
    repaint(cardEl, book);
    note.settle(`Filed as another edition of ${answer.target.title}`, "ok");
    return true;
  } catch (error) {
    note.fail(error?.message || "The sheet did not accept that.");
    return false;
  } finally {
    busy(cardEl?.querySelector('[data-act="version"]') || buttonEl, false);
  }
}

// One listener per grid, so a repaint never orphans a handler.
export function wireCardActions(host, lookup, afterWrite) {
  if (!host) return;
  host.addEventListener("click", async event => {
    const button = event.target.closest(".cardact");
    if (!button) return;
    event.stopPropagation();
    event.preventDefault();

    const cardEl = button.closest(".card");
    const book = lookup(cardEl);
    if (!book) return;

    const act = button.dataset.act;
    const run = {
      readlist: () => toggleReadlist(book, cardEl, button),
      read: () => toggleRead(book, cardEl, button),
      version: () => fileAsEdition(book, cardEl, button)
    }[act];
    if (!run) return;

    const changed = await withOwner(run);
    if (changed && afterWrite) afterWrite(book, act);
  });
}

export { askReadDetails, askQueueDetails, askOtherEdition };
