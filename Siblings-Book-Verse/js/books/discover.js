import { PAGE_SIZE, SUBJECTS } from "../config.js";
import { getJSON } from "../core/http.js";
import { cached } from "../core/cache.js";
import { clean, unique, normaliseText, normaliseAuthor, titleCase, plural, store } from "../core/util.js";
import {
  googleVolumes, googleVolume, googleByIsbn, openLibrarySearch, openLibrarySubject,
  openLibraryTrending, openLibraryWork, openLibraryEditions, openLibraryByIsbn,
  openLibraryEditionByIsbn, pickEdition, applyEdition, editionSummary,
  languageName, descriptionOf, coverByIsbn
} from "./api.js";
import { normaliseIsbn, isbnForms, carriesIsbn } from "../data/identity.js";
import { editionLine } from "../data/editions.js";

export const SCOPES = [
  { key: "auto", label: "Anything" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "subject", label: "Subject" },
  { key: "isbn", label: "ISBN" }
];

const ISBN = /^(?:\d[\d-\s]{7,}[\dXx])$/;

export function looksLikeIsbn(phrase) {
  const digits = String(phrase || "").replace(/[-\s]/g, "");
  if (!ISBN.test(String(phrase).trim())) return false;
  // A 13-digit ISBN always begins 978 or 979; any other long number does not.
  if (/^\d{13}$/.test(digits)) return /^97[89]/.test(digits);
  return /^\d{9}[\dXx]$/.test(digits);
}

// --- searching --------------------------------------------------------------

let lastGoogleError = null;

// Google is the better index but the one that can refuse: a wrong country gets a
// 403, its quota gets a 429. Only the failure of BOTH sources is an error.
async function tryGoogle(query, options) {
  try {
    return await googleVolumes(query, options);
  } catch (error) {
    lastGoogleError = error;
    return { total: 0, items: [], failed: true };
  }
}

export function googleTrouble() {
  return lastGoogleError ? lastGoogleError.message : "";
}

// "Failed to fetch" and "signal is aborted without reason" are what a browser
// says; neither tells anyone what to do about it. These do.
export function explain(message) {
  const text = String(message || "");
  if (/quota|rateLimitExceeded|429/i.test(text) && /books\.googleapis|Queries/i.test(text)) {
    return "Google Books' shared daily quota is used up — add a free key as GOOGLE_BOOKS_KEY in js/config.js";
  }
  if (/429/.test(text)) return "too many requests just now";
  if (/unknown location|403/i.test(text)) return "Google Books refused the request — check GOOGLE_BOOKS_COUNTRY in js/config.js";
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return "Open Library did not respond — it may be down, or blocked on this network";
  if (/abort/i.test(text)) return "Open Library timed out";
  return text;
}

// Sort, language and year are Open Library parameters and Google has no
// equivalent, so a search WITH a filter set is answered by Open Library. That
// is a real change of index, so the note on screen says so.
// "best short stories" asks for a shelf, not a title. Google ranks it as a
// phrase and answers with novels that happen to carry those words, which is why
// a search for short stories came back full of long ones.
const SUPERLATIVE = /^(?:the\s+)?(?:best|top|greatest|good|great|finest|popular|famous|classic|must[\s-]*read|recommended)\s+(.+)$/i;
const FILLER = /\b(?:books?|novels?|stories collections?|reads?|of all time|ever|list)\b/gi;

export function asShelfRequest(phrase) {
  const match = SUPERLATIVE.exec(clean(phrase));
  if (!match) return "";
  return clean(match[1].replace(FILLER, " "));
}

// The subjects index first, because it is a real shelf rather than a text
// search for the shelf's name; the rated search behind it, which the subjects
// endpoint cannot do.
async function shelfSearch(shelf, page) {
  const rated = await openLibrarySearch({ subject: shelf }, { limit: PAGE_SIZE, page, sort: "rating" }).catch(() => ({ items: [], total: 0 }));
  if (rated.items.length) return { result: rated, note: `Read as a subject and sorted by rating, because "best" is a question about a shelf.` };

  const slug = subjectSlug(shelf);
  const shelved = await openLibrarySubject(slug, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).catch(() => ({ items: [], total: 0 }));
  if (shelved.items.length) return { result: shelved, note: "Read as a subject on Open Library." };
  return null;
}

export async function search({ scope = "auto", phrase = "", page = 1 } = {}) {
  const text = clean(phrase);
  if (!text) return { items: [], total: 0, headline: "", scope };
  lastGoogleError = null;

  const effective = scope === "auto" && looksLikeIsbn(text) ? "isbn" : scope;
  const start = (page - 1) * PAGE_SIZE;

  // An ISBN is a lookup and never widens into a text search.
  if (effective === "isbn") return await searchByIsbn(text);

  const shelf = effective === "auto" ? asShelfRequest(text) : "";

  if (shelf) {
    const found = await shelfSearch(shelf, page);
    if (found) {
      return { items: found.result.items, total: found.result.total, scope: "subject", source: "openlibrary",
        headline: `The best of ${titleCase(shelf)}`, note: found.note };
    }
    // Nothing shelved under it. It may just be a title with "best" in it.
  }

  if (effective === "subject") {
    const slug = subjectSlug(text);
    const result = await openLibrarySubject(slug, { limit: PAGE_SIZE, offset: start });
    if (result.items.length) {
      return { items: result.items, total: result.total, scope: effective, headline: `${plural(result.total, "book", "books")} in ${result.name}` };
    }
    // An unknown slug is not an error; fall through to a plain subject search.
    const fallback = await tryGoogle(`subject:"${text}"`, { start });
    return { items: fallback.items, total: fallback.total, scope: effective, headline: `Books about ${text}` };
  }

  const query = {
    title: () => `intitle:"${text}"`,
    author: () => `inauthor:"${text}"`,
    auto: () => text
  }[effective] || (() => text);

  const result = await tryGoogle(query(), { start });

  // A quoted field search can come back empty where the same words unquoted do
  // not, so the narrow query runs first and the wide one only if needed.
  if (!result.items.length && !result.failed && effective !== "auto") {
    const relaxed = await tryGoogle(text, { start });
    if (relaxed.items.length) return { items: relaxed.items, total: relaxed.total, scope: effective, headline: headlineFor(effective, text, relaxed.total) };
  }

  // Open Library holds editions Google does not, especially older and regional ones.
  if (!result.items.length) {
    const params = effective === "author" ? { author: text } : effective === "title" ? { title: text } : { q: text };
    const backup = await openLibrarySearch(params, { limit: PAGE_SIZE, page });
    if (backup.items.length) {
      return { items: backup.items, total: backup.total, scope: effective, source: "openlibrary",
        headline: headlineFor(effective, text, backup.total) };
    }
    // Both empty AND Google refused is a config problem, not an absence of books.
    if (result.failed) throw new Error(`Google Books refused the search (${lastGoogleError?.message || "no reason given"}). Open Library found nothing either.`);
  }

  return { items: result.items, total: result.total, scope: effective, source: "google",
    headline: headlineFor(effective, text, result.total) };
}

function headlineFor(scope, text, total) {
  const count = plural(total, "result", "results");
  if (scope === "author") return `${count} by ${text}`;
  if (scope === "title") return `${count} for the title "${text}"`;
  return `${count} for "${text}"`;
}

function subjectSlug(text) {
  const known = SUBJECTS.find(entry => normaliseText(entry.label) === normaliseText(text));
  if (known) return known.slug;
  return normaliseText(text).replace(/\s+/g, "_");
}

// --- an ISBN names one printing ---------------------------------------------

// Letting this widen was the worst bug the site had: the number found nothing,
// the retry searched the digits as words, and a stranger's book came back
// looking like an answer. Nothing failing the ISBN check is shown.
async function firstAnswer(forms, ask) {
  for (const form of forms) {
    try {
      const answer = await ask(form);
      if (answer) return { answer, form };
    } catch { /* a 404 for one form is not a failure of the lookup */ }
  }
  return { answer: null, form: "" };
}

export async function searchByIsbn(text) {
  const forms = isbnForms(text);
  const canonical = normaliseIsbn(text) || forms[0] || clean(text);
  if (!forms.length) {
    return { items: [], total: 0, scope: "isbn", headline: `"${clean(text)}" is not a valid ISBN`,
      note: "An ISBN is 10 or 13 digits. Check for a missing or extra one." };
  }

  const [edition, raw, google] = await Promise.all([
    firstAnswer(forms, form => openLibraryByIsbn(form)),
    firstAnswer(forms, form => openLibraryEditionByIsbn(form)),
    firstAnswer(forms, form => googleByIsbn(form))
  ]);

  // Open Library leads: it is the only one that knows which printing this is.
  let base = edition.answer || google.answer;
  if (!base) {
    // Still an ISBN query. The works index can hold a number with no edition record.
    const backup = await openLibrarySearch({ isbn: forms[0] }, { limit: 5 }).catch(() => ({ items: [] }));
    base = backup.items.find(item => carriesIsbn(item, canonical)) || backup.items[0] || null;
  }

  if (!base) {
    return { items: [], total: 0, scope: "isbn", headline: `Nothing is catalogued under ISBN ${canonical}`,
      note: "Neither Google Books nor Open Library holds an edition with that number. Try searching the title instead." };
  }

  base = { ...base };
  if (edition.answer && google.answer) merge(base, google.answer, { preferExisting: true });

  // The number asked for is the number shown; an edition can list a dozen.
  if (normaliseIsbn(canonical)) base.isbn13 = normaliseIsbn(canonical);
  const ten = forms.find(form => form.length === 10);
  if (ten) base.isbn10 = ten;

  const record = raw.answer;
  if (record) {
    base.language = base.language || languageName((record.languages || [])[0]?.key);
    base.edition = base.edition || clean(record.edition_name || record.publish_date || "");
    base.pages = base.pages || Number(record.number_of_pages) || null;
    base.publisher = base.publisher || clean((record.publishers || [])[0]);
    base.editionKey = base.editionKey || clean(record.key);
    // The blurb and the strips hang off the work, not this one printing.
    const work = clean((record.works || [])[0]?.key);
    if (work) {
      base.workKey = work;
      base.id = `ol:${work}`;
      base.source = "openlibrary";
    }
  }

  return {
    items: [base], total: 1, scope: "isbn",
    source: edition.answer ? "openlibrary" : "google",
    headline: `ISBN ${canonical}`,
    note: `One edition, matched exactly on its ISBN. From ${edition.answer ? "Open Library" : "Google Books"}.`
  };
}

// --- trending ---------------------------------------------------------------

export const TRENDING_PERIODS = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
  { key: "yearly", label: "This year" }
];

// The trending feed is the one endpoint here with no second opinion, so a bad
// day for it used to mean a blank home page. Four sources now, ending with the
// subjects index — the same endpoint the chips use, so it is known to work in
// the browser. Whatever failed on the way is carried out with the result rather
// than swallowed, because a silent fallback is a bug that cannot be reported.
const LAST_GOOD = "bv:trending:last";

export async function trending(period = "weekly") {
  const problems = [];

  try {
    const books = await openLibraryTrending(period, { limit: PAGE_SIZE });
    if (books.length) { remember(books); return { items: books, source: "trending", problems }; }
    problems.push("the trending feed answered with no books");
  } catch (error) {
    problems.push(error?.message || "the trending feed could not be reached");
  }

  // Most people with it on a shelf. Not the same question, and near enough.
  try {
    const mostRead = await openLibrarySearch({ q: "*" }, { limit: PAGE_SIZE, sort: "readinglog", fast: true });
    if (mostRead.items.length) { remember(mostRead.items); return { items: mostRead.items, source: "readinglog", problems }; }
  } catch (error) {
    problems.push(error?.message || "the search index could not be reached");
  }

  try {
    const shelf = await openLibrarySubject("fiction", { limit: PAGE_SIZE, fast: true });
    if (shelf.items.length) { remember(shelf.items); return { items: shelf.items, source: "subject", problems }; }
  } catch (error) {
    problems.push(error?.message || "the subjects index could not be reached");
  }

  const google = await tryGoogle("subject:fiction", { limit: PAGE_SIZE, orderBy: "newest" });
  if (google.items.length) {
    remember(google.items);
    return { items: google.items, source: "google", problems };
  }
  if (googleTrouble()) problems.push(googleTrouble());

  // Everything is down. Yesterday's feed is stale, and stale beats a blank page
  // with an apology on it.
  const kept = recall();
  if (kept.length) return { items: kept, source: "stale", problems };

  return { items: [], source: "none", problems };
}

// Only the trending feed is kept: it is the one view with nothing behind it.
// The edition lists are trimmed on the way in, because a popular novel carries
// hundreds of ISBNs and this has a storage quota to live inside.
function remember(items) {
  const light = items.slice(0, PAGE_SIZE).map(item => ({ ...item, editionIsbns: (item.editionIsbns || []).slice(0, 60) }));
  try { store.set(LAST_GOOD, JSON.stringify(light)); } catch { /* quota */ }
}

function recall() {
  try {
    const kept = JSON.parse(store.get(LAST_GOOD) || "[]");
    return Array.isArray(kept) ? kept : [];
  } catch { return []; }
}

// --- browsing ---------------------------------------------------------------

// The subject chips. *:* is solr's match-all and the only spelling it accepts;
// a bare * is parsed as a term and finds nothing.
export async function browse({ subject = "", page = 1 } = {}) {
  const params = subject ? { subject } : { q: "*:*" };
  const result = await openLibrarySearch(params, { limit: PAGE_SIZE, page });
  const headline = [plural(result.total, "book", "books"), subject].filter(Boolean).join(" · ");
  return { ...result, headline };
}

// --- one book, fully filled in ----------------------------------------------

// Google usually has the description and the page count, Open Library the
// subjects and the rating, so each fills the other's gaps.
export async function details(entry) {
  const base = { ...entry };

  if (base.source === "google" && base.id) {
    const full = await googleVolume(base.id.replace(/^gb:/, "")).catch(() => null);
    if (full) merge(base, full);
    if (!base.genres.length || !base.rating) {
      fold(base, await lookupOpenLibrary(base).catch(() => null));
    }
    return base;
  }

  if (base.source === "openlibrary" && base.id) {
    const key = base.workKey || base.id.replace(/^ol:/, "");
    const isWork = key.includes("/works/") || !key.includes("/books/");
    const [work, editions] = await Promise.all([
      openLibraryWork(key).catch(() => null),
      isWork ? openLibraryEditions(key, 20).catch(() => null) : Promise.resolve(null)
    ]);
    if (work) {
      base.description = base.description || descriptionOf(work);
      base.genres = unique([...(base.genres || []), ...(work.subjects || []).slice(0, 8)]);
    }

    // As a set, and the search doc's publisher is overwritten: it belongs to
    // whichever printing sorted first, not to the edition being shown.
    const known = base.isbn13 || base.isbn10;
    applyEdition(base, pickEdition(editions?.entries, known), { keepIsbn: Boolean(known) });

    if (!base.description || !base.pages) {
      fold(base, await lookupGoogle(base).catch(() => null));
    }
    return base;
  }

  // Anything else: a title and an ISBN and nothing else worth showing.
  fold(base, await lookupGoogle(base).catch(() => null));
  return base;
}

function merge(target, source, { preferExisting = false, skip = [] } = {}) {
  for (const [field, value] of Object.entries(source)) {
    if (skip.includes(field)) continue;
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
    const current = target[field];
    const blank = current == null || current === "" || (Array.isArray(current) && !current.length);
    if (blank || !preferExisting) {
      if (field === "genres") target.genres = unique([...(target.genres || []), ...value]);
      else if (field !== "id" && field !== "source") target[field] = value;
      else if (blank) target[field] = value;
    }
  }
  return target;
}

// A record found by TITLE is the same book but not necessarily the same
// edition, so it may not donate these to a book that already has them.
const EDITION_FIELDS = ["isbn13", "isbn10", "publisher", "pages", "edition", "editionKey", "language"];

function fold(base, found) {
  if (!found) return base;
  return merge(base, found.book, { preferExisting: true, skip: found.exact ? [] : EDITION_FIELDS });
}

async function lookupGoogle(entry) {
  const isbn = entry.isbn13 || entry.isbn10;
  if (isbn) {
    const exact = await googleByIsbn(isbn).catch(() => null);
    if (exact) return { book: exact, exact: true };
  }
  const author = (entry.authors || [])[0] || entry.author || "";
  const query = author ? `intitle:"${entry.title}" inauthor:"${author}"` : `intitle:"${entry.title}"`;
  const byTitle = await tryGoogle(query, { limit: 3 });
  return byTitle.items[0] ? { book: byTitle.items[0], exact: false } : null;
}

async function lookupOpenLibrary(entry) {
  const isbn = entry.isbn13 || entry.isbn10;
  if (isbn) {
    const exact = await openLibraryByIsbn(isbn).catch(() => null);
    if (exact) return { book: exact, exact: true };
    const found = await openLibrarySearch({ isbn }, { limit: 3 }).catch(() => ({ items: [] }));
    const hit = found.items.find(item => carriesIsbn(item, isbn));
    if (hit) return { book: hit, exact: true };
  }
  const author = (entry.authors || [])[0] || entry.author || "";
  const params = author ? { title: entry.title, author } : { title: entry.title };
  const byTitle = await openLibrarySearch(params, { limit: 3 }).catch(() => ({ items: [] }));
  return byTitle.items[0] ? { book: byTitle.items[0], exact: false } : null;
}

// --- other editions of the same work ----------------------------------------

// There is no arithmetic from one ISBN to the rest: editions are grouped by
// WORK, so the work has to be resolved first and its editions listed.
export async function workKeyFor(entry) {
  if (entry.workKey) return entry.workKey;
  if (typeof entry.id === "string" && entry.id.includes("/works/")) return entry.id.replace(/^ol:/, "");

  const isbn = entry.isbn13 || entry.isbn10 || entry.isbn;
  if (isbn) {
    const record = await firstAnswer(isbnForms(isbn), form => openLibraryEditionByIsbn(form));
    const key = clean((record.answer?.works || [])[0]?.key);
    if (key) return key;
  }

  const author = (entry.authors || [])[0] || entry.author || "";
  const params = author ? { title: entry.title, author } : { title: entry.title };
  const found = await openLibrarySearch(params, { limit: 1 }).catch(() => ({ items: [] }));
  return found.items[0]?.workKey || "";
}

// Every printing Open Library knows about, newest and most complete first.
export async function otherEditions(entry, limit = 50) {
  const key = await workKeyFor(entry).catch(() => "");
  if (!key) return [];

  const payload = await openLibraryEditions(key, limit).catch(() => null);
  const mine = new Set(isbnForms(entry.isbn13 || entry.isbn10 || entry.isbn));
  const seen = new Set();

  return (payload?.entries || [])
    .map(editionSummary)
    .filter(edition => {
      const id = edition.isbn13 || edition.isbn10;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(edition => ({ ...edition, isMine: mine.has(edition.isbn13) || mine.has(edition.isbn10) }))
    .sort((a, b) => (b.year || 0) - (a.year || 0));
}

// The Other Versions cell, written the same way OtherVersions.gs writes it:
// ISBN first, then the human part. The two must agree or a row written by the
// site and a row filled by the script would parse differently.
export function editionLines(editions) {
  return editions
    .filter(edition => !edition.isMine)
    .map(edition => editionLine({ isbn: edition.isbn13 || edition.isbn10, ...edition }))
    .filter(Boolean)
    .join("\n");
}

// Every ISBN this book is known by, so a shelf can be searched for all of them.
export function editionIsbns(editions) {
  return unique(editions.flatMap(edition => [edition.isbn13, edition.isbn10]));
}

// --- reading it now ---------------------------------------------------------

// Open Library hosts no files itself; a scanned copy lives at the Internet
// Archive under the edition's ocaid. "public" is readable and downloadable,
// anything else is lending-only and only a borrow link is honest.
export function ebookLinks(entry) {
  const id = clean(entry.ocaid);
  if (!id) return null;
  const free = entry.ebookAccess === "public" || entry.ebookAccess === "full";
  return {
    free,
    read: `https://archive.org/details/${encodeURIComponent(id)}`,
    pdf: free ? `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}.pdf` : "",
    label: free ? "Read free" : "Borrow"
  };
}

// --- the two related strips -------------------------------------------------

// No source has a "related books" endpoint, so these are what can honestly be
// built. Each falls through to Open Library: a modal fires several requests at
// once, and one 429 used to empty both strips.
export async function moreByAuthor(entry, limit = 12) {
  const author = (entry.authors || [])[0] || entry.author || "";
  if (!author) return [];

  const google = await tryGoogle(`inauthor:"${author}"`, { limit: limit + 8 });
  let items = byAuthor(dedupe(google.items, entry), author);

  if (items.length < 4) {
    const backup = await openLibrarySearch({ author }, { limit: limit + 8 }).catch(() => ({ items: [] }));
    items = byAuthor(dedupe([...items, ...backup.items], entry), author);
  }
  return items.slice(0, limit);
}

// inauthor: also returns books ABOUT a person, so the strip is filtered back
// down to the name it promises.
function byAuthor(items, author) {
  const wanted = normaliseAuthor(author);
  if (!wanted) return items;
  return items.filter(item => {
    const names = (item.authors || []).map(normaliseAuthor).filter(Boolean);
    if (!names.length) return false;
    return names.some(name => name === wanted || name.includes(wanted) || wanted.includes(name));
  });
}

// "Fiction" is not a recommendation, and it is the root of almost every Google
// category path, so the strongest subject is the most specific one.
const VAGUE = new Set([
  "fiction", "nonfiction", "non fiction", "general", "literature", "books",
  "novel", "novels", "english fiction", "juvenile fiction", "fictional",
  "literary", "classics", "miscellanea", "translations", "accessible book"
]);

export function strongestSubject(entry) {
  const list = (entry.genres && entry.genres.length ? entry.genres : [entry.genre])
    .map(genre => clean(genre)).filter(Boolean).filter(genre => genre.length < 32);
  return list.find(genre => !VAGUE.has(normaliseText(genre))) || list[0] || "";
}

export async function similarBooks(entry, limit = 12) {
  const subject = strongestSubject(entry);
  if (!subject) return [];

  const google = await tryGoogle(`subject:"${subject}"`, { limit: limit + 8 });
  let items = dedupe(google.items, entry);

  // The subjects endpoint is a real index, so it comes before the search index.
  if (items.length < 4) {
    const shelf = await openLibrarySubject(subjectSlug(subject), { limit: limit + 8 }).catch(() => ({ items: [] }));
    items = dedupe([...items, ...shelf.items], entry);
  }
  if (items.length < 4) {
    const backup = await openLibrarySearch({ subject }, { limit: limit + 8 }).catch(() => ({ items: [] }));
    items = dedupe([...items, ...backup.items], entry);
  }
  return items.slice(0, limit);
}

// Two sources answering one question will repeat themselves.
function dedupe(items, exclude) {
  const seen = new Set([normaliseText(exclude.title)]);
  const wantIsbn = normaliseIsbn(exclude.isbn13 || exclude.isbn10 || exclude.isbn);
  return items.filter(item => {
    const key = normaliseText(item.title);
    if (!key || seen.has(key)) return false;
    if (wantIsbn && carriesIsbn(item, wantIsbn)) return false;
    seen.add(key);
    return true;
  });
}
