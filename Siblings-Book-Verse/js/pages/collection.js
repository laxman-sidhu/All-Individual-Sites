import { READERS } from "../config.js";
import { esc, qs, setQuery, clean, plural, debounce } from "../core/util.js";
import { library } from "../data/library.js";
import { readlist } from "../data/readlist.js";
import { mountNav, wireReload } from "../ui/nav.js";
import { renderGrid, emptyState, skeletonGrid, faces } from "../ui/cards.js";
import { wireCardActions } from "../ui/actions.js";
import { wireCardOpen } from "../ui/detail.js";
import { wireTips } from "../ui/tip.js";

const config = window.PAGE_CONFIG || { source: "library", views: true };
const source = config.source === "readlist" ? readlist : library;
const isLibrary = config.source !== "readlist";

let state = { reader: "", genre: "", query: "", sort: "title" };
const shown = new Map();
const el = {};

const SORTS = isLibrary
  ? [["title", "Title"], ["author", "Author"], ["genre", "Shelf"], ["readers", "Most read"], ["recent", "Recently added"]]
  : [["title", "Title"], ["author", "Author"], ["genre", "Shelf"], ["recent", "Recently added"]];

// The heading names whoever is being shown.
function heading() {
  if (!isLibrary) {
    return state.reader
      ? { eyebrow: "Up next", title: `${state.reader}'s readlist`, lead: "Marking one read moves it across in a single step." }
      : { eyebrow: "Up next", title: "Readlist", lead: "Books we have promised ourselves. Marking one read moves it across in a single step." };
  }
  return state.reader
    ? { eyebrow: "Our shelves", title: `${state.reader} has read`, lead: "Everything on this shelf, newest habits and oldest favourites alike." }
    : { eyebrow: "Our shelves", title: "Every book we have read", lead: "One card per book. The faces on a cover are the ones who finished it." };
}

// The counts belong to what is on screen, not to the whole sheet.
function tiles() {
  if (!isLibrary) {
    const stats = readlist.stats();
    const mine = readlist.list({ reader: state.reader }).length;
    return [
      [state.reader ? `${state.reader} wants to read` : "Waiting", plural(state.reader ? mine : stats.books, "book", "books")],
      ["Shelves", plural(stats.genres, "shelf", "shelves")],
      ["Read so far", plural(library.stats().books, "book", "books")]
    ];
  }
  const stats = library.stats();
  const inView = library.list({ reader: state.reader }).length;
  return [
    [state.reader ? `${state.reader} has read` : "Books read", plural(inView, "book", "books")],
    ["Read by more than one", plural(stats.shared, "book", "books")],
    ["Authors", plural(stats.authors, "author", "authors")]
  ];
}

function paintHead() {
  const head = heading();
  el.eyebrow.textContent = head.eyebrow;
  el.title.textContent = head.title;
  el.lead.textContent = head.lead;
  el.tiles.innerHTML = tiles().map(([label, value]) =>
    `<div class="tile"><p class="tile__label">${esc(label)}</p><p class="tile__value">${esc(value)}</p></div>`).join("");
}

function paintFilters() {
  if (el.reader) {
    const readers = (isLibrary ? library : readlist).readers();
    const known = new Set(readers.map(r => r.label));
    READERS.forEach(reader => { if (!known.has(reader.name)) readers.push({ label: reader.name, count: 0 }); });
    el.reader.innerHTML = `<option value="">Everyone</option>`
      + readers.map(reader => `<option value="${esc(reader.label)}"${reader.label === state.reader ? " selected" : ""}>${esc(reader.label)} (${reader.count})</option>`).join("");
  }

  // Genres narrow to the chosen reader, or the options only empty the grid.
  const genres = (isLibrary ? library : readlist).genres(state.reader);
  const available = new Set(genres.map(g => g.label));
  if (state.genre && !available.has(state.genre)) state.genre = "";
  el.genre.innerHTML = `<option value="">All shelves</option>`
    + genres.map(genre => `<option value="${esc(genre.label)}"${genre.label === state.genre ? " selected" : ""}>${esc(genre.label)} (${genre.count})</option>`).join("");

  el.sort.innerHTML = SORTS.map(([key, label]) => `<option value="${key}"${key === state.sort ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function paintGrid() {
  const items = source.list(state);
  shown.clear();
  items.forEach(entry => {
    const book = toCard(entry);
    shown.set(book.id || book.key, book);
  });

  if (!items.length) {
    el.grid.innerHTML = emptyState(
      state.query || state.genre || state.reader ? "Nothing matches that" : "Nothing here yet",
      state.query || state.genre || state.reader
        ? "Loosen a filter, or clear the search box."
        : isLibrary ? "Find a book from the search page and mark it read." : "Find a book from the search page and add it to the readlist."
    );
  } else {
    renderGrid(el.grid, [...shown.values()]);
  }
  el.count.textContent = plural(items.length, "book", "books");
}

// One card shape, whether the entry came from the sheet or an API.
function toCard(entry) {
  const book = {
    id: entry.book_id || `sheet:${entry.key}`,
    key: entry.key,
    source: "sheet",
    title: entry.title,
    authors: entry.author ? [entry.author] : [],
    author: entry.author,
    isbn13: entry.isbn,
    isbn: entry.isbn,
    year: entry.year,
    genre: entry.genre,
    genres: entry.genre ? [entry.genre] : [],
    cover: entry.cover,
    coverAlt: "",
    description: entry.summary,
    summary: entry.summary,
    book_id: entry.book_id
  };
  library.annotate(book);
  readlist.annotate(book);
  return book;
}

function refresh({ head = true, filters = true } = {}) {
  if (head) paintHead();
  if (filters) paintFilters();
  paintGrid();
}

export function start() {
  wireTips();
  el.eyebrow = document.querySelector("[data-eyebrow]");
  el.title = document.querySelector("[data-title]");
  el.lead = document.querySelector("[data-lead]");
  el.tiles = document.querySelector("[data-tiles]");
  el.reader = document.querySelector("[data-reader]");
  el.genre = document.querySelector("[data-genre]");
  el.sort = document.querySelector("[data-sort]");
  el.search = document.querySelector("[data-collection-search]");
  el.grid = document.querySelector("[data-grid]");
  el.count = document.querySelector("[data-count]");

  state.reader = qs("reader") || "";
  state.genre = qs("genre") || "";
  state.sort = qs("sort") || "title";

  mountNav({ page: isLibrary ? "library" : "readlist" });

  el.grid.innerHTML = skeletonGrid(8);

  const hydrated = source.hydrate();
  library.hydrate();
  readlist.hydrate();
  if (hydrated) refresh();

  el.reader?.addEventListener("change", () => {
    state.reader = el.reader.value;
    setQuery({ reader: state.reader });
    refresh();
  });
  el.genre.addEventListener("change", () => {
    state.genre = el.genre.value;
    setQuery({ genre: state.genre });
    refresh({ filters: false });
  });
  el.sort.addEventListener("change", () => {
    state.sort = el.sort.value;
    setQuery({ sort: state.sort === "title" ? "" : state.sort });
    paintGrid();
  });
  el.search.addEventListener("input", debounce(() => {
    state.query = clean(el.search.value);
    paintGrid();
  }, 180));

  const lookup = card => shown.get(card?.dataset.bookKey);
  wireCardOpen(el.grid, lookup);
  wireCardActions(el.grid, lookup, () => refresh());

  wireReload(async () => {
    await Promise.all([library.load({ useSnapshot: false }), readlist.load({ useSnapshot: false })]);
    refresh();
    return `${plural(source.stats().books, "book", "books")} here`;
  });

  Promise.all([library.load(), readlist.load()])
    .then(() => refresh())
    .catch(error => {
      if (!hydrated) el.grid.innerHTML = emptyState("Could not read the sheet", error?.message || "Check the bridge URL in js/config.js.");
    });
}

document.addEventListener("DOMContentLoaded", start);
