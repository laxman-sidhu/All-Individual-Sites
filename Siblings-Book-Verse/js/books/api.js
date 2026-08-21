import { GOOGLE_BOOKS_API, GOOGLE_BOOKS_COUNTRY, GOOGLE_BOOKS_KEYS, OPEN_LIBRARY_API, OPEN_LIBRARY_COVERS, PAGE_SIZE } from "../config.js";
import { getJSON } from "../core/http.js";
import { cached } from "../core/cache.js";
import { clean, stripHtml, titleCase, unique, yearOf } from "../core/util.js";
import { normaliseIsbn, isbnForms } from "../data/identity.js";

// One shape, whichever source answered. Nothing downstream knows which did.
function book(fields) {
  return {
    id: "", source: "", title: "", subtitle: "", authors: [], year: null,
    cover: "", coverAlt: "", genres: [], description: "",
    isbn13: "", isbn10: "", pages: null, publisher: "",
    // Every printing this record knows of, where the source lists them.
    editionIsbns: [],
    // Which printing this is. Two ISBNs can name one novel in two languages.
    language: "", edition: "", workKey: "", editionKey: "",
    // Internet Archive scan id, and whether it can be read or only borrowed.
    ocaid: "", ebookAccess: "",
    rating: null, ratingCount: null, previewLink: "", infoLink: "",
    ...fields
  };
}

const bare = value => String(value == null ? "" : value).replace(/[^0-9Xx]/g, "").toUpperCase();

// --- Google Books -----------------------------------------------------------

// Quota is counted per project, so several keys are several allowances. Only a
// quota refusal advances the pointer: a 403 for the wrong country would burn
// every key in turn and report the last one's error instead of the real fault.
let keyAt = 0;

function googleKey() {
  const keys = (GOOGLE_BOOKS_KEYS || []).filter(Boolean);
  return keys.length ? keys[keyAt % keys.length] : "";
}

export function outOfQuota(error) {
  const text = String(error?.message || "");
  return error?.status === 429 || /quota|rateLimitExceeded|userRateLimitExceeded/i.test(text);
}

// Tries the current key, then each of the others once. Whatever the last one
// says is what gets reported, because by then they are all spent.
async function askGoogle(build) {
  const keys = (GOOGLE_BOOKS_KEYS || []).filter(Boolean);
  const attempts = Math.max(keys.length, 1);
  let last = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await getJSON(build(googleKey()));
    } catch (error) {
      last = error;
      if (!outOfQuota(error) || keys.length < 2) break;
      keyAt = (keyAt + 1) % keys.length;
    }
  }
  throw last;
}

// --- Google Books -----------------------------------------------------------

// Their thumbnails arrive over http with a page-curl overlay drawn on.
function googleCover(links) {
  const raw = links?.thumbnail || links?.smallThumbnail || "";
  if (!raw) return "";
  return raw.replace(/^http:/, "https:").replace(/&edge=curl/g, "");
}

function isbnFrom(identifiers, type) {
  const hit = (identifiers || []).find(entry => entry.type === type);
  return hit ? clean(hit.identifier) : "";
}

export function fromGoogle(volume) {
  const info = volume?.volumeInfo || {};
  const isbn13 = isbnFrom(info.industryIdentifiers, "ISBN_13");
  const isbn10 = isbnFrom(info.industryIdentifiers, "ISBN_10");
  const cover = googleCover(info.imageLinks);
  return book({
    id: `gb:${volume.id}`,
    source: "google",
    title: clean(info.title),
    subtitle: clean(info.subtitle),
    authors: (info.authors || []).map(clean).filter(Boolean),
    year: yearOf(info.publishedDate),
    cover: cover || coverByIsbn(isbn13 || isbn10, "M"),
    // A second URL for the modal, where a 128px thumbnail shows its pixels.
    coverAlt: coverByIsbn(isbn13 || isbn10, "L"),
    genres: unique((info.categories || []).flatMap(splitCategory)),
    description: stripHtml(info.description),
    isbn13, isbn10,
    pages: Number(info.pageCount) || null,
    publisher: clean(info.publisher),
    rating: Number(info.averageRating) || null,
    ratingCount: Number(info.ratingsCount) || null,
    previewLink: (info.previewLink || "").replace(/^http:/, "https:"),
    infoLink: (info.infoLink || "").replace(/^http:/, "https:")
  });
}

// Google files things as "Fiction / Fantasy / Epic"; the leaves are the useful part.
function splitCategory(category) {
  return String(category || "").split("/").map(part => titleCase(clean(part))).filter(Boolean);
}

export function coverByIsbn(isbn, size = "M") {
  if (!isbn) return "";
  // default=false makes a missing cover 404 rather than return a blank 1x1,
  // which is what lets the <img> fall back.
  return `${OPEN_LIBRARY_COVERS}/b/isbn/${encodeURIComponent(isbn)}-${size}.jpg?default=false`;
}

export function coverById(id, size = "M") {
  if (!id) return "";
  return `${OPEN_LIBRARY_COVERS}/b/id/${encodeURIComponent(id)}-${size}.jpg`;
}

export async function googleVolumes(query, { limit = PAGE_SIZE, start = 0, orderBy = "relevance" } = {}) {
  // country is not optional: without it Google answers 403 "unknown location"
  // to browser requests from several countries, India among them.
  const country = GOOGLE_BOOKS_COUNTRY ? `&country=${encodeURIComponent(GOOGLE_BOOKS_COUNTRY)}` : "";
  // Without a key this site draws on the quota every anonymous caller shares.
  const build = key => `${GOOGLE_BOOKS_API}/volumes?q=${encodeURIComponent(query)}`
    + `&maxResults=${Math.min(limit, 40)}&startIndex=${start}&printType=books&orderBy=${orderBy}${country}`
    + (key ? `&key=${encodeURIComponent(key)}` : "");
  const payload = await cached(`gb:${query}:${limit}:${start}:${orderBy}`, () => askGoogle(build));
  return {
    total: payload?.totalItems || 0,
    items: (payload?.items || []).map(fromGoogle).filter(entry => entry.title)
  };
}

export async function googleVolume(id) {
  const build = key => {
    const params = new URLSearchParams();
    if (GOOGLE_BOOKS_COUNTRY) params.set("country", GOOGLE_BOOKS_COUNTRY);
    if (key) params.set("key", key);
    return `${GOOGLE_BOOKS_API}/volumes/${encodeURIComponent(id)}${params.toString() ? `?${params}` : ""}`;
  };
  const payload = await cached(`gbv:${id}`, () => askGoogle(build));
  return payload ? fromGoogle(payload) : null;
}

// isbn: is an exact-match index, not a text search, so it returns this edition
// or nothing. Both forms are asked for because they are indexed separately.
export async function googleByIsbn(isbn) {
  for (const form of isbnForms(isbn)) {
    const result = await googleVolumes(`isbn:${form}`, { limit: 5 });
    if (!result.items.length) continue;
    const exact = result.items.find(item => normaliseIsbn(item.isbn13 || item.isbn10) === normaliseIsbn(isbn));
    return exact || result.items[0];
  }
  return null;
}

// A call with something behind it should give up quickly: the point of a
// fallback is to reach the next source, and three retries at a 20s timeout is a
// minute of nothing per dead endpoint. Calls with no fallback keep the patient
// settings.
const FAST = { attempts: 1, timeout: 6000 };

// --- Open Library -----------------------------------------------------------

// Open Library returns a language as "/languages/ita" and nothing else.
const LANGUAGE_NAMES = {
  eng: "English", spa: "Spanish", fre: "French", fra: "French", ger: "German",
  deu: "German", ita: "Italian", por: "Portuguese", dut: "Dutch", nld: "Dutch",
  rus: "Russian", jpn: "Japanese", chi: "Chinese", zho: "Chinese", ara: "Arabic",
  hin: "Hindi", mar: "Marathi", ben: "Bengali", tam: "Tamil", tel: "Telugu",
  guj: "Gujarati", kan: "Kannada", mal: "Malayalam", pan: "Punjabi", urd: "Urdu",
  san: "Sanskrit", heb: "Hebrew", kor: "Korean", swe: "Swedish", nor: "Norwegian",
  dan: "Danish", fin: "Finnish", pol: "Polish", tur: "Turkish", gre: "Greek",
  ell: "Greek", cze: "Czech", ces: "Czech", hun: "Hungarian", ukr: "Ukrainian",
  vie: "Vietnamese", tha: "Thai", ind: "Indonesian", per: "Persian", fas: "Persian",
  lat: "Latin", cat: "Catalan", ron: "Romanian", rum: "Romanian", srp: "Serbian",
  hrv: "Croatian", bul: "Bulgarian", slo: "Slovak", slk: "Slovak", slv: "Slovenian"
};

export function languageName(value) {
  const code = String(value == null ? "" : value).replace(/^\/languages\//, "").trim().toLowerCase();
  if (!code) return "";
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

const SEARCH_FIELDS = [
  "key", "title", "subtitle", "author_name", "cover_i", "first_publish_year",
  "subject", "ratings_average", "ratings_count", "number_of_pages_median",
  "isbn", "publisher", "edition_count", "language", "ebook_access", "ia"
].join(",");

// search.json and subjects.json return different shapes, so each gets its own reader.
export function fromOpenLibraryDoc(doc) {
  // The index lists every edition's ISBN in one flat array, so [0] is a coin
  // flip. Each form is picked out by its own shape instead.
  const all = (doc.isbn || []).map(bare);
  const thirteen = all.find(value => /^\d{13}$/.test(value)) || "";
  const ten = all.find(value => /^\d{9}[\dX]$/.test(value)) || "";
  const isbn = thirteen || ten;
  // The rest is the work's other printings, and one may be the row we read.
  // Not capped: a popular novel keeps its shelf ISBN somewhere past number 150.
  const every = unique(all.map(normaliseIsbn).filter(Boolean));
  return book({
    id: `ol:${clean(doc.key)}`,
    source: "openlibrary",
    title: clean(doc.title),
    subtitle: clean(doc.subtitle),
    authors: (doc.author_name || []).map(clean).filter(Boolean),
    year: Number(doc.first_publish_year) || null,
    cover: coverById(doc.cover_i, "M") || coverByIsbn(isbn, "M"),
    coverAlt: coverById(doc.cover_i, "L") || coverByIsbn(isbn, "L"),
    genres: unique((doc.subject || []).slice(0, 8).map(titleCase)),
    isbn13: thirteen,
    isbn10: ten,
    editionIsbns: every,
    pages: Number(doc.number_of_pages_median) || null,
    publisher: clean((doc.publisher || [])[0]),
    language: languageName((doc.language || [])[0]),
    workKey: clean(doc.key),
    ocaid: clean((doc.ia || [])[0]),
    ebookAccess: clean(doc.ebook_access),
    rating: round1(doc.ratings_average),
    ratingCount: Number(doc.ratings_count) || null,
    infoLink: doc.key ? `${OPEN_LIBRARY_API}${doc.key}` : ""
  });
}

export function fromOpenLibraryWork(work) {
  return book({
    id: `ol:${clean(work.key)}`,
    source: "openlibrary",
    title: clean(work.title),
    authors: (work.authors || []).map(a => clean(a?.name)).filter(Boolean),
    year: Number(work.first_publish_year) || null,
    cover: coverById(work.cover_id, "M"),
    coverAlt: coverById(work.cover_id, "L"),
    genres: unique((work.subject || []).slice(0, 8).map(titleCase)),
    workKey: clean(work.key),
    infoLink: work.key ? `${OPEN_LIBRARY_API}${work.key}` : ""
  });
}

// The bibkeys record is the ONE edition carrying this ISBN, with its own
// publisher, page count and cover: the Vallardi Italian, not the HarperOne.
export function fromOpenLibraryBibkey(record, requested = "") {
  const ids = record?.identifiers || {};
  const asked = bare(requested);
  const isbn13 = clean((ids.isbn_13 || [])[0]) || (asked.length === 13 ? asked : "");
  const isbn10 = clean((ids.isbn_10 || [])[0]) || (asked.length === 10 ? asked : "");
  const key = clean(record?.key);
  return book({
    id: key ? `ol:${key}` : "",
    source: "openlibrary",
    title: clean(record?.title),
    subtitle: clean(record?.subtitle),
    authors: (record?.authors || []).map(author => clean(author?.name)).filter(Boolean),
    year: yearOf(record?.publish_date),
    cover: clean(record?.cover?.medium) || coverByIsbn(isbn13 || isbn10, "M"),
    coverAlt: clean(record?.cover?.large) || coverByIsbn(isbn13 || isbn10, "L"),
    genres: unique((record?.subjects || []).slice(0, 8).map(subject => titleCase(clean(subject?.name || subject)))),
    description: stripHtml(record?.excerpts?.[0]?.text || ""),
    isbn13, isbn10,
    pages: Number(record?.number_of_pages) || null,
    publisher: clean((record?.publishers || [])[0]?.name),
    edition: clean(record?.publish_date),
    editionKey: key,
    infoLink: clean(record?.url) || (key ? `${OPEN_LIBRARY_API}${key}` : "")
  });
}

function round1(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

export async function openLibrarySearch(params, { limit = PAGE_SIZE, page = 1, sort = "", fast = false } = {}) {
  const query = new URLSearchParams({ ...params, limit: String(limit), page: String(page), fields: SEARCH_FIELDS });
  if (sort) query.set("sort", sort);
  const url = `${OPEN_LIBRARY_API}/search.json?${query}`;
  const payload = await cached(`ols:${query}`, () => getJSON(url, fast ? FAST : {}));
  return {
    total: payload?.numFound || 0,
    items: (payload?.docs || []).map(fromOpenLibraryDoc).filter(entry => entry.title)
  };
}

export async function openLibrarySubject(slug, { limit = PAGE_SIZE, offset = 0, fast = false } = {}) {
  const url = `${OPEN_LIBRARY_API}/subjects/${encodeURIComponent(slug)}.json?limit=${limit}&offset=${offset}`;
  const payload = await cached(`olsub:${slug}:${limit}:${offset}`, () => getJSON(url, fast ? FAST : {}));
  return {
    total: payload?.work_count || 0,
    name: clean(payload?.name) || titleCase(slug.replace(/_/g, " ")),
    items: (payload?.works || []).map(fromOpenLibraryWork).filter(entry => entry.title)
  };
}

// daily | weekly | monthly | yearly | forever
export async function openLibraryTrending(period = "weekly", { limit = PAGE_SIZE } = {}) {
  const base = `${OPEN_LIBRARY_API}/trending/${encodeURIComponent(period)}.json`;
  const payload = await cached(`oltr:${period}:${limit}`, async () => {
    // fields is asked for FIRST and by name. Without it this endpoint answers
    // with a short default set that carries no isbn at all, which is why a
    // trending card could not tell it was another printing of something read
    // while the same book found through search.json could.
    // An unsupported parameter here is a 400 rather than an ignored argument,
    // so each step drops one and the last asks for nothing.
    try { return await getJSON(`${base}?limit=${limit}&fields=${SEARCH_FIELDS}`, FAST); }
    catch { /* fall through */ }
    try { return await getJSON(`${base}?limit=${limit}`, FAST); }
    catch { return await getJSON(base, FAST); }
  });
  // Newer responses nest the list under works; older ones return it directly.
  const list = Array.isArray(payload) ? payload : (payload?.works || payload?.docs || []);
  return list.slice(0, limit).map(fromOpenLibraryDoc).filter(entry => entry.title);
}

// Normalised: authors and publishers as names, cover in three sizes.
export async function openLibraryByIsbn(isbn) {
  const number = normaliseIsbn(isbn) || bare(isbn);
  if (!number) return null;
  const url = `${OPEN_LIBRARY_API}/api/books?bibkeys=ISBN:${encodeURIComponent(number)}&format=json&jscmd=data`;
  const payload = await cached(`olisbn:${number}`, () => getJSON(url));
  const record = payload?.[`ISBN:${number}`];
  return record ? fromOpenLibraryBibkey(record, number) : null;
}

// Raw, and the only place the language and the parent work key come from.
export async function openLibraryEditionByIsbn(isbn) {
  const number = bare(isbn);
  if (!number) return null;
  return await cached(`oledi:${number}`, () => getJSON(`${OPEN_LIBRARY_API}/isbn/${encodeURIComponent(number)}.json`));
}

export async function openLibraryWork(key) {
  const path = key.startsWith("/") ? key : `/works/${key}`;
  return await cached(`olw:${path}`, () => getJSON(`${OPEN_LIBRARY_API}${path}.json`));
}

export async function openLibraryEditions(key, limit = 20) {
  const path = key.startsWith("/") ? key : `/works/${key}`;
  return await cached(`ole:${path}:${limit}`, () => getJSON(`${OPEN_LIBRARY_API}${path}/editions.json?limit=${limit}`));
}

// entries[0] is whichever printing was catalogued first, which is how a book
// ends up showing a Bulgarian publisher beside an English title.
export function pickEdition(entries, wanted = "") {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return null;

  const want = normaliseIsbn(wanted);
  const isbnsOf = entry => [...(entry.isbn_13 || []), ...(entry.isbn_10 || [])].map(normaliseIsbn);
  if (want) {
    const exact = list.find(entry => isbnsOf(entry).includes(want));
    if (exact) return exact;
  }

  const english = entry => (entry.languages || []).some(lang => /\/eng$/.test(String(lang?.key || "")));
  const score = entry => (english(entry) ? 8 : 0)
    + ((entry.isbn_13 || []).length ? 4 : 0)
    + ((entry.covers || []).length ? 2 : 0)
    + (Number(entry.number_of_pages) ? 1 : 0);

  return list.slice().sort((a, b) => score(b) - score(a))[0];
}

// One edition's facts move as a SET. Filling publisher from a search doc and
// language from a chosen edition is how a book ends up HarperOne and Turkish.
export function applyEdition(base, edition, { keepIsbn = false } = {}) {
  if (!edition) return base;
  base.publisher = clean((edition.publishers || [])[0]) || base.publisher;
  base.pages = Number(edition.number_of_pages) || base.pages;
  base.language = languageName((edition.languages || [])[0]?.key) || base.language;
  base.edition = clean(edition.edition_name || edition.publish_date || "") || base.edition;
  base.editionKey = clean(edition.key) || base.editionKey;
  base.ocaid = clean(edition.ocaid) || base.ocaid;
  if (!keepIsbn) {
    base.isbn13 = clean((edition.isbn_13 || [])[0]) || base.isbn13;
    base.isbn10 = clean((edition.isbn_10 || [])[0]) || base.isbn10;
  }
  return base;
}

// One printing, flattened for the "other editions" list.
export function editionSummary(edition) {
  return {
    key: clean(edition?.key),
    title: clean(edition?.title),
    isbn13: clean((edition?.isbn_13 || [])[0]),
    isbn10: clean((edition?.isbn_10 || [])[0]),
    publisher: clean((edition?.publishers || [])[0]),
    language: languageName((edition?.languages || [])[0]?.key),
    year: yearOf(edition?.publish_date),
    pages: Number(edition?.number_of_pages) || null,
    ocaid: clean(edition?.ocaid),
    format: clean(edition?.physical_format)
  };
}

// Older records store a description as a string, newer ones as { type, value }.
export function descriptionOf(work) {
  const raw = work?.description;
  if (!raw) return "";
  return stripHtml(typeof raw === "string" ? raw : raw.value || "");
}
