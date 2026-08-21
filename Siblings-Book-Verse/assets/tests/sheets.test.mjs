import assert from "node:assert";
import { suite, READ_HEADER, READ_ROWS, READLIST_HEADER, READLIST_ROWS } from "./harness.mjs";

const { t, done } = suite();
const sheets = await import("../../js/data/sheets.js");

const read = (header, rows) => sheets.shapeTab("read", header, rows);

await t("the real header maps, question mark and stray space included", () => {
  const rows = read(READ_HEADER, READ_ROWS);
  assert.equal(rows[0].title, "The Alchemist");
  assert.equal(rows[0].author, "Paulo Coelho");
  assert.equal(rows[0].reader, "Siddhesh", '"Read by Who ?" has to reach the reader field');
  assert.equal(rows[0].cover, "https://img/alchemist.jpg", '"Thumbnail Url" has to reach the cover field');
  assert.equal(rows[0].isbn, "9780062315007");
  assert.equal(rows.length, READ_ROWS.length);
});

await t("the reader column answers to every spelling of itself", () => {
  for (const spelling of ["Read by Who ?", "Read by Who?", "read by who", "Reader", "Read By", "READ BY WHO ?"]) {
    const rows = read([spelling, "Title"], [["Siddhesh", "A Book"]]);
    assert.equal(rows[0].reader, "Siddhesh", spelling);
  }
});

await t("columns can be reordered freely", () => {
  const rows = read(
    ["Summary", "Read by Who ?", "Title", "ISBN", "Genre", "Author", "Thumbnail Url"],
    [["A shepherd.", "Pratiksha", "The Alchemist", "0062315005", "Fictional", "Paulo Coelho", "u"]]
  );
  assert.equal(rows[0].isbn, "0062315005");
  assert.equal(rows[0].title, "The Alchemist");
  assert.equal(rows[0].reader, "Pratiksha");
  assert.equal(rows[0].summary, "A shepherd.");
  assert.equal(rows[0].genre, "Fictional");
});

await t("an unnamed spacer column is ignored, not misread", () => {
  const rows = read(["Title", "", "Author", "Read by Who ?"], [["Ikigai", "junk", "Héctor García", "Pratiksha"]]);
  assert.equal(rows[0].author, "Héctor García");
  assert.equal(rows[0].reader, "Pratiksha");
});

await t("two columns naming one field: the first wins, as Code.gs does", () => {
  // A half-done rename. If the two sides disagree about which cell is the
  // title, the site reads one and the bridge writes the other, silently.
  const rows = read(["Title", "Author", "Read by Who ?", "Book"], [["The Necklace", "Guy de Maupassant", "Siddhesh", "STALE"]]);
  assert.equal(rows[0].title, "The Necklace");
});

await t("a row with no title is not a book", () => {
  const rows = read(["Title", "Author"], [["", "Nobody"], ["Real", "Someone"]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Real");
});

await t("every field exists on every row, blank rather than missing", () => {
  const rows = read(["Title"], [["Just a title"]]);
  ["title", "isbn", "author", "genre", "cover", "reader", "summary"].forEach(field => {
    assert.ok(field in rows[0], `${field} should exist`);
  });
  assert.equal(rows[0].author, "");
});

await t("the readlist has no reader column and does not invent one", () => {
  const rows = sheets.shapeTab("readlist", READLIST_HEADER, READLIST_ROWS);
  assert.equal(rows[0].title, "Dune");
  assert.equal(rows[0].reader, "Dhanashri", '"Readlist of Who ?" has to reach the reader field');
});

await t("a readlist with no owner column simply has no owner", () => {
  const rows = sheets.shapeTab("readlist", ["Title", "Author"], [["Dune", "Frank Herbert"]]);
  assert.equal(rows[0].reader, "", "a missing column is a blank, not a guess");
});

await t("an ISBN column answers to its usual spellings", () => {
  for (const spelling of ["ISBN", "isbn", "ISBN-13", "isbn 13"]) {
    const rows = read([spelling, "Title"], [["9780062315007", "A Book"]]);
    assert.equal(rows[0].isbn, "9780062315007", spelling);
  }
});

await t("the readlist accepts Added By where the read tab wants Read by Who", () => {
  const rows = sheets.shapeTab("readlist", ["Title", "Added By"], [["Dune", "Dhanashri"]]);
  assert.equal(rows[0].reader, "Dhanashri");
});

await t("cells are trimmed, because a spreadsheet is typed into by hand", () => {
  const rows = read(["Title", "Read by Who ?"], [["  Ikigai  ", " Pratiksha "]]);
  assert.equal(rows[0].title, "Ikigai");
  assert.equal(rows[0].reader, "Pratiksha");
});

await t("mapColumns claims one column per field and one field per column", () => {
  const map = sheets.mapColumns(READ_HEADER, sheets.READ_ALIASES);
  const fields = Object.values(map);
  assert.equal(fields.length, new Set(fields).size, "a field was claimed twice");
  assert.equal(map[0], "title");
  assert.equal(map[1], "isbn");
  assert.equal(map[4], "cover");
  assert.equal(map[5], "reader");
});

done();
