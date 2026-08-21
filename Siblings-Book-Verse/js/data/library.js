import { fetchTab } from "./sheets.js";
import { keyOf, looseKeyOf, keysFor, authorText, firstAuthor, normaliseIsbn, isbnOf, carriesIsbn, ownIsbns, parseVersions, versionIsbnsOf, nearAuthor } from "./identity.js";
import { normaliseText, normaliseAuthor, titleCase, clean, cleanLines, yearOf, searchTerms, matchesTerms } from "../core/util.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";

// One entry per BOOK, not per row: two readers are two faces on one card.
function toEntry(row) {
  return {
    key: keyOf(row),
    title: clean(row.title),
    isbn: normaliseIsbn(row.isbn),
    author: clean(row.author),
    genre: titleCase(clean(row.genre)) || "",
    cover: clean(row.cover),
    summary: cleanLines(row.summary),
    book_id: clean(row.book_id),
    year: yearOf(row.year) || null,
    versions: parseVersions(row.versions),
    versionText: cleanLines(row.versions),
    readers: [],
    rows: []
  };
}

class Library {
  constructor() { this.reset([]); }

  reset(rows) {
    this.rows = rows;
    this.byKey = new Map();
    this.loaded = rows.length > 0;
    this._index();
  }

  _index() {
    this.byKey = new Map();
    this.byTitle = new Map();
    this.byIsbn = new Map();
    this.byVersion = new Map();
    for (const row of this.rows) {
      const key = keyOf(row);
      if (!key) continue;
      let entry = this.byKey.get(key);
      if (!entry) { entry = toEntry(row); this.byKey.set(key, entry); }
      entry.rows.push(row);
      const reader = clean(row.reader);
      if (reader && !entry.readers.includes(reader)) entry.readers.push(reader);
      // Fill anything the first row left blank.
      if (!entry.cover && row.cover) entry.cover = clean(row.cover);
      if (!entry.summary && row.summary) entry.summary = cleanLines(row.summary);
      if (!entry.genre && row.genre) entry.genre = titleCase(clean(row.genre));
      if (!entry.book_id && row.book_id) entry.book_id = clean(row.book_id);
      if (!entry.isbn && row.isbn) entry.isbn = normaliseIsbn(row.isbn);
      if (!entry.versions.length && row.versions) {
        entry.versions = parseVersions(row.versions);
        entry.versionText = cleanLines(row.versions);
      }
    }
    for (const entry of this.byKey.values()) {
      const title = looseKeyOf(entry);
      if (!this.byTitle.has(title)) this.byTitle.set(title, []);
      this.byTitle.get(title).push(entry);
      if (entry.isbn && !this.byIsbn.has(entry.isbn)) this.byIsbn.set(entry.isbn, entry);

      // Every OTHER printing of this book, pointing back at the row that was
      // actually read. An edition already on the shelf is never indexed as a
      // mere version of itself.
      for (const isbn of entry.versions) {
        if (isbn === entry.isbn || this.byVersion.has(isbn)) continue;
        this.byVersion.set(isbn, entry);
      }
    }
    for (const isbn of this.byIsbn.keys()) this.byVersion.delete(isbn);
  }

  async load({ useSnapshot = true } = {}) {
    if (useSnapshot) {
      const snap = readSnapshot("read");
      if (snap) this.reset(snap);
    }
    const rows = await fetchTab("read");
    this.reset(rows);
    writeSnapshot("read", rows);
    return this;
  }

  hydrate() {
    const snap = readSnapshot("read");
    if (snap) this.reset(snap);
    return this.loaded;
  }

  find(book) {
    const isbn = isbnOf(book);
    if (isbn) {
      for (const entry of this.byKey.values()) if (entry.isbn && carriesIsbn(book, entry.isbn)) return entry;
    }

    // An ISBN settles it both ways: a row with a DIFFERENT number is a
    // different printing, however well the title and author line up, so a title
    // match can never turn a stranger's printing green. Silence on either side
    // says nothing and stays eligible - a row with no ISBN, or a record that
    // names no printing of its own. Everything else the title alone can claim
    // is an edition, and versionMatch() is where that claim belongs.
    const mine = ownIsbns(book);
    const ok = entry => !entry.isbn || !mine.length || mine.includes(entry.isbn);

    for (const key of keysFor(book)) {
      if (key.startsWith("isbn:")) continue;
      if (key.startsWith("id:")) {
        const id = key.slice(3);
        for (const entry of this.byKey.values()) if (entry.book_id && entry.book_id === id && ok(entry)) return entry;
        continue;
      }
      const hit = this.byKey.get(key);
      if (hit && ok(hit)) return hit;
    }
    // A query with no author matches on title alone; one that has an author never
    // reaches here, so two authors are never confused.
    const loose = looseKeyOf(book);
    if (!loose) return null;
    if (firstAuthor(book)) {
      const hit = this.byKey.get(loose);
      return hit && ok(hit) ? hit : null;
    }
    return (this.byTitle.get(loose) || []).find(ok) || null;
  }

  has(book) { return Boolean(this.find(book)); }

  // A DIFFERENT printing of a book on the shelf. Deliberately not folded into
  // find(): "we have read this" and "we have read another edition of this" are
  // different claims and the second must never be shown as the first.
  findVersion(book) {
    return this.versionMatch(book).entry;
  }

  // `via` says how sure the answer is. "isbn" means the sheet names this exact
  // number; "guess" means only the title and author line up, which is the
  // weaker claim and the one worth offering to file properly.
  versionMatch(book) {
    const isbn = isbnOf(book);
    if (isbn && this.byVersion.has(isbn)) return { entry: this.byVersion.get(isbn), via: "isbn" };

    // The one that fires on a trending card: the ISBN on the cover is a coin
    // flip, but one of the work's other printings is the row on the shelf.
    for (const other of versionIsbnsOf(book)) {
      if (other === isbn) continue;
      const hit = this.byIsbn.get(other) || this.byVersion.get(other);
      if (hit) return { entry: hit, via: "isbn" };
    }
    // Same title and author, a number the sheet has never heard of - including
    // no number at all. Open Library files one book under several work records,
    // so a printing can be missing from the versions cell and still plainly be
    // an edition of a row we have.
    const wanted = normaliseAuthor(firstAuthor(book));
    if (wanted) {
      for (const entry of this.byTitle.get(looseKeyOf(book)) || []) {
        if (!entry.isbn || carriesIsbn(book, entry.isbn)) continue;
        if (nearAuthor(wanted, normaliseAuthor(entry.author))) return { entry, via: "guess" };
      }
    }
    return { entry: null, via: "" };
  }

  // Stamps a card with what the sheet knows, so the UI never guesses.
  annotate(book) {
    const entry = this.find(book);
    book.read = Boolean(entry);
    book.readers = entry ? entry.readers.slice() : [];
    book.sheet_title = entry?.title || "";
    book.sheet_author = entry?.author || "";
    book.sheet_genre = entry?.genre || "";

    // Only when this exact edition is NOT on the shelf. A book that is read is
    // read, and saying "another edition of this was read" over the top of that
    // is noise.
    const match = entry ? { entry: null, via: "" } : this.versionMatch(book);
    const other = match.entry;
    book.version_read = Boolean(other);
    book.version_via = match.via;
    book.version_readers = other ? other.readers.slice() : [];
    book.version_title = other?.title || "";
    book.version_isbn = other?.isbn || "";
    book.version_key = other?.key || "";
    return book;
  }

  // Any of these ISBNs, so a different printing of the same book is still found.
  findByIsbns(list) {
    for (const value of list || []) {
      const isbn = normaliseIsbn(value);
      if (isbn && this.byIsbn.has(isbn)) return this.byIsbn.get(isbn);
    }
    return null;
  }

  readers() {
    const counts = new Map();
    for (const entry of this.byKey.values()) {
      for (const reader of entry.readers) counts.set(reader, (counts.get(reader) || 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }

  genres(reader = "") {
    const counts = new Map();
    for (const entry of this.byKey.values()) {
      if (reader && !entry.readers.includes(reader)) continue;
      const genre = entry.genre || "Uncategorised";
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
  }

  list({ reader = "", genre = "", query = "", sort = "title" } = {}) {
    // A pasted ISBN is a lookup: its hyphens would otherwise become useless terms.
    const asIsbn = normaliseIsbn(query);
    const terms = asIsbn ? [] : searchTerms(query);
    let items = [...this.byKey.values()].filter(entry => {
      if (reader && !entry.readers.includes(reader)) return false;
      if (genre && (entry.genre || "Uncategorised") !== genre) return false;
      if (asIsbn) return entry.isbn === asIsbn;
      // Readers and summaries are searchable too.
      return matchesTerms(`${entry.title} ${entry.author} ${entry.genre} ${entry.readers.join(" ")} ${entry.summary}`, terms);
    });

    const by = {
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.author || "~").localeCompare(b.author || "~") || a.title.localeCompare(b.title),
      genre: (a, b) => (a.genre || "~").localeCompare(b.genre || "~") || a.title.localeCompare(b.title),
      readers: (a, b) => b.readers.length - a.readers.length || a.title.localeCompare(b.title),
      recent: (a, b) => this.rows.indexOf(b.rows[0]) - this.rows.indexOf(a.rows[0])
    };
    items.sort(by[sort] || by.title);
    return items;
  }

  stats() {
    const entries = [...this.byKey.values()];
    const byReader = new Map();
    const byGenre = new Map();
    for (const entry of entries) {
      for (const reader of entry.readers) byReader.set(reader, (byReader.get(reader) || 0) + 1);
      const genre = entry.genre || "Uncategorised";
      byGenre.set(genre, (byGenre.get(genre) || 0) + 1);
    }
    return {
      books: entries.length,
      rows: this.rows.length,
      shared: entries.filter(e => e.readers.length > 1).length,
      authors: new Set(entries.map(e => normaliseText(e.author)).filter(Boolean)).size,
      readers: [...byReader.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      genres: [...byGenre.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    };
  }

  // --- applied after a confirmed write, never before ------------------------

  applyAdd(row) {
    const key = keyOf(row);
    const entry = this.byKey.get(key);
    if (entry && entry.readers.includes(clean(row.reader))) return false;
    this.rows.push(row);
    this._index();
    writeSnapshot("read", this.rows);
    return true;
  }

  // One more printing on a row that is already read. Written after the sheet
  // has taken it, like every other apply*.
  applyVersion(book, line) {
    const entry = this.find(book);
    const text = clean(line);
    if (!entry || !text) return 0;
    for (const row of entry.rows) {
      const lines = String(row.versions || "").split(/\r?\n/).map(one => one.trim()).filter(one => one && one.toLowerCase() !== "none");
      lines.push(text);
      row.versions = lines.join("\n");
      row.version_count = String(lines.length);
    }
    this._index();
    writeSnapshot("read", this.rows);
    return entry.rows.length;
  }

  // Every matching row, not the first, or an old duplicate comes straight back.
  applyRemove(book, reader = "") {
    const target = this.find(book);
    if (!target) return 0;
    const doomed = new Set(reader ? target.rows.filter(r => clean(r.reader) === reader) : target.rows);
    if (!doomed.size) return 0;
    this.rows = this.rows.filter(row => !doomed.has(row));
    this._index();
    writeSnapshot("read", this.rows);
    return doomed.size;
  }

}

export const library = new Library();
export { authorText };
