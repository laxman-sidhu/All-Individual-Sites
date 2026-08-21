import assert from "node:assert";
import { suite, READ_HEADER, READ_ROWS, READLIST_HEADER, READLIST_ROWS } from "./harness.mjs";

const { t, done } = suite();
const sheets = await import("../../js/data/sheets.js");
const { library } = await import("../../js/data/library.js");
const { readlist } = await import("../../js/data/readlist.js");

const load = () => library.reset(sheets.shapeTab("read", READ_HEADER, READ_ROWS.map(r => r.slice())));
load();
readlist.reset(sheets.shapeTab("readlist", READLIST_HEADER, READLIST_ROWS.map(r => r.slice())));

await t("one book read by two people is ONE card with two faces", () => {
  const entry = library.find({ title: "The Alchemist", author: "Paulo Coelho" });
  assert.ok(entry, "The Alchemist should be found");
  assert.deepEqual(entry.readers, ["Siddhesh", "Pratiksha"]);
  assert.equal(entry.rows.length, 2);
  // Ten rows, nine distinct books.
  assert.equal(library.list().length, 9);
  assert.equal(library.stats().rows, 10);
  assert.equal(library.stats().books, 9);
});

await t("a blank field on the first row is filled from a later one", () => {
  const rows = sheets.shapeTab("read", READ_HEADER, [
    ["Ikigai", "", "Héctor García", "", "", "Siddhesh", ""],
    ["Ikigai", "9780143130727", "Héctor García", "Non-Fiction", "https://img/i.jpg", "Pratiksha", "A reason."]
  ]);
  library.reset(rows);
  const entry = library.find({ title: "Ikigai" });
  assert.equal(entry.genre, "Non-Fiction");
  assert.equal(entry.isbn, "9780143130727", "a blank ISBN on the first row fills from the second");
  assert.equal(entry.cover, "https://img/i.jpg");
  assert.equal(entry.summary, "A reason.");
  load();
});

await t("a book is found by ISBN whichever form the sheet holds", () => {
  // The two Alchemist rows carry the 13 and the 10 form of the same ISBN.
  const entry = library.find({ title: "Anything At All", isbn13: "9780062315007" });
  assert.ok(entry, "an ISBN should find the row regardless of the title given");
  assert.equal(entry.title, "The Alchemist");
  assert.deepEqual(entry.readers, ["Siddhesh", "Pratiksha"], "both forms index to one book");
});

await t("a different ISBN is a different book, even under the same title", () => {
  assert.equal(library.find({ title: "The Alchemist", author: "Paulo Coelho", isbn13: "9780722532935" }), null);
});

await t("a row with no ISBN is still found by title and author", () => {
  assert.ok(library.find({ title: "Animals on the Train", author: "Ruskin Bond" }));
});

await t("a summary keeps its line breaks, because they are the writing", () => {
  const rows = sheets.shapeTab("read", READ_HEADER, [
    ["Ikigai", "", "Héctor García", "Non-Fiction", "", "Pratiksha",
      "A reason to live.\n\nA reason to begin again.\n   every single day.  "]
  ]);
  library.reset(rows);
  const summary = library.find({ title: "Ikigai" }).summary;
  assert.ok(summary.includes("\n\n"), "the paragraph break has to survive the read");
  assert.equal(summary.split("\n").length, 4, "three lines and the blank one between them");
  assert.ok(!summary.includes("   "), "runs of spaces inside a line are still collapsed");
  assert.ok(!summary.endsWith(" "));
  load();
});

await t("annotate stamps a card with what the sheet knows", () => {
  const card = { title: "Becoming", authors: ["Michelle Obama"] };
  library.annotate(card);
  assert.equal(card.read, true);
  assert.deepEqual(card.readers, ["Pratiksha"]);
  assert.equal(card.sheet_genre, "Non-Fiction");

  const stranger = { title: "A Book Nobody Read", authors: ["Nobody"] };
  library.annotate(stranger);
  assert.equal(stranger.read, false);
  assert.deepEqual(stranger.readers, []);
});

await t("a queued book is not marked read, and the reverse", () => {
  const dune = { title: "Dune", authors: ["Frank Herbert"] };
  library.annotate(dune);
  readlist.annotate(dune);
  assert.equal(dune.read, false);
  assert.equal(dune.queued, true);
});

await t("readers are counted per person, not per row", () => {
  const counts = new Map(library.readers().map(r => [r.label, r.count]));
  assert.equal(counts.get("Siddhesh"), 4);
  assert.equal(counts.get("Pratiksha"), 4);
  assert.equal(counts.get("Dhanashri"), 2);
});

await t("genres narrow to the reader chosen", () => {
  const all = library.genres().map(g => g.label);
  const dhanu = library.genres("Dhanashri").map(g => g.label);
  assert.ok(all.includes("Fantasy") && all.includes("Non-Fiction"));
  assert.deepEqual(dhanu, ["Fantasy"], "Dhanashri has only fantasy on the shelf");
  assert.ok(!dhanu.includes("Non-Fiction"), "offering a shelf with no rows is offering an empty grid");
});

await t("filtering by reader returns only their books", () => {
  const dhanu = library.list({ reader: "Dhanashri" });
  assert.equal(dhanu.length, 2);
  assert.ok(dhanu.every(entry => entry.readers.includes("Dhanashri")));
});

await t("searching a collection looks at title, author and shelf", () => {
  assert.equal(library.list({ query: "rowling" }).length, 2);
  assert.equal(library.list({ query: "short story" }).length, 2);
  assert.equal(library.list({ query: "héctor" }).length, 1, "an accent typed in must still match");
});

await t("sorting by most read puts the shared book first", () => {
  const sorted = library.list({ sort: "readers" });
  assert.equal(sorted[0].title, "The Alchemist");
});

await t("a re-read by the same person is refused in memory", () => {
  const before = library.stats().rows;
  const added = library.applyAdd({ title: "Becoming", author: "Michelle Obama", reader: "Pratiksha", genre: "Non-Fiction" });
  assert.equal(added, false, "Pratiksha already has this row");
  assert.equal(library.stats().rows, before);
});

await t("a second reader for the same book IS a new row", () => {
  const added = library.applyAdd({ title: "Becoming", author: "Michelle Obama", reader: "Siddhesh", genre: "Non-Fiction" });
  assert.equal(added, true);
  assert.deepEqual(library.find({ title: "Becoming" }).readers, ["Pratiksha", "Siddhesh"]);
  assert.equal(library.stats().books, 9, "still one book");
  load();
});

await t("removing one reader leaves the other's row alone", () => {
  library.applyRemove({ title: "The Alchemist", author: "Paulo Coelho" }, "Siddhesh");
  const entry = library.find({ title: "The Alchemist" });
  assert.deepEqual(entry.readers, ["Pratiksha"]);
  load();
});

await t("removing with no reader takes every row for that book", () => {
  const removed = library.applyRemove({ title: "The Alchemist", author: "Paulo Coelho" });
  assert.equal(removed, 2);
  assert.equal(library.find({ title: "The Alchemist" }), null);
  load();
});

await t("a row with no author stays reachable and collides with nothing", () => {
  const entry = library.find({ title: "Untitled Notebook" });
  assert.ok(entry);
  assert.equal(library.find({ title: "Untitled Notebook", author: "Someone Else" }), entry);
  assert.equal(library.find({ title: "Becoming", author: "Not Michelle" }), null, "a different author is a different book");
});

await t("stats count books once, so the buckets sum to the total", () => {
  const stats = library.stats();
  const fromGenres = stats.genres.reduce((sum, g) => sum + g.count, 0);
  assert.equal(fromGenres, stats.books, "per-shelf counts must not exceed the total");
  assert.equal(stats.shared, 1, "only The Alchemist is read by more than one");
});

await t("the collection search takes the words in any order", () => {
  load();
  // A substring match needed the exact phrase in the exact order, so the way
  // people actually type - author first, or half of each - found nothing.
  assert.equal(library.list({ query: "coelho alchemist" }).length, 1);
  assert.equal(library.list({ query: "alchemist coelho" }).length, 1);
  assert.equal(library.list({ query: "rowling chamber" }).length, 1);
  assert.equal(library.list({ query: "alchemist tolkien" }).length, 0, "every word has to land somewhere");
});

await t("a pasted ISBN finds its book, hyphens and all", () => {
  load();
  const hits = library.list({ query: "978-0-06-231500-7" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "The Alchemist");
  // The 10-digit form of the same book is the same book.
  assert.equal(library.list({ query: "0062315005" }).length, 1);
  assert.equal(library.list({ query: "9780000000000" }).length, 0);
});

await t("a reader's name and a summary are searchable too", () => {
  load();
  assert.ok(library.list({ query: "dhanashri" }).length >= 2, "the faces on a card are searchable");
  assert.equal(library.list({ query: "shepherd" }).length, 1, "the words we wrote ourselves count");
});

done();
