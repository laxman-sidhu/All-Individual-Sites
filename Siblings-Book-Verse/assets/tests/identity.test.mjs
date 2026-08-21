import assert from "node:assert";
import { suite } from "./harness.mjs";

const { t, done } = suite();

const util = await import("../../js/core/util.js");
const id = await import("../../js/data/identity.js");

await t("normalisation is unicode-aware, not \\w", () => {
  // \w is ASCII-only, so this whole title would become the empty string and the
  // row would stop being indexable at all.
  assert.equal(util.normaliseText("अलवणी"), "अलवणी");
  assert.equal(util.normaliseText("こころ"), "こころ");
  assert.equal(util.normaliseText("Héctor García"), "hector garcia");
  assert.equal(util.normaliseText("  The   Alchemist!  "), "the alchemist");
});

await t("author keys drop spaces, so J.K. and JK are one person", () => {
  assert.equal(util.normaliseAuthor("J.K. Rowling"), util.normaliseAuthor("JK Rowling"));
  assert.equal(util.normaliseAuthor("J. K. Rowling"), "jkrowling");
});

await t("a title and an author together are the identity", () => {
  const a = { title: "The Alchemist", author: "Paulo Coelho" };
  const b = { title: "the alchemist", authors: ["Paulo Coelho"] };
  assert.equal(id.keyOf(a), id.keyOf(b));
  assert.ok(id.sameBook(a, b));
});

await t("the same title by a different author is a different book", () => {
  const coelho = { title: "The Alchemist", author: "Paulo Coelho" };
  const jonson = { title: "The Alchemist", author: "Ben Jonson" };
  assert.notEqual(id.keyOf(coelho), id.keyOf(jonson));
  assert.ok(!id.sameBook(coelho, jonson));
});

await t("a row with no author still answers to its bare title", () => {
  const bare = { title: "Untitled Notebook", author: "" };
  const named = { title: "Untitled Notebook", author: "Someone" };
  assert.ok(id.sameBook(bare, named), "a blank author says nothing, so it matches either way");
  assert.equal(id.keyOf(bare), "untitled notebook|");
});

await t("an ISBN-10 and its ISBN-13 are the same book", () => {
  // The sheet may hold either form. Without the conversion, a row typed in as
  // 0062315005 would never match a search result carrying 9780062315007.
  assert.equal(id.normaliseIsbn("0062315005"), "9780062315007");
  assert.equal(id.normaliseIsbn("978-0-06-231500-7"), "9780062315007");
  assert.equal(id.normaliseIsbn("0 7475 3274 5"), "9780747532743");
  assert.ok(id.sameBook({ title: "x", isbn: "0062315005" }, { title: "y", isbn13: "9780062315007" }));
});

await t("an ISBN settles it in BOTH directions", () => {
  // Equal is the same book whatever the titles say; unequal is a different book
  // whatever the titles say. Two editions with different ISBNs are two rows.
  assert.ok(!id.sameBook({ title: "The Alchemist", author: "Paulo Coelho", isbn: "9780062315007" },
                         { title: "The Alchemist", author: "Paulo Coelho", isbn: "9780722532935" }));
});

await t("an ISBN on one side only falls back to title and author", () => {
  assert.ok(id.sameBook({ title: "The Alchemist", author: "Paulo Coelho", isbn: "9780062315007" },
                        { title: "The Alchemist", author: "Paulo Coelho" }));
});

await t("nonsense in the ISBN cell is treated as no ISBN", () => {
  assert.equal(id.normaliseIsbn("n/a"), "");
  assert.equal(id.normaliseIsbn("12345"), "");
  assert.ok(id.sameBook({ title: "Alavani", author: "Ranjit Desai", isbn: "n/a" },
                        { title: "Alavani", author: "Ranjit Desai" }));
});

await t("an id matches only when both sides have one", () => {
  assert.ok(id.sameBook({ title: "A", book_id: "gb:xyz" }, { title: "B", book_id: "gb:xyz" }));
  assert.ok(!id.sameBook({ title: "A", book_id: "gb:xyz" }, { title: "B" }));
});

await t("authors arrive as a list, a string, or an ampersand pair", () => {
  assert.deepEqual(id.authorList({ authors: ["A", "B"] }), ["A", "B"]);
  assert.deepEqual(id.authorList({ author: "Héctor García & Francesc Miralles" }), ["Héctor García", "Francesc Miralles"]);
  assert.deepEqual(id.authorList({ author: "A, B" }), ["A", "B"]);
  assert.equal(id.firstAuthor({ author: "Ruskin Bond" }), "Ruskin Bond");
});

await t("truthy reads every way a spreadsheet says yes", () => {
  ["Yes", "yes", "TRUE", "1", "x", "✓"].forEach(value => assert.ok(util.truthy(value), value));
  ["", "no", "0", "  "].forEach(value => assert.ok(!util.truthy(value), JSON.stringify(value)));
});

await t("html is stripped, because one source sends it and the other does not", () => {
  assert.equal(util.stripHtml("<p>A <b>shepherd</b>.</p>"), "A shepherd.");
  assert.equal(util.stripHtml("plain text"), "plain text");
});

await t("a year is found inside whatever date shape arrives", () => {
  assert.equal(util.yearOf("1997"), 1997);
  assert.equal(util.yearOf("1997-06-26"), 1997);
  assert.equal(util.yearOf("June 2018"), 2018);
  assert.equal(util.yearOf(""), null);
});

await t("both forms of one ISBN are produced, and only when they exist", () => {
  // Google indexes some editions under the 10 and some under the 13. An ISBN
  // lookup that asks for only one form misses half the catalogue.
  assert.deepEqual(id.isbnForms("978-0-06-231500-7"), ["9780062315007", "0062315005"]);
  assert.deepEqual(id.isbnForms("0062315005"), ["9780062315007", "0062315005"]);
  assert.equal(id.toIsbn10("9780062315007"), "0062315005");
  // A 979 never had a 10-digit form at all, so inventing one would be a lie.
  assert.equal(id.toIsbn10("9791234567896"), "");
  assert.deepEqual(id.isbnForms("not an isbn"), []);
});

await t("a book is only accepted as an answer if it carries the ISBN asked for", () => {
  // The whole ISBN bug in one assertion: a different number is a different
  // book, however well the title lines up.
  assert.ok(id.carriesIsbn({ isbn13: "9780062315007" }, "9780062315007"));
  assert.ok(id.carriesIsbn({ isbn10: "0062315005" }, "9780062315007"), "the two forms are one book");
  assert.ok(!id.carriesIsbn({ isbn13: "9788845269110" }, "9780062315007"), "two editions are two books");
  assert.ok(!id.carriesIsbn({ title: "The Alchemist" }, "9780062315007"));
});

done();
