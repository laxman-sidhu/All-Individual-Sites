import assert from "node:assert";
import { suite } from "./harness.mjs";

// The summaries are paragraphs inside one cell, with quotation marks in them, and
// this parser is all that stands between a dead bridge and a dead site.
const { t, done } = suite();
const { parseCSV } = await import("../../js/core/csv.js");
const sheets = await import("../../js/data/sheets.js");

await t("plain rows parse", () => {
  assert.deepEqual(parseCSV("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
});

await t("a quoted field keeps its commas", () => {
  assert.deepEqual(parseCSV('a,"one, two",c'), [["a", "one, two", "c"]]);
});

await t("a newline inside quotes belongs to the cell, not the sheet", () => {
  const rows = parseCSV('Title,Summary\nIkigai,"A reason to live.\n\nA reason to begin again."');
  assert.equal(rows.length, 2, "the blurb must not become three rows");
  assert.equal(rows[1][1], "A reason to live.\n\nA reason to begin again.");
});

await t("doubled quotes are one quote", () => {
  assert.deepEqual(parseCSV('a,"she said ""hello""",c'), [["a", 'she said "hello"', "c"]]);
});

await t("empty cells survive", () => {
  assert.deepEqual(parseCSV("a,,c"), [["a", "", "c"]]);
});

await t("carriage returns from Google do not become stray characters", () => {
  assert.deepEqual(parseCSV("a,b\r\n1,2"), [["a", "b"], ["1", "2"]]);
});

await t("a real published row shapes into a book", () => {
  const csv = 'Title,Author,Genre,Thumbnail Url,Read by Who ?,Summary\n'
    + 'The Alchemist,Paulo Coelho,Fictional,https://i/a.jpg,Siddhesh,'
    + '"A simple shepherd named Santiago lives an ordinary life…\n\nBut the journey is anything but simple."';
  const grid = parseCSV(csv);
  const rows = sheets.shapeTab("read", grid[0], grid.slice(1));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "The Alchemist");
  assert.equal(rows[0].reader, "Siddhesh");
  assert.ok(rows[0].summary.includes("anything but simple"));
});

done();
