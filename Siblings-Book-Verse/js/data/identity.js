import { normaliseText, normaliseAuthor } from "../core/util.js";

// The only true identifier a book has. Both forms convert to 13 first, or
// 0062315005 never matches 9780062315007.
export function normaliseIsbn(value) {
  const bare = String(value == null ? "" : value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (bare.length === 13) return bare;
  if (bare.length !== 10) return "";

  const body = "978" + bare.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + String((10 - (sum % 10)) % 10);
}

// Google indexes some editions under the 10 and some under the 13, so lookups
// ask for both. Only a 978 prefix ever had a 10-digit form.
export function toIsbn10(value) {
  const bare = String(value == null ? "" : value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (bare.length === 10) return bare;
  if (bare.length !== 13 || !bare.startsWith("978")) return "";

  const body = bare.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? "X" : String(check));
}

export function isbnForms(value) {
  const thirteen = normaliseIsbn(value);
  const ten = toIsbn10(thirteen || value);
  return [...new Set([thirteen, ten].filter(Boolean))];
}

// The printing a record claims to BE, as opposed to every printing of the work
// it happens to list. A record with none of these names no printing at all.
export function ownIsbns(book) {
  return [...new Set([book?.isbn13, book?.isbn10, book?.isbn].map(normaliseIsbn).filter(Boolean))];
}

// A result offered as the answer to an ISBN query must carry that ISBN.
export function carriesIsbn(book, wanted) {
  const want = normaliseIsbn(wanted);
  if (!want) return false;
  return ownIsbns(book).includes(want);
}

// The Other Versions cell, one edition per line, ISBN first. Only the ISBN is
// read: the rest of the line is for a human and may be reformatted freely.
// "None" and a line whose first token is not an ISBN both yield nothing.
export function parseVersions(text) {
  const found = String(text == null ? "" : text)
    .split(/\r?\n/)
    .map(line => normaliseIsbn(line.trim().split(/[\s·|,;]+/)[0]))
    .filter(Boolean);
  return [...new Set(found)];
}

// Open Library has "Paulo Coello" for "Paulo Coelho". One typo should not make
// a book a stranger, so the WEAKER claim accepts a single edit. find() does not.
export function nearAuthor(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 8) return false;
  return withinOneEdit(a, b);
}

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function isbnOf(book) {
  return normaliseIsbn(book?.isbn13 || book?.isbn || book?.isbn10 || "");
}

// Every printing a record knows itself by. Open Library lists a whole work's
// ISBNs in one array; `versions` may be the sheet's cell text or a parsed list.
export function versionIsbnsOf(book) {
  const raw = [
    ...(Array.isArray(book?.editionIsbns) ? book.editionIsbns : []),
    ...(Array.isArray(book?.versions) ? book.versions : []),
    ...(typeof book?.versions === "string" ? parseVersions(book.versions) : [])
  ];
  return [...new Set(raw.map(normaliseIsbn).filter(Boolean))];
}

// The filing form of a title. A leading article is not part of it: every
// catalogue shelves "The Metamorphosis" under M, and the sheet and the APIs
// disagree about whether to type it at all. Without this, one card says
// Metamorphosis, the row says The Metamorphosis, and they are two books.
// English only - "De" and "Il" are articles in one language and words in
// another, and merging on those would cost more than it saved.
export function filingTitle(text) {
  return normaliseText(text).replace(/^(?:the|a|an)\s+/, "");
}

// Title alone is not enough: "The Alchemist" is also a Ben Jonson play.
export function keyOf(book) {
  const title = filingTitle(book?.title || book?.name || "");
  if (!title) return "";
  const author = normaliseAuthor(firstAuthor(book));
  return author ? `${title}|${author}` : `${title}|`;
}

// A row with no author is filed here and reachable by title alone.
export function looseKeyOf(book) {
  const title = filingTitle(book?.title || book?.name || "");
  return title ? `${title}|` : "";
}

// Google gives an array, Open Library gives an array, the sheet gives "A & B".
export function authorList(book) {
  if (Array.isArray(book?.authors) && book.authors.length) return book.authors.filter(Boolean);
  const raw = book?.author || "";
  return String(raw).split(/\s*(?:,|&|;| and )\s*/i).map(a => a.trim()).filter(Boolean);
}

export function firstAuthor(book) {
  return authorList(book)[0] || "";
}

export function authorText(book) {
  return authorList(book).join(", ");
}

// An id is a bonus, not the identity: it only counts when both sides have one.
export function idOf(book) {
  return String(book?.book_id || book?.id || "").trim();
}

export function sameBook(a, b) {
  const isbnA = isbnOf(a), isbnB = isbnOf(b);
  if (isbnA && isbnB) return isbnA === isbnB;
  const idA = idOf(a), idB = idOf(b);
  if (idA && idB && idA === idB) return true;
  const keyA = keyOf(a), keyB = keyOf(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  // One side records no author, so fall back to the title on its own.
  const looseA = looseKeyOf(a), looseB = looseKeyOf(b);
  if (keyA.endsWith("|") || keyB.endsWith("|")) return looseA === looseB;
  return false;
}

// Every key a book should be findable under, most specific first.
export function keysFor(book) {
  const keys = [keyOf(book)];
  const loose = looseKeyOf(book);
  if (loose && loose !== keys[0]) keys.push(loose);
  const id = idOf(book);
  if (id) keys.unshift(`id:${id}`);
  const isbn = isbnOf(book);
  if (isbn) keys.unshift(`isbn:${isbn}`);
  return keys.filter(Boolean);
}
