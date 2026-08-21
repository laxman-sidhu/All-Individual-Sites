import { fetchTab } from "./sheets.js";
import { keyOf, looseKeyOf, keysFor, firstAuthor, normaliseIsbn, isbnOf, carriesIsbn, ownIsbns, parseVersions, versionIsbnsOf, nearAuthor } from "./identity.js";
import { clean, cleanLines, titleCase, normaliseText, normaliseAuthor, yearOf, searchTerms, matchesTerms } from "../core/util.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";

function toEntry(row) {
  return {
    key: keyOf(row),
    title: clean(row.title),
    isbn: normaliseIsbn(row.isbn),
    author: clean(row.author),
    genre: titleCase(clean(row.genre)) || "",
    cover: clean(row.cover),
    summary: cleanLines(row.summary),
    reader: clean(row.reader),
    book_id: clean(row.book_id),
    year: yearOf(row.year) || null,
    versions: parseVersions(row.versions),
    rows: []
  };
}

class Readlist {
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
      if (!entry.cover && row.cover) entry.cover = clean(row.cover);
      if (!entry.summary && row.summary) entry.summary = cleanLines(row.summary);
      if (!entry.genre && row.genre) entry.genre = titleCase(clean(row.genre));
      if (!entry.versions.length && row.versions) entry.versions = parseVersions(row.versions);
    }
    for (const entry of this.byKey.values()) {
      const title = looseKeyOf(entry);
      if (!this.byTitle.has(title)) this.byTitle.set(title, []);
      this.byTitle.get(title).push(entry);
      if (entry.isbn && !this.byIsbn.has(entry.isbn)) this.byIsbn.set(entry.isbn, entry);

      // Every OTHER printing, pointing back at the queued row.
      for (const isbn of entry.versions) {
        if (isbn === entry.isbn || this.byVersion.has(isbn)) continue;
        this.byVersion.set(isbn, entry);
      }
    }
    for (const isbn of this.byIsbn.keys()) this.byVersion.delete(isbn);
  }

  // A different printing of something already queued. Same rule as the library:
  // never folded into find(), because they are different claims.
  findVersion(book) {
    return this.versionMatch(book).entry;
  }

  versionMatch(book) {
    const isbn = isbnOf(book);
    if (isbn && this.byVersion.has(isbn)) return { entry: this.byVersion.get(isbn), via: "isbn" };
    for (const other of versionIsbnsOf(book)) {
      if (other === isbn) continue;
      const hit = this.byIsbn.get(other) || this.byVersion.get(other);
      if (hit) return { entry: hit, via: "isbn" };
    }
    // Title and author alone, which is the weaker claim. Same rule as the
    // library, and it colours a card yellow rather than violet.
    const wanted = normaliseAuthor(firstAuthor(book));
    if (wanted) {
      for (const entry of this.byTitle.get(looseKeyOf(book)) || []) {
        if (!entry.isbn || carriesIsbn(book, entry.isbn)) continue;
        if (nearAuthor(wanted, normaliseAuthor(entry.author))) return { entry, via: "guess" };
      }
    }
    return { entry: null, via: "" };
  }

  async load({ useSnapshot = true } = {}) {
    if (useSnapshot) {
      const snap = readSnapshot("readlist");
      if (snap) this.reset(snap);
    }
    const rows = await fetchTab("readlist");
    this.reset(rows);
    writeSnapshot("readlist", rows);
    return this;
  }

  hydrate() {
    const snap = readSnapshot("readlist");
    if (snap) this.reset(snap);
    return this.loaded;
  }

  find(book) {
    const isbn = isbnOf(book);
    if (isbn) {
      for (const entry of this.byKey.values()) if (entry.isbn && carriesIsbn(book, entry.isbn)) return entry;
    }

    // Same rule as the library: a different ISBN is a different printing, and
    // silence on either side says nothing and stays eligible for a title match.
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
    const loose = looseKeyOf(book);
    if (!loose) return null;
    if (firstAuthor(book)) {
      const hit = this.byKey.get(loose);
      return hit && ok(hit) ? hit : null;
    }
    return (this.byTitle.get(loose) || []).find(ok) || null;
  }

  has(book) { return Boolean(this.find(book)); }

  annotate(book) {
    const entry = this.find(book);
    book.queued = Boolean(entry);
    book.queued_for = entry?.reader || "";
    book.queued_title = entry?.title || "";
    book.queued_author = entry?.author || "";

    const match = entry ? { entry: null, via: "" } : this.versionMatch(book);
    const other = match.entry;
    book.version_queued = Boolean(other);
    book.version_queued_via = match.via;
    book.version_queued_for = other?.reader || "";
    book.version_queued_title = other?.title || "";
    return book;
  }

  // "Readlist of Who ?" makes the queue three queues sharing one tab, so it
  // filters the same way the library does.
  readers() {
    const counts = new Map();
    for (const entry of this.byKey.values()) {
      if (entry.reader) counts.set(entry.reader, (counts.get(entry.reader) || 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }

  genres(reader = "") {
    const counts = new Map();
    for (const entry of this.byKey.values()) {
      if (reader && entry.reader !== reader) continue;
      const genre = entry.genre || "Uncategorised";
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
  }

  // Any of these ISBNs, so a different printing of the same book is still found.
  findByIsbns(list) {
    for (const value of list || []) {
      const isbn = normaliseIsbn(value);
      if (isbn && this.byIsbn.has(isbn)) return this.byIsbn.get(isbn);
    }
    return null;
  }

  list({ reader = "", genre = "", query = "", sort = "title" } = {}) {
    // Same rule as the library: any word order, and a pasted ISBN is a lookup.
    const asIsbn = normaliseIsbn(query);
    const terms = asIsbn ? [] : searchTerms(query);
    const items = [...this.byKey.values()].filter(entry => {
      if (reader && entry.reader !== reader) return false;
      if (genre && (entry.genre || "Uncategorised") !== genre) return false;
      if (asIsbn) return entry.isbn === asIsbn;
      return matchesTerms(`${entry.title} ${entry.author} ${entry.genre} ${entry.reader} ${entry.summary}`, terms);
    });
    const by = {
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.author || "~").localeCompare(b.author || "~") || a.title.localeCompare(b.title),
      genre: (a, b) => (a.genre || "~").localeCompare(b.genre || "~") || a.title.localeCompare(b.title),
      recent: (a, b) => this.rows.indexOf(b.rows[0]) - this.rows.indexOf(a.rows[0])
    };
    items.sort(by[sort] || by.title);
    return items;
  }

  stats() {
    const entries = [...this.byKey.values()];
    return { books: entries.length, rows: this.rows.length, genres: this.genres().length };
  }

  applyAdd(row) {
    if (this.byKey.has(keyOf(row))) return false;
    this.rows.push(row);
    this._index();
    writeSnapshot("readlist", this.rows);
    return true;
  }

  applyRemove(book) {
    const target = this.find(book);
    if (!target) return 0;
    const doomed = new Set(target.rows);
    this.rows = this.rows.filter(row => !doomed.has(row));
    this._index();
    writeSnapshot("readlist", this.rows);
    return doomed.size;
  }
}

export const readlist = new Readlist();
