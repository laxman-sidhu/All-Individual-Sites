import { READ_GID, READLIST_GID, APPS_SCRIPT_URL, PUBLISHED_CSV_URL } from "../config.js";
import { getJSON, getText } from "../core/http.js";
import { parseCSV } from "../core/csv.js";
import { normaliseHeader } from "../core/util.js";

export class SheetError extends Error {
  constructor(message) { super(message); this.name = "SheetError"; }
}

// Header text -> field. Add a spelling here if a column is ever renamed.
const READ_ALIASES = {
  title: ["title", "book", "book name", "name"],
  isbn: ["isbn", "isbn13", "isbn 13", "isbn-13", "isbn10", "isbn 10", "isbn-10"],
  author: ["author", "authors", "writer", "written by"],
  genre: ["genre", "genres", "category"],
  cover: ["thumbnail url", "thumbnail", "link", "cover", "cover link", "image", "poster link", "cover url", "url"],
  reader: ["read by who ?", "read by who?", "read by who", "read by", "reader", "who"],
  summary: ["summary", "description", "about", "blurb"],
  book_id: ["book id", "bookid", "book_id", "id", "google id", "olid"],
  year: ["year", "published", "publish year", "first published"],
  date_read: ["date read", "read on", "finished", "date"],
  versions: ["other versions", "other version", "other editions", "editions"],
  version_count: ["count", "versions count", "edition count", "editions count"]
};

const READLIST_ALIASES = {
  title: READ_ALIASES.title,
  isbn: READ_ALIASES.isbn,
  author: READ_ALIASES.author,
  genre: READ_ALIASES.genre,
  cover: READ_ALIASES.cover,
  summary: READ_ALIASES.summary,
  reader: ["readlist of who ?", "readlist of who?", "readlist of who", "added by", "for", "suggested by", "reader"],
  book_id: READ_ALIASES.book_id,
  year: READ_ALIASES.year,
  versions: READ_ALIASES.versions,
  version_count: READ_ALIASES.version_count
};

const TABS = {
  read: { gid: READ_GID, aliases: READ_ALIASES, label: "All Read Books" },
  readlist: { gid: READLIST_GID, aliases: READLIST_ALIASES, label: "Readlist" }
};

export { READ_ALIASES, READLIST_ALIASES };

// Shapes a raw grid without touching the network, for the tests and the bridge check.
export function shapeTab(which, header, rows) {
  const tab = TABS[which];
  if (!tab) throw new SheetError(`No tab called "${which}".`);
  return shapeRows(header, rows, tab.aliases);
}

// The FIRST column naming a field wins, which is the rule Code.gs follows too.
export function mapColumns(header, aliases) {
  const mapping = {};
  const claimed = new Set();
  header.forEach((column, index) => {
    const normalised = normaliseHeader(column);
    if (!normalised) return;
    for (const [field, spellings] of Object.entries(aliases)) {
      if (claimed.has(field)) continue;
      if (spellings.includes(normalised)) { mapping[index] = field; claimed.add(field); break; }
    }
  });
  return mapping;
}

export function shapeRows(header, rows, aliases) {
  const mapping = mapColumns(header, aliases);
  const fields = Object.keys(aliases);
  const out = [];
  for (const raw of rows) {
    if (!raw.some(cell => String(cell == null ? "" : cell).trim())) continue;
    const record = {};
    fields.forEach(field => { record[field] = ""; });
    raw.forEach((cell, index) => {
      const field = mapping[index];
      if (field) record[field] = String(cell == null ? "" : cell).trim();
    });
    if (record.title) out.push(record);
  }
  return out;
}

// --- the bridge -------------------------------------------------------------

let bridgeRead = null;

// One request for both tabs: two would each pay the script's cold start.
function readBridge() {
  if (!bridgeRead) {
    if (!APPS_SCRIPT_URL) return Promise.reject(new SheetError("No bridge configured."));
    bridgeRead = getJSON(`${APPS_SCRIPT_URL}?action=read`, { timeout: 25000 })
      .then(payload => {
        if (!payload || payload.ok !== true || !payload.tabs) throw new SheetError("The bridge answered, but not with sheet data.");
        return payload.tabs;
      })
      .catch(error => { bridgeRead = null; throw error; });
  }
  return bridgeRead;
}

// --- the fallback -----------------------------------------------------------

// Google caches this for a few minutes, so a fresh write can be invisible here.
async function readCSV(gid) {
  if (!PUBLISHED_CSV_URL) throw new SheetError("No published CSV is configured.");
  const joiner = PUBLISHED_CSV_URL.includes("?") ? "&" : "?";
  const text = await getText(`${PUBLISHED_CSV_URL}${joiner}gid=${encodeURIComponent(gid)}`, { timeout: 20000 });
  const rows = parseCSV(text);
  if (!rows.length) throw new SheetError("The published sheet came back empty.");
  return { header: rows[0], rows: rows.slice(1) };
}

export async function fetchTab(which) {
  const tab = TABS[which];
  if (!tab) throw new SheetError(`No tab called "${which}".`);

  try {
    const tabs = await readBridge();
    const payload = tabs[which];
    if (payload && Array.isArray(payload.header)) return shapeRows(payload.header, payload.rows || [], tab.aliases);
  } catch {
    // A missing deployment should cost the write buttons, not the whole site.
  }

  try {
    const table = await readCSV(tab.gid);
    return shapeRows(table.header, table.rows, tab.aliases);
  } catch (error) {
    throw new SheetError(`Could not read ${tab.label}. Check APPS_SCRIPT_URL in js/config.js, or that the sheet is still published to the web. (${error.message})`);
  }
}

export function invalidate() {
  bridgeRead = null;
}
