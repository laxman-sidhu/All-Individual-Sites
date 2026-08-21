import { normaliseIsbn } from "./identity.js";
import { clean, yearOf } from "../core/util.js";

// One line of the Other Versions cell: ISBN · Language · Publisher · Year, with
// everything after the ISBN optional. OtherVersions.gs writes it this way and
// js/books/discover.js builds it the same way, so the three must agree.

const LANGUAGES = new Set([
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch",
  "Russian", "Japanese", "Chinese", "Arabic", "Hindi", "Marathi", "Bengali",
  "Tamil", "Telugu", "Gujarati", "Kannada", "Malayalam", "Punjabi", "Urdu",
  "Sanskrit", "Hebrew", "Korean", "Swedish", "Norwegian", "Danish", "Finnish",
  "Polish", "Turkish", "Greek", "Czech", "Hungarian", "Ukrainian", "Vietnamese",
  "Thai", "Indonesian", "Persian", "Latin", "Catalan", "Romanian", "Serbian",
  "Croatian", "Bulgarian", "Slovak", "Slovenian"
]);

// A language OtherVersions.gs could not name is left as its bare code.
function isLanguage(part) {
  return LANGUAGES.has(part) || /^[A-Z]{2,3}$/.test(part);
}

export function parseEditionLine(text) {
  const parts = String(text == null ? "" : text).split("·").map(part => part.trim()).filter(Boolean);
  const isbn = normaliseIsbn(parts[0]);
  if (!isbn) return null;

  const rest = parts.slice(1);
  let year = null;
  if (rest.length && /^\D*\d{4}\D*$/.test(rest[rest.length - 1])) year = yearOf(rest.pop());

  const language = rest.length && isLanguage(rest[0]) ? rest.shift() : "";
  return { isbn, language, publisher: rest.join(" · "), year, line: clean(text) };
}

// Whole lines, deduplicated by ISBN. "None" and anything not starting with an
// ISBN yield nothing, exactly as parseVersions() does.
export function parseEditionLines(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const edition = parseEditionLine(raw);
    if (!edition || seen.has(edition.isbn)) continue;
    seen.add(edition.isbn);
    out.push(edition);
  }
  return out;
}

export function editionLine({ isbn, language, publisher, year } = {}) {
  const number = normaliseIsbn(isbn);
  if (!number) return "";
  return [number, clean(language), clean(publisher), year ? String(year) : ""].filter(Boolean).join(" · ");
}

// What the editions page draws: one group per book that has any.
export function editionGroups(entries) {
  return entries
    .map(entry => ({ entry, editions: parseEditionLines(entry.versionText) }))
    .filter(group => group.editions.length)
    .sort((a, b) => a.entry.title.localeCompare(b.entry.title));
}

export function matchesEdition(edition, terms) {
  if (!terms.length) return true;
  const hay = `${edition.isbn} ${edition.language} ${edition.publisher} ${edition.year || ""}`.toLowerCase();
  return terms.every(term => hay.includes(term));
}
