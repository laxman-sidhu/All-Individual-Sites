import { APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, OPEN_LIBRARY_COVERS } from "../config.js";
import { postPlain } from "../core/http.js";
import { invalidate } from "./sheets.js";
import { library } from "./library.js";
import { readlist } from "./readlist.js";
import { authorText, isbnOf, normaliseIsbn, parseVersions } from "./identity.js";
import { clean, cleanLines, titleCase } from "../core/util.js";

export class WriteError extends Error {
  constructor(message) { super(message); this.name = "WriteError"; }
}

export function canWrite() {
  return Boolean(APPS_SCRIPT_URL);
}

async function call(action, payload) {
  if (!canWrite()) throw new WriteError("No write bridge is configured. See SETUP.txt.");
  let body;
  try {
    body = await postPlain(APPS_SCRIPT_URL, { token: APPS_SCRIPT_TOKEN, action, payload });
  } catch (error) {
    throw new WriteError(error.message || "The write bridge could not be reached.");
  }
  if (!body || body.ok !== true) throw new WriteError(body?.error || "The sheet refused that change.");
  invalidate();
  return body;
}

// What the bridge needs to find a row again.
function identityPayload(book) {
  return {
    book_id: clean(book.book_id || book.id || ""),
    isbn: isbnOf(book),
    title: clean(book.sheet_title || book.title || ""),
    author: clean(book.sheet_author || authorText(book) || "")
  };
}

// A URL that resolves. ?default=false is there so an <img> can fall back; in a
// cell it is just a link that 404s. A book with no cover falls back to its ISBN.
function coverFor(book, isbn) {
  const direct = clean(book.cover || book.coverAlt || "");
  if (direct) return direct.replace(/([?&])default=false&?/, "$1").replace(/[?&]$/, "");
  return isbn ? `${OPEN_LIBRARY_COVERS}/b/isbn/${isbn}-L.jpg` : "";
}

// extra is folded in FIRST, then cleaned: spread last it overwrote both of these
// with their raw values and the titleCase and cleanLines did nothing.
function rowPayload(book, extra = {}) {
  const identity = identityPayload(book);
  const rest = { ...extra };
  delete rest.genre;
  delete rest.summary;

  return {
    ...identity,
    ...rest,
    genre: titleCase(clean(extra.genre ?? book.genre ?? "")),
    cover: coverFor(book, identity.isbn),
    summary: cleanLines(extra.summary ?? book.description ?? book.summary ?? ""),
    year: book.year || "",
    // "None" rather than blank: an empty cell reads as "not looked up yet",
    // which is what OtherVersions.gs would then redo on its next run.
    versions: clean(book.versions) ? book.versions : "None",
    version_count: Number(book.version_count) || 0
  };
}

// --- All Read Books ---------------------------------------------------------

// Google first, memory second: a failed remote write must change nothing here.
export async function markRead(book, { readers, genre, summary } = {}) {
  const people = (readers || []).map(clean).filter(Boolean);
  if (!people.length) throw new WriteError("Nobody was chosen as the reader.");

  const payload = { ...rowPayload(book, { genre, summary }), readers: people };
  if (!payload.title) throw new WriteError("That book has no title to write.");

  const result = await call("mark_read", payload);

  (result.added || people).forEach(reader => {
    library.applyAdd({
      title: payload.title, author: payload.author, genre: payload.genre,
      cover: payload.cover, reader, summary: payload.summary, isbn: payload.isbn,
      book_id: payload.book_id, year: String(payload.year || ""), date_read: "",
      versions: payload.versions, version_count: payload.version_count
    });
  });
  if (result.removed_from_readlist) readlist.applyRemove(book);
  return result;
}

// One more printing filed against a book already read. The line is written the
// same way OtherVersions.gs writes it, or the two would parse differently.
export async function addVersion(target, { isbn, line } = {}) {
  const number = normaliseIsbn(isbn);
  const text = clean(line);
  if (!number || !text) throw new WriteError("That edition has no ISBN, so there is nothing to file.");

  const identity = identityPayload(target);
  if (identity.isbn === number) throw new WriteError("That is the printing already on the shelf.");
  if (parseVersions(target?.versionText).includes(number)) throw new WriteError("That edition is already filed under this book.");

  const result = await call("add_version", { ...identity, edition_isbn: number, line: text });
  library.applyVersion(target, text);
  return result;
}

export async function unmarkRead(book, reader = "") {
  const payload = { ...identityPayload(book), reader: clean(reader) };
  const result = await call("remove_read", payload);
  library.applyRemove(book, clean(reader));
  return result;
}

// --- Readlist ---------------------------------------------------------------

export async function addToReadlist(book, { genre, summary, reader } = {}) {
  const payload = rowPayload(book, { genre, summary, reader: clean(reader || "") });
  if (!payload.title) throw new WriteError("That book has no title to write.");
  const result = await call("add_readlist", payload);
  readlist.applyAdd({
    title: payload.title, author: payload.author, genre: payload.genre,
    cover: payload.cover, summary: payload.summary, reader: payload.reader,
    isbn: payload.isbn, book_id: payload.book_id, year: String(payload.year || ""),
    versions: payload.versions, version_count: payload.version_count
  });
  return result;
}

export async function removeFromReadlist(book) {
  const payload = identityPayload(book);
  const result = await call("remove_readlist", payload);
  readlist.applyRemove(book);
  return result;
}
