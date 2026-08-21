import { esc, qs, setQuery, clean, plural, debounce, searchTerms } from "../core/util.js";
import { library } from "../data/library.js";
import { readlist } from "../data/readlist.js";
import { editionGroups, matchesEdition } from "../data/editions.js";
import { coverByIsbn } from "../books/api.js";
import { mountNav, wireReload } from "../ui/nav.js";
import { cardMarkup, wireCoverFallbacks, emptyState } from "../ui/cards.js";
import { wireCardOpen } from "../ui/detail.js";
import { wireTips } from "../ui/tip.js";
import { wireEdgeFades } from "../ui/scrollfade.js";

// Every printing the Other Versions column knows about, one card each. No API
// is called: the column IS the answer, already fetched and written down.

// Collapsed, a group shows ONE ROW - however many cards fit at this width, from
// two on a phone to a dozen zoomed out. Nothing here knows that number: the
// grid works it out from the width, so the row is MEASURED after painting and
// the surplus hidden. This is only a ceiling on how many are worth rendering to
// fill a row that nobody has measured yet.
const ROW_MAX = 30;

const state = { book: "", query: "" };
const expanded = new Set();
const shown = new Map();
const el = {};

function groups() {
  const all = editionGroups(library.list({ sort: "title" }));
  return state.book ? all.filter(group => group.entry.key === state.book) : all;
}

// One card shape, whether the printing is the one on our shelf or another.
function toCard(entry, edition) {
  const isbn = edition ? edition.isbn : entry.isbn;
  const book = {
    id: `ed:${entry.key}:${isbn || "none"}`,
    source: "sheet",
    title: entry.title,
    author: entry.author,
    authors: entry.author ? [entry.author] : [],
    isbn13: isbn,
    isbn,
    year: edition ? edition.year : entry.year,
    publisher: edition ? edition.publisher : "",
    language: edition ? edition.language : "",
    genre: entry.genre,
    // The chips are where one printing differs from its neighbours, so they
    // carry the publisher and the language rather than the shelf they share.
    genres: edition ? [edition.language, edition.publisher].filter(Boolean) : [entry.genre].filter(Boolean),
    description: entry.summary,
    summary: entry.summary,
    // Ours has a cover on the sheet. Another printing has whatever Open Library
    // holds for its number, and the title behind it when that 404s.
    cover: edition ? coverByIsbn(isbn, "M") : (entry.cover || coverByIsbn(isbn, "M")),
    coverAlt: edition ? coverByIsbn(isbn, "L") : ""
  };
  library.annotate(book);
  readlist.annotate(book);
  return book;
}

function cards(group) {
  const terms = searchTerms(state.query);
  const wholeBook = terms.length > 0 && matchesTitle(group.entry, terms);
  const editions = group.editions.filter(edition => wholeBook || matchesEdition(edition, terms));
  if (!editions.length) return [];
  // Ours leads, so the green card is the one the rest are editions of.
  const ours = group.entry.isbn ? [toCard(group.entry, null)] : [];
  return [...ours, ...editions.map(edition => toCard(group.entry, edition))];
}

function matchesTitle(entry, terms) {
  const hay = `${entry.title} ${entry.author}`.toLowerCase();
  return terms.every(term => hay.includes(term));
}

function paintHead() {
  const all = editionGroups(library.list({ sort: "title" }));
  const editions = all.reduce((sum, group) => sum + group.editions.length, 0);
  const languages = new Set(all.flatMap(group => group.editions.map(edition => edition.language).filter(Boolean)));
  el.tiles.innerHTML = [
    ["Books with other printings", plural(all.length, "book", "books")],
    ["Printings on file", plural(editions, "edition", "editions")],
    ["Languages", plural(languages.size, "language", "languages")]
  ].map(([label, value]) => `<div class="tile"><p class="tile__label">${esc(label)}</p><p class="tile__value">${esc(value)}</p></div>`).join("");
}

function paintPicker() {
  const all = editionGroups(library.list({ sort: "title" }));
  if (state.book && !all.some(group => group.entry.key === state.book)) state.book = "";
  el.book.innerHTML = `<option value="">All books (${all.length})</option>`
    + all.map(group => `<option value="${esc(group.entry.key)}"${group.entry.key === state.book ? " selected" : ""}>`
      + `${esc(group.entry.title)} (${group.editions.length})</option>`).join("");
}

function groupMarkup(group) {
  const items = cards(group);
  if (!items.length) return "";
  items.forEach(book => shown.set(book.id, book));

  // Opened, the printings become a rail that scrolls sideways. A hundred cards
  // stacked would push every other book off the page, and the whole point of
  // this one is comparing them against each other.
  const open = expanded.has(group.entry.key);
  const drawn = open ? items : items.slice(0, ROW_MAX);
  // Drawn empty and filled in by settleRows(), because both the label and
  // whether it appears at all depend on a width nobody has measured yet.
  const toggle = `<button class="linkbtn ed__more" type="button" data-toggle="${esc(group.entry.key)}"`
    + ` data-total="${items.length}" hidden></button>`;
  const facts = [group.entry.author, plural(group.editions.length, "other printing", "other printings")].filter(Boolean).join(" · ");

  return `<section class="edgroup">
    <div class="edgroup__head">
      <div>
        <h2 class="edgroup__title">${esc(group.entry.title)}</h2>
        <p class="edgroup__facts">${esc(facts)}</p>
      </div>
      ${group.entry.isbn ? `<p class="edgroup__ours">Ours <span class="ed__isbn">${esc(group.entry.isbn)}</span></p>` : ""}
    </div>
    <div class="${open ? "rail" : "grid"}">${drawn.map(book => cardMarkup(book, { noActions: true })).join("")}</div>
    ${toggle}
  </section>`;
}

function paintList() {
  if (!library.loaded) { el.list.innerHTML = emptyState("Reading the sheet", "One moment."); return; }
  shown.clear();
  const found = groups().map(groupMarkup).filter(Boolean);
  el.count.textContent = plural(found.length, "book", "books");
  el.list.innerHTML = found.length
    ? found.join("")
    : emptyState(
      state.query ? "No printing matches that" : "Nothing on file yet",
      state.query
        ? "Try an ISBN, a publisher or a language."
        : "The Other Versions column is filled by OtherVersions.gs, and by marking a book read from the search page.");
  wireCoverFallbacks(el.list);
  el.list.querySelectorAll(".rail").forEach(wireEdgeFades);
  settleRows();
}

// How many tracks the grid actually made at this width. Asked of the grid
// rather than worked out from a card width, because the stylesheet owns that
// number and changes it at two breakpoints.
function columnsIn(grid) {
  const tracks = grid ? getComputedStyle(grid).gridTemplateColumns : "";
  if (tracks && tracks !== "none") return tracks.split(" ").filter(Boolean).length;
  // A browser that will not resolve the tracks still places the cards, and the
  // ones on the first row all share its offset.
  const cards = [...(grid?.children || [])];
  const first = cards[0]?.offsetTop ?? 0;
  return cards.filter(card => card.offsetTop <= first + 2).length || 1;
}

// One row of cards, and a label that counts what that leaves out. Both change
// with the window, so this runs on every paint and on every resize - zooming
// out to fit twelve is a resize, and "Show 30 more" would be a lie afterwards.
function settleRows() {
  el.list.querySelectorAll(".edgroup").forEach(section => {
    const toggle = section.querySelector("[data-toggle]");
    if (!toggle) return;
    const total = Number(toggle.dataset.total) || 0;
    const grid = section.querySelector(".grid");

    if (!grid) {
      toggle.hidden = false;
      toggle.textContent = "Show less";
      return;
    }

    const cards = [...grid.children];
    const columns = columnsIn(grid);
    cards.forEach((card, at) => { card.hidden = at >= columns; });

    const left = total - Math.min(columns, cards.length);
    toggle.hidden = left <= 0;
    toggle.textContent = `Show ${left} more`;
  });
}

function refresh() {
  paintHead();
  paintPicker();
  paintList();
}

export function start() {
  mountNav({ page: "editions" });
  wireTips();

  el.tiles = document.querySelector("[data-tiles]");
  el.book = document.querySelector("[data-book]");
  el.search = document.querySelector("[data-editions-search]");
  el.list = document.querySelector("[data-editions-list]");
  el.count = document.querySelector("[data-count]");

  state.book = qs("book") || "";
  if (state.book) expanded.add(state.book);
  el.list.innerHTML = emptyState("Reading the sheet", "One moment.");

  el.book.addEventListener("change", () => {
    state.book = el.book.value;
    // Asking for one book by name is asking to see all of it.
    if (state.book) expanded.add(state.book);
    setQuery({ book: state.book });
    paintList();
  });
  el.search.addEventListener("input", debounce(() => {
    state.query = clean(el.search.value);
    paintList();
  }, 180));
  el.list.addEventListener("click", event => {
    const button = event.target.closest("[data-toggle]");
    if (!button) return;
    const key = button.dataset.toggle;
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
    paintList();
  });

  wireCardOpen(el.list, card => shown.get(card?.dataset.bookKey));
  // Resizing changes how many fit, and therefore whether there is anything left
  // to show. Measuring again is cheaper than repainting.
  window.addEventListener("resize", debounce(settleRows, 150));

  if (library.hydrate()) { readlist.hydrate(); refresh(); }

  wireReload(async () => {
    await Promise.all([library.load({ useSnapshot: false }), readlist.load({ useSnapshot: false })]);
    refresh();
    return `${plural(editionGroups(library.list()).length, "book", "books")} with other printings`;
  });

  Promise.all([library.load(), readlist.load()])
    .then(refresh)
    .catch(error => {
      if (!library.loaded) el.list.innerHTML = emptyState("Could not read the sheet", error?.message || "Check the bridge URL in js/config.js.");
    });
}

document.addEventListener("DOMContentLoaded", start);
