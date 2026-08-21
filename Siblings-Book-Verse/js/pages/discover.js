import { READERS, SUBJECTS, PAGE_SIZE } from "../config.js";
import { esc, qs, setQuery, clean, plural, titleCase } from "../core/util.js";
import { library } from "../data/library.js";
import { readlist } from "../data/readlist.js";
import { mountNav, wireReload } from "../ui/nav.js";
import { renderGrid, cardMarkup, wireCoverFallbacks, emptyState, skeletonGrid } from "../ui/cards.js";
import { wireCardActions } from "../ui/actions.js";
import { wireCardOpen } from "../ui/detail.js";
import { repaint } from "../ui/cardactions.js";
import { wireEdgeFades } from "../ui/scrollfade.js";
import { wireTips } from "../ui/tip.js";
import { search, trending, browse, SCOPES, TRENDING_PERIODS, googleTrouble, explain } from "../books/discover.js";

const shown = new Map();
// Every book loaded, in order. The grid is a filtered view of it, so narrowing
// to Read never discards a page already paid for.
let results = [];
let mode = "trending";
let state = { scope: "auto", phrase: "", subject: "", sort: "", language: "", era: "", ebook: "", period: "weekly", page: 1 };
let status = "all";
let total = 0;

const el = {};

// What the sheet says about a result, as five buckets one tap apart.
const STATUSES = [
  { key: "all", label: "All", test: () => true },
  { key: "read", label: "Read", test: book => Boolean(book.read) },
  { key: "version", label: "Other edition", test: book => !book.read && !book.queued && Boolean(book.version_read) },
  // A printing of a queued book is drawn violet, so it is counted here rather
  // than under Other edition: every bucket holds one colour.
  { key: "readlist", label: "Readlist", test: book => Boolean(book.queued) || (!book.read && !book.version_read && Boolean(book.version_queued)) },
  { key: "new", label: "New to us", test: book => !book.read && !book.queued && !book.version_read && !book.version_queued }
];

function statusTest(key) {
  return (STATUSES.find(entry => entry.key === key) || STATUSES[0]).test;
}

// Refine shortlists what is already on screen. It asks nothing of either API -
// the search bar is for asking a new question - so every option here is one the
// cards themselves can answer.
const REFINE_SORTS = [
  { key: "", label: "As they came" },
  { key: "rating", label: "Highest rated", by: (a, b) => (b.rating || 0) - (a.rating || 0) },
  { key: "ratings", label: "Most rated", by: (a, b) => (b.ratingCount || 0) - (a.ratingCount || 0) },
  { key: "new", label: "Newest first", by: (a, b) => (b.year || 0) - (a.year || 0) },
  { key: "old", label: "Oldest first", by: (a, b) => (a.year || 9999) - (b.year || 9999) },
  { key: "title", label: "Title A-Z", by: (a, b) => a.title.localeCompare(b.title) },
  { key: "short", label: "Fewest pages", by: (a, b) => (a.pages || 99999) - (b.pages || 99999) }
];

const REFINE_ERAS = [
  { key: "", label: "Any year" },
  { key: "2020", label: "2020s" },
  { key: "2010", label: "2010s" },
  { key: "2000", label: "2000s" },
  { key: "1990", label: "1990s" },
  { key: "1900", label: "20th century" },
  { key: "0", label: "Before 1900" }
];

const REFINE_EBOOKS = [
  { key: "", label: "Anything" },
  { key: "public", label: "Free to read", test: book => book.ebookAccess === "public" },
  { key: "borrowable", label: "Borrowable", test: book => book.ebookAccess === "borrowable" }
];

function inEra(book, key) {
  if (!key) return true;
  if (!book.year) return false;
  if (key === "0") return book.year < 1900;
  const from = Number(key);
  return book.year >= from && book.year <= (from === 1900 ? 1999 : from + 9);
}

function refined(book) {
  if (state.language && book.language !== state.language) return false;
  if (!inEra(book, state.era)) return false;
  const ebook = REFINE_EBOOKS.find(entry => entry.key === state.ebook);
  if (ebook?.test && !ebook.test(book)) return false;
  return true;
}

// What Refine has left. The status buckets count within it, so the two read as
// one narrowing rather than two that disagree.
function pool() {
  const list = results.filter(refined);
  const sort = REFINE_SORTS.find(entry => entry.key === state.sort);
  return sort?.by ? list.slice().sort(sort.by) : list;
}

function visible() {
  return pool().filter(statusTest(status));
}

function annotate(book) {
  library.annotate(book);
  readlist.annotate(book);
  return book;
}

// Built from the results in hand, and counted, so nothing on offer here can
// empty the grid. A language nothing is written in is not shown at all.
function paintRefineOptions() {
  const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  const count = test => results.filter(test).length;

  el.sort.innerHTML = REFINE_SORTS.map(entry => option(entry.key, entry.label, state.sort)).join("");

  const languages = new Map();
  results.forEach(book => { if (book.language) languages.set(book.language, (languages.get(book.language) || 0) + 1); });
  if (state.language && !languages.has(state.language)) state.language = "";
  el.language.innerHTML = option("", "Any language", state.language)
    + [...languages.entries()].sort((a, b) => b[1] - a[1])
      .map(([name, n]) => option(name, `${name} (${n})`, state.language)).join("");

  el.era.innerHTML = REFINE_ERAS.map(entry =>
    option(entry.key, entry.key ? `${entry.label} (${count(book => inEra(book, entry.key))})` : entry.label, state.era)).join("");

  el.ebook.innerHTML = REFINE_EBOOKS.map(entry =>
    option(entry.key, entry.test ? `${entry.label} (${count(entry.test)})` : entry.label, state.ebook)).join("");

  paintFilterState();
}

function paint(books, headline, note = "") {
  shown.clear();
  results = [];
  books.forEach(book => { annotate(book); shown.set(book.id || book.title, book); results.push(book); });
  el.headline.textContent = headline || "";
  const full = books.length ? withFilterNote(note) : note;
  el.note.textContent = full;
  el.note.hidden = !full;
  paintRefineOptions();
  // A filter from the last question means nothing about this one.
  if (!visible().length) status = "all";
  render(full);
}

function render(note = el.note.textContent) {
  const items = visible();
  paintStatus();
  if (!results.length) {
    // The reason is already printed above the grid; saying it twice reads as
    // two separate failures.
    el.grid.innerHTML = emptyState("Nothing here", note ? "" : "Try another spelling, or a different kind of search.");
  } else if (!items.length) {
    el.grid.innerHTML = emptyState("None of these", "Nothing in this batch is filed that way. Try All.");
  } else {
    renderGrid(el.grid, items);
  }
  paintMore();
}

// Appending, not repainting: a page that redrew from the top would throw away
// the reader's place every time they asked for more.
function append(books) {
  const fresh = books.filter(book => !shown.has(book.id || book.title));
  fresh.forEach(book => { annotate(book); shown.set(book.id || book.title, book); results.push(book); });
  paintRefineOptions();
  // A sort cannot be honoured by adding to the end, so a refined view repaints.
  // An unrefined one appends, which is what keeps the reader's place.
  if (state.sort || state.language || state.era || state.ebook) { render(); return fresh.length; }
  const showing = fresh.filter(statusTest(status));
  if (showing.length) {
    el.grid.insertAdjacentHTML("beforeend", showing.map(book => cardMarkup(book)).join(""));
    wireCoverFallbacks(el.grid);
  }
  paintStatus();
  return fresh.length;
}

// Counted over everything loaded, not what is drawn, so choosing one does not
// move the others. An empty bucket goes inert rather than reflowing the row.
function paintStatus() {
  if (!el.status) return;
  const inPool = pool();
  const counts = STATUSES.map(entry => inPool.filter(entry.test).length);
  el.status.hidden = results.length === 0;
  if (!inPool.length && results.length) status = "all";
  el.status.innerHTML = STATUSES.map((entry, at) => {
    const empty = counts[at] === 0 && entry.key !== "all";
    return `<button class="statuspill${entry.key === status ? " is-on" : ""}" type="button" data-status-key="${esc(entry.key)}"${empty ? " disabled" : ""}>
      <span class="statuspill__dot" data-kind="${esc(entry.key)}" aria-hidden="true"></span>${esc(entry.label)}
      <span class="statuspill__n">${counts[at]}</span>
    </button>`;
  }).join("");
}

// Trending and the bestseller lists are fixed-length feeds with no second page.
function pageable() {
  return mode === "search" || mode === "browse";
}

function paintMore() {
  if (!el.more) return;
  const have = shown.size;
  const room = pageable() && have > 0 && (total > have || have >= PAGE_SIZE * state.page);
  el.more.hidden = !room;
  el.moreBtn.disabled = false;
  el.moreBtn.textContent = "Load more";
  el.moreNote.textContent = total ? `${have.toLocaleString()} of ${total.toLocaleString()}` : "";
}

async function loadMore() {
  if (!pageable()) return;
  el.moreBtn.disabled = true;
  el.moreBtn.textContent = "Loading...";
  state.page += 1;
  try {
    const result = mode === "browse"
      ? await browse(browseArgs())
      : await search({ scope: state.scope, phrase: state.phrase, page: state.page });
    total = result.total || total;
    const added = append(result.items || []);
    if (!added) { el.more.hidden = true; el.moreNote.textContent = "That is everything."; }
  } catch {
    state.page -= 1;
    el.moreNote.textContent = "That page did not answer. Try again.";
  }
  paintMore();
}

function loading(headline) {
  el.headline.textContent = headline;
  el.note.hidden = true;
  el.more.hidden = true;
  if (el.status) el.status.hidden = true;
  el.grid.innerHTML = skeletonGrid(PAGE_SIZE / 2);
}

// Said above the results, not in the panel: it is a fact about the answer on
// screen, and in the panel it was a caption nobody had a reason to read.
function withFilterNote(note) {
  const bits = filterLabels();
  if (!bits.length) return note;
  const shortlist = `Shortlisted from these results by ${bits.join(" · ").toLowerCase()}`;
  return note ? `${note} · ${shortlist}` : shortlist;
}

function filterLabels() {
  return [
    REFINE_SORTS.find(x => x.key === state.sort && x.key)?.label,
    state.language,
    REFINE_ERAS.find(x => x.key === state.era && x.key)?.label,
    REFINE_EBOOKS.find(x => x.key === state.ebook && x.key)?.label
  ].filter(Boolean);
}

function toggleRefine(open) {
  const next = open === undefined ? el.refine.hidden : open;
  el.refine.hidden = !next;
  el.refineToggle.setAttribute("aria-expanded", next ? "true" : "false");
}

// The reset only appears once there is something to reset, and the count on the
// closed button is the only way to know a filter is still on.
function paintFilterState() {
  const active = [state.sort, state.language, state.era, state.ebook].filter(Boolean).length;
  const on = active > 0;
  el.resetFilters.hidden = !on;
  el.refine.classList.toggle("is-on", on);
  el.refineToggle.classList.toggle("is-on", on);
  el.refineCount.hidden = !on;
  el.refineCount.textContent = String(active);
  // data-idle marks a select still on its default, which is what the stylesheet
  // uses to tint only the ones actually narrowing anything.
  [el.sort, el.language, el.era, el.ebook].forEach(node => {
    if (node.value) node.removeAttribute("data-idle"); else node.setAttribute("data-idle", "");
  });
}

function browseArgs() {
  return { subject: state.subject.replace(/_/g, " "), page: state.page };
}

// --- the three modes --------------------------------------------------------

const TRENDING_NOTE = {
  trending: period => `Open Library, ${period.toLowerCase()}`,
  readinglog: () => "Trending did not answer — showing the most-read books instead",
  subject: () => "Trending did not answer — showing books shelved under Fiction instead",
  google: () => "Open Library did not answer — showing new releases from Google Books",
  stale: () => "Nothing is reachable right now — this is the last feed that loaded",
  none: () => "Nothing answered right now"
};

// The real reason, not a friendly nothing: whatever went wrong upstream is what
// tells you which endpoint to look at.
function trendingNote(result, label) {
  const headline = (TRENDING_NOTE[result.source] || TRENDING_NOTE.none)(label);
  if (result.source === "trending" || !result.problems?.length) return headline;
  // Deduped: three endpoints failing the same way is one fact, not three.
  const why = [...new Set(result.problems.map(explain))];
  return `${headline} — ${why.join("; ")}`;
}

async function runTrending() {
  mode = "trending";
  el.periods.hidden = false;
  el.clear.hidden = true;
  loading("What people are reading");
  try {
    const result = await trending(state.period);
    const label = TRENDING_PERIODS.find(p => p.key === state.period)?.label || "";
    total = result.items.length;
    paint(result.items, "What people are reading", trendingNote(result, label));
  } catch (error) {
    paint([], "What people are reading", "The trending feed did not answer. Try reloading, or search for a title instead.");
  }
}

async function runSearch() {
  mode = "search";
  el.periods.hidden = true;
  el.clear.hidden = false;
  loading(`Looking for "${state.phrase}"`);
  try {
    const result = await search({ scope: state.scope, phrase: state.phrase, page: state.page });
    total = result.total || 0;
    // Name the index when it was not the usual one. A path that wrote its own
    // note keeps it: "fewer words" is bad advice about an ISBN.
    const note = result.note || (result.items.length
      ? (result.source === "openlibrary" ? "From Open Library" : (googleTrouble() ? explain(googleTrouble()) : ""))
      : "Nothing came back. Try the Anything scope, or fewer words.");
    paint(result.items, result.headline, note);
  } catch (error) {
    // The real message: a 403 about an unknown location means GOOGLE_BOOKS_COUNTRY is wrong.
    paint([], `Looking for "${state.phrase}"`, explain(error?.message) || "The search did not answer. Check your connection and try again.");
  }
}

// Also where a refinement with no subject and no phrase lands: a sort on its
// own is a question Open Library can answer.
function browseLabel() {
  const subject = SUBJECTS.find(entry => entry.slug === state.subject)?.label || state.subject.replace(/_/g, " ");
  return subject ? titleCase(subject) : "Browsing";
}

async function runBrowse() {
  mode = "browse";
  el.periods.hidden = true;
  el.clear.hidden = false;
  const label = browseLabel();
  loading(label);
  try {
    const result = await browse(browseArgs());
    total = result.total || 0;
    const note = result.items.length
      ? [result.headline, result.note].filter(Boolean).join(" · ")
      : "Nothing came back with those filters. Try loosening one, or pick a subject to narrow within.";
    paint(result.items, label, note);
  } catch (error) {
    // The real reason. "That shelf did not answer" hid a timeout, a refusal and
    // a bad parameter behind one sentence that suggested none of them.
    paint([], label, explain(error?.message) || "That shelf did not answer. Try another one.");
  }
}

function rerun() {
  if (mode === "search" && state.phrase) return runSearch();
  if (state.subject) return runBrowse();
  return runTrending();
}

// --- controls ---------------------------------------------------------------

function submitSearch() {
  const phrase = clean(el.input.value);
  if (!phrase) { state.phrase = ""; setQuery({ q: "", subject: "" }); return runTrending(); }
  state.phrase = phrase;
  state.subject = "";
  state.page = 1;
  setQuery({ q: phrase, scope: state.scope === "auto" ? "" : state.scope, subject: "" });
  runSearch();
}

function chooseSubject(slug) {
  state.subject = slug;
  state.phrase = "";
  state.page = 1;
  el.input.value = "";
  setQuery({ subject: slug, q: "" });
  el.chips.querySelectorAll("[data-subject]").forEach(chip => chip.classList.toggle("is-on", chip.dataset.subject === slug));
  runBrowse();
}

function clearAll() {
  state.phrase = ""; state.subject = ""; state.page = 1;
  state.sort = ""; state.language = ""; state.era = ""; state.ebook = "";
  status = "all";
  el.input.value = "";
  el.sort.value = ""; el.language.value = ""; el.era.value = ""; el.ebook.value = "";
  el.chips.querySelectorAll("[data-subject]").forEach(chip => chip.classList.remove("is-on"));
  paintFilterState();
  setQuery({ q: "", subject: "" });
  runTrending();
}

function mountReaders() {
  const host = document.querySelector("[data-readers]");
  if (!host) return;
  host.innerHTML = READERS.map(reader => `
    <a class="reader" href="library.html?reader=${encodeURIComponent(reader.name)}">
      <span class="reader__photo"><img src="${esc(reader.photo)}" alt="" loading="lazy"></span>
      <span class="reader__body">
        <span class="reader__name">${esc(reader.name)}</span>
        <span class="reader__blurb">${esc(reader.blurb)}</span>
        <span class="reader__foot">
          <span class="reader__count" data-reader-count="${esc(reader.name)}">—</span>
          <span class="reader__go">View library <span aria-hidden="true">&rarr;</span></span>
        </span>
      </span>
    </a>`).join("");
  paintReaderCounts();
}

function paintReaderCounts() {
  const counts = new Map(library.readers().map(entry => [entry.label, entry.count]));
  document.querySelectorAll("[data-reader-count]").forEach(node => {
    const count = counts.get(node.dataset.readerCount) || 0;
    node.textContent = count ? plural(count, "book", "books") : "no books yet";
  });
}

// --- boot -------------------------------------------------------------------

export function start() {
  mountNav({ page: "discover" });
  wireTips();

  el.input = document.querySelector("[data-search-input]");
  el.scope = document.querySelector("[data-scope]");
  el.form = document.querySelector("[data-search-form]");
  el.grid = document.querySelector("[data-grid]");
  el.headline = document.querySelector("[data-headline]");
  el.note = document.querySelector("[data-note]");
  el.chips = document.querySelector("[data-subjects]");
  el.periods = document.querySelector("[data-periods]");
  el.clear = document.querySelector("[data-clear]");
  el.resetFilters = document.querySelector("[data-reset-filters]");
  el.refine = document.querySelector("[data-refine]");
  el.refineToggle = document.querySelector("[data-refine-toggle]");
  el.refineCount = document.querySelector("[data-refine-count]");
  el.sort = document.querySelector("[data-sort]");
  el.language = document.querySelector("[data-language]");
  el.era = document.querySelector("[data-era]");
  el.ebook = document.querySelector("[data-ebook]");
  el.status = document.querySelector("[data-status]");
  el.more = document.querySelector("[data-more]");
  el.moreBtn = document.querySelector("[data-more-btn]");
  el.moreNote = document.querySelector("[data-more-note]");

  // Refine acts on what is loaded, so a change repaints and asks nothing.
  [["sort", el.sort], ["language", el.language], ["era", el.era], ["ebook", el.ebook]].forEach(([field, node]) => {
    node.addEventListener("change", () => {
      state[field] = node.value;
      paintFilterState();
      render();
    });
  });

  el.resetFilters.addEventListener("click", () => {
    state.sort = ""; state.language = ""; state.era = ""; state.ebook = "";
    el.sort.value = ""; el.language.value = ""; el.era.value = ""; el.ebook.value = "";
    paintFilterState();
    render();
  });

  el.status.addEventListener("click", event => {
    const pill = event.target.closest("[data-status-key]");
    if (!pill) return;
    status = pill.dataset.statusKey;
    render();
  });
  el.moreBtn.addEventListener("click", loadMore);

  el.refineToggle.addEventListener("click", () => toggleRefine());

  // A dropdown that only closes by pressing the same button again is a panel
  // people leave open by accident.
  document.addEventListener("click", event => {
    if (el.refine.hidden) return;
    if (event.target.closest(".refinewrap")) return;
    toggleRefine(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || el.refine.hidden) return;
    toggleRefine(false);
    el.refineToggle.focus();
  });
  paintFilterState();

  paintRefineOptions();
  el.scope.innerHTML = SCOPES.map(scope => `<option value="${esc(scope.key)}">${esc(scope.label)}</option>`).join("");
  el.chips.innerHTML = SUBJECTS.map(subject => `<button class="chipbtn" type="button" data-subject="${esc(subject.slug)}">${esc(subject.label)}</button>`).join("");
  el.periods.innerHTML = TRENDING_PERIODS.map(period =>
    `<button class="pill${period.key === state.period ? " is-on" : ""}" type="button" data-period="${esc(period.key)}">${esc(period.label)}</button>`).join("");

  // After the chips exist, or there is nothing to measure.
  wireEdgeFades(el.chips);

  // Read synchronously, so the flags are on the first paint rather than correcting it.
  library.hydrate();
  readlist.hydrate();
  mountReaders();

  el.form.addEventListener("submit", event => { event.preventDefault(); submitSearch(); });
  el.scope.addEventListener("change", () => {
    state.scope = el.scope.value;
    if (state.phrase) submitSearch();
  });
  el.chips.addEventListener("click", event => {
    const chip = event.target.closest("[data-subject]");
    if (chip) chooseSubject(chip.dataset.subject);
  });
  el.periods.addEventListener("click", event => {
    const pill = event.target.closest("[data-period]");
    if (!pill) return;
    state.period = pill.dataset.period;
    el.periods.querySelectorAll(".pill").forEach(p => p.classList.toggle("is-on", p === pill));
    runTrending();
  });
  el.clear.addEventListener("click", clearAll);

  const lookup = card => shown.get(card?.dataset.bookKey);
  wireCardOpen(el.grid, lookup);
  // Filing an edition changes what OTHER cards in the grid mean, so every
  // write settles the whole grid rather than only the card that was pressed.
  wireCardActions(el.grid, lookup, () => refreshFlags());

  wireReload(async () => {
    await Promise.all([library.load({ useSnapshot: false }), readlist.load({ useSnapshot: false })]);
    paintReaderCounts();
    refreshFlags();
    return `${plural(library.stats().books, "book", "books")} read, ${plural(readlist.stats().books, "book", "books")} queued`;
  });

  // Restore whatever the URL asked for.
  state.scope = qs("scope") || "auto";
  el.scope.value = state.scope;
  const phrase = qs("q");
  const subject = qs("subject");
  if (phrase) { el.input.value = phrase; state.phrase = phrase; runSearch(); }
  else if (subject) { chooseSubject(subject); }
  else runTrending();

  // The live read replaces the snapshot; only disagreeing cards repaint.
  Promise.all([library.load(), readlist.load()])
    .then(() => { paintReaderCounts(); refreshFlags(); })
    .catch(() => { /* read-only or offline; the snapshot still stands */ });
}

// Only the cards the live sheet disagrees about are redrawn.
function refreshFlags() {
  let moved = false;
  results.forEach(book => {
    const state = () => `${book.read}|${book.queued}|${book.version_read}|${book.version_queued}|${book.version_via}`;
    const before = state();
    annotate(book);
    if (state() === before) return;
    moved = true;
    const card = el.grid.querySelector(`.card[data-book-key="${CSS.escape(book.id || book.title)}"]`);
    if (card) repaint(card, book);
  });
  // A card that changed bucket has to leave the view it no longer belongs to.
  if (moved && status !== "all") render(); else if (moved) paintStatus();
}

document.addEventListener("DOMContentLoaded", start);
