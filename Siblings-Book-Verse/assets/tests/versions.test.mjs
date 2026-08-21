import assert from "node:assert";
import { suite } from "./harness.mjs";

// "We have read this" and "we have read a different printing of this" are
// different claims. These pin the second to its own colour and its own
// sentence, because showing it as the first would be a lie about the shelf.
const { t, done } = suite();

const sheets = await import("../../js/data/sheets.js");
const id = await import("../../js/data/identity.js");
const { library } = await import("../../js/data/library.js");
const { readlist } = await import("../../js/data/readlist.js");
const { cardMarkup } = await import("../../js/ui/cards.js");
const { versionNote, versionKind } = await import("../../js/ui/cardactions.js");

// The real cell, verbatim from the sheet: a header with a space before the
// question mark, publishers with dots in them, and lines that carry no language.
const ALCHEMIST_VERSIONS = [
  "9788845269110 · Italian · Bompiani · 2015",
  "9780061122415 · English · HarperOne · 2006",
  "9780007155668 · English · HarperCollins Publishers · 2002",
  "9789755106823 · Turkish · Can Yayınları · 1996",
  "9788845226571 · Italian · Bompiani.",
  "0-439-7856-0 · Scholastic · 2005",
  "B0176M1A44 · Scribner · 2016",
  "132 · English · James Bay · 2009"
].join("\n");

const HEADER = ["Title", "ISBN", "Author", "Genre", "Thumbnail Url", "Read by Who ?", "Other Versions", "Count", "Summary"];
const ROWS = [
  ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "https://img/a.jpg", "Siddhesh", ALCHEMIST_VERSIONS, "8", "A shepherd."],
  ["Ikigai", "9781786330895", "Héctor García", "Non-Fiction", "https://img/i.jpg", "Pratiksha", "None", "0", "A reason to get up."]
];

const load = () => library.reset(sheets.shapeTab("read", HEADER, ROWS.map(r => r.slice())));
load();
const QUEUE_HEADER = ["Title", "ISBN", "Author", "Genre", "Thumbnail Url", "Readlist of Who ?", "Other Versions", "Count", "Summary"];
const loadQueue = (rows) => readlist.reset(sheets.shapeTab("readlist", QUEUE_HEADER, rows || [
  ["Shoe Dog", "9781501135927", "Phil Knight", "Non-Fiction", "https://img/s.jpg", "Dhanashri", "9781471146725 · English · Simon & Schuster · 2018", "1", ""]
]));
loadQueue();

await t("only the ISBN is read off a line, whatever follows it", () => {
  const found = id.parseVersions(ALCHEMIST_VERSIONS);
  assert.ok(found.includes("9788845269110"));
  assert.ok(found.includes("9780061122415"));
  // A malformed ISBN, an Amazon ASIN and a stray number are all not ISBNs.
  assert.ok(!found.some(v => /^(043978560|B0176|132)/.test(v)));
  // Five real ISBNs, including the line whose publisher ends in a full stop.
  assert.ok(found.includes("9788845226571"));
  assert.equal(found.length, 5);
  assert.deepEqual(id.parseVersions("None"), []);
  assert.deepEqual(id.parseVersions(""), []);
});

await t("the exact edition on the shelf is read, and nothing weaker", () => {
  load();
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9780062315007" };
  library.annotate(book);
  assert.equal(book.read, true);
  assert.deepEqual(book.readers, ["Siddhesh"]);
  // A book that IS read must never also be flagged as a version of itself.
  assert.equal(book.version_read, false);
  assert.equal(versionNote(book), "");
});

await t("another printing is flagged as a version, not as read", () => {
  load();
  // O Alquimista: HarperOne 2006, a different ISBN entirely.
  const book = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9780061122415" };
  library.annotate(book);

  assert.equal(book.read, false, "this exact printing is not on the shelf");
  assert.equal(book.version_read, true);
  assert.deepEqual(book.version_readers, ["Siddhesh"]);
  assert.equal(book.version_title, "The Alchemist");
  assert.equal(versionNote(book), "Another edition is read by Siddhesh");
});

await t("a work's whole edition list is enough, whatever ISBN the card shows", () => {
  load();
  // What Open Library's search index actually returns: one arbitrary printing
  // on the cover and every other printing of the work alongside it. The number
  // on the card is a coin flip, so matching only on it found nothing.
  const book = {
    title: "O Alquimista",
    authors: ["Paulo Coelho"],
    isbn13: "9783257237276",
    editionIsbns: ["9783257237276", "9780061122415", "9782290004449"]
  };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, true, "one of its printings is on the shelf");
  assert.equal(book.version_title, "The Alchemist");
});

await t("the shelf's own ISBN counts as a match, not just the versions cell", () => {
  load();
  const book = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9783257237276", editionIsbns: ["9780062315007"] };
  library.annotate(book);
  assert.equal(book.version_read, true, "the exact printing we read is one of its editions");
  assert.deepEqual(book.version_readers, ["Siddhesh"]);
});

await t("findByIsbns looks in a map that actually holds ISBNs", () => {
  load();
  // It asked byKey for "isbn:..." keys, which byKey has never held, so it
  // returned null for every input and the modal's shelf note never appeared.
  assert.equal(library.findByIsbns(["9780062315007"])?.title, "The Alchemist");
  assert.equal(library.findByIsbns(["0062315005"])?.title, "The Alchemist", "the 10-digit form is the same book");
  assert.equal(library.findByIsbns(["9780000000019"]), null);
  assert.equal(readlist.findByIsbns(["9781501135927"])?.title, "Shoe Dog");
});

await t("the versions cell text is read wherever it turns up", () => {
  load();
  // actions.js hands a book its versions as the sheet's own cell text, not a
  // parsed list, so both shapes have to reach the same answer.
  const book = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9783257237276",
    versions: "9780061122415 · English · HarperOne · 2006\nNone" };
  library.annotate(book);
  assert.equal(book.version_read, true);
});

await t("same title, same author, a different number is another printing", () => {
  load();
  // Open Library files one book under several work records, so a printing can
  // be absent from the versions cell and still plainly be an edition of a row
  // we have. This is the case the search for "The Alchemist" is full of.
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9780061122416" };
  library.annotate(book);
  assert.equal(book.read, false, "a different number is never read");
  assert.equal(book.version_read, true);
  assert.equal(book.version_via, "guess");
  assert.deepEqual(book.version_readers, ["Siddhesh"]);
});

await t("a different author with the same title is not an edition of ours", () => {
  load();
  // Ben Jonson's play. The whole reason identity is title AND author.
  const book = { title: "The Alchemist", authors: ["Ben Jonson"], isbn13: "9781408149546" };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, false);
  assert.equal(versionNote(book), "");
});

await t("a work's arbitrary ISBN is not the printing on the shelf", () => {
  load();
  // A search doc names a WORK and carries whichever of its printings sorted
  // first. That is a real number for a real edition, and it is not the one we
  // read - so the card is yellow. Green is reserved for the ISBN on our row.
  const book = {
    title: "The Alchemist",
    authors: ["Paulo Coelho"],
    isbn13: "9783257237276",
    editionIsbns: ["9783257237276", "9782290004449", "9788845269110"]
  };
  library.annotate(book);
  assert.equal(book.read, false, "a different number is a different printing, title or no title");
  assert.equal(book.version_read, true);
  assert.equal(book.version_via, "isbn", "the sheet's own versions cell names one of its editions");
  assert.equal(versionNote(book), "Another edition is read by Siddhesh");
});

await t("a title and author match with a number we have never seen is yellow", () => {
  load();
  // The whole point of this change. A search for a book we have read fills the
  // grid with its other printings, and every one of them used to come back
  // green because the title and the author lined up.
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9780007544790" };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, true);
  assert.equal(book.version_via, "guess", "nothing but the title and author says so");
  assert.equal(versionNote(book), "Probably another edition — same title and author as one Siddhesh read");
});

await t("a record that names no printing of its own still matches on title", () => {
  load();
  // Silence is not disagreement. A row with no ISBN and a record with no ISBN
  // both say nothing, and title and author are all either of them has.
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"] };
  library.annotate(book);
  assert.equal(book.read, true);
  assert.equal(book.version_read, false);
});

await t("a single printing keeps the strict rule", () => {
  load();
  // One ISBN and no edition list is a real printing, and a different number
  // there still means a different book.
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9780061122415" };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, true);
});

await t("a printing filed by hand stops being a guess", () => {
  load();
  // What the "another edition" button writes. Once the number is in the cell,
  // the card stops guessing from the title and says so outright.
  const book = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9780007835393" };
  library.annotate(book);
  assert.equal(book.version_read, false, "an unrelated title with an unknown number matches nothing");

  library.applyVersion({ title: "The Alchemist", author: "Paulo Coelho" }, "9780007835393 · English · HarperCollins · 2018");
  library.annotate(book);
  assert.equal(book.read, false, "filing a printing is not the same as reading it");
  assert.equal(book.version_read, true);
  assert.equal(book.version_via, "isbn");
  assert.equal(library.find({ title: "The Alchemist", author: "Paulo Coelho" }).versions.length, 6);
  load();
});

await t("one typo in an author is still the same author", () => {
  load();
  // Open Library carries "Paulo Coello". A single character should not make a
  // book a stranger - but only for the weaker claim.
  const book = { title: "The Alchemist", authors: ["Paulo Coello"], isbn13: "9780061122416" };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, true);
  assert.equal(book.version_title, "The Alchemist");
});

await t("a leading article is not part of a title", () => {
  // Metamorphosis off the trending feed against "The Metamorphosis" on the
  // sheet. Two spellings of one book: they must reach each other, and a
  // different printing of it is yellow rather than nothing at all.
  loadQueue([["The Metamorphosis", "9780553213690", "Franz Kafka", "Fictional", "", "Pratiksha", "None", "0", ""]]);
  const book = { title: "Metamorphosis", authors: ["Franz Kafka"], isbn13: "9781840226287", editionIsbns: ["9781840226287", "9780199238552"] };
  readlist.annotate(book);
  assert.equal(book.queued, false, "a different number is a different printing");
  assert.equal(book.version_queued, true, "the title still reached the row, article or no article");
  assert.equal(versionNote(book), "Probably another edition — same title and author as one on Pratiksha's readlist");

  const same = { title: "Metamorphosis", authors: ["Franz Kafka"], isbn13: "9780553213690" };
  readlist.annotate(same);
  assert.equal(same.queued, true, "the exact printing, typed the other way round");
  loadQueue();
});

await t("a book listed in nobody's versions is left alone", () => {
  load();
  const book = { title: "Some Other Book", authors: ["Nobody"], isbn13: "9780000000019" };
  library.annotate(book);
  assert.equal(book.read, false);
  assert.equal(book.version_read, false);
  assert.equal(versionNote(book), "");
});

await t("a None cell indexes nothing at all", () => {
  load();
  const entry = library.find({ title: "Ikigai", authors: ["Héctor García"] });
  assert.deepEqual(entry.versions, [], "None is not an ISBN");
});

await t("a printing of a queued book is an edition of it, not the queued row", () => {
  // A work record carrying a number the readlist has never held. Violet means
  // this exact printing is queued; anything else is yellow.
  const book = {
    title: "Shoe Dog",
    authors: ["Phil Knight"],
    isbn13: "9780571338030",
    editionIsbns: ["9780571338030", "9781471146725"]
  };
  readlist.annotate(book);
  assert.equal(book.queued, false);
  assert.equal(book.version_queued, true);
  assert.equal(book.version_queued_for, "Dhanashri");
  assert.equal(versionNote(book), "Another edition is on Dhanashri's readlist");

  const exact = { title: "Shoe Dog", authors: ["Phil Knight"], isbn13: "9781501135927" };
  readlist.annotate(exact);
  assert.equal(exact.queued, true, "the number on the row is the row");
  assert.equal(versionNote(exact), "", "a queued card says Readlist, not Other edition");
});

await t("the readlist flags its own versions, and says whose queue", () => {
  const book = { title: "Shoe Dog", authors: ["Phil Knight"], isbn13: "9781471146725" };
  readlist.annotate(book);
  assert.equal(book.queued, false);
  assert.equal(book.version_queued, true);
  assert.equal(versionNote(book), "Another edition is on Dhanashri's readlist");
});

await t("green for the edition itself, yellow for another printing", () => {
  load();
  const exact = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9780062315007" };
  library.annotate(exact);
  const html = cardMarkup(exact);
  assert.match(html, /class="card is-read"/);
  assert.ok(!html.includes("is-version"));
  assert.ok(!html.includes("card__info"));

  const other = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9780061122415" };
  library.annotate(other);
  const otherHtml = cardMarkup(other);
  assert.match(otherHtml, /class="card is-version"/);
  // Both halves: a label for a pointer, a tappable button for a phone. The
  // stylesheet shows one or the other, never both.
  assert.match(otherHtml, /card__tag--version" data-tip="Another edition is read by Siddhesh"/);
  assert.match(otherHtml, /<button class="card__info" type="button" data-tip="Another edition is read by Siddhesh"/);
  // And a screen reader hears it without needing either.
  assert.match(otherHtml, /aria-label="O Alquimista\. Another edition is read by Siddhesh"/);
});

await t("a printing of a queued book keeps the readlist's colour", () => {
  load();
  loadQueue();
  // Yellow means "we have READ another edition". A book waiting on someone's
  // readlist is a waiting book whichever printing turns up, so it stays violet
  // and the tag says which claim it is making.
  const book = { title: "Shoe Dog", authors: ["Phil Knight"], isbn13: "9781471146725" };
  readlist.annotate(book);
  library.annotate(book);
  assert.equal(book.queued, false);
  assert.equal(book.version_queued, true);
  assert.equal(versionKind(book), "queued");

  const html = cardMarkup(book);
  assert.match(html, /class="card is-queued"/, "the readlist's colour, not the read-edition yellow");
  assert.ok(!html.includes("is-version"));
  assert.match(html, /card__tag--version card__tag--version-queued"[^>]*>Readlist edition</);
  assert.equal(versionNote(book), "Another edition is on Dhanashri's readlist");
});

await t("having read another edition outranks having queued one", () => {
  load();
  // Both are true at once for a book on a shelf AND a queue. Read is the
  // stronger fact about our shelf, so it takes the card.
  loadQueue([["The Alchemist", "9780061122415", "Paulo Coelho", "Fictional", "", "Dhanashri", "None", "0", ""]]);
  const book = { title: "The Alchemist", authors: ["Paulo Coelho"], isbn13: "9788845269110" };
  library.annotate(book);
  readlist.annotate(book);
  assert.equal(book.version_read, true);
  assert.equal(book.version_queued, true);
  assert.equal(versionKind(book), "version");
  assert.match(cardMarkup(book), /class="card is-version"/);
  loadQueue();
});

await t("two readers of one book read as a sentence, not a list", () => {
  library.reset(sheets.shapeTab("read", HEADER, [
    ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "", "Siddhesh", ALCHEMIST_VERSIONS, "8", ""],
    ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "", "Pratiksha", ALCHEMIST_VERSIONS, "8", ""]
  ]));
  const book = { title: "O Alquimista", authors: ["Paulo Coelho"], isbn13: "9788845269110" };
  library.annotate(book);
  assert.equal(versionNote(book), "Another edition is read by Siddhesh and Pratiksha");
  load();
});

done();
