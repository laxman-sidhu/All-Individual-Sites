import assert from "node:assert";
import { suite, stubFetch, calls, READ_HEADER, READ_ROWS } from "./harness.mjs";

// What actually lands in a cell. The failure mode is a row that saves perfectly
// and is simply missing a column, with nothing on screen to notice.
const { t, done } = suite();

const sheets = await import("../../js/data/sheets.js");
const { library } = await import("../../js/data/library.js");
const writer = await import("../../js/data/writer.js");

library.reset(sheets.shapeTab("read", READ_HEADER, READ_ROWS.map(r => r.slice())));

const ok = () => stubFetch(() => ({ body: { ok: true, added: ["Siddhesh"] } }));
const sent = () => calls.post[calls.post.length - 1].body.payload;

await t("marking read fills every column, thumbnail included", async () => {
  ok();
  await writer.markRead({
    title: "The Old Man and the Sea",
    authors: ["Ernest Hemingway"],
    isbn13: "9780684801223",
    cover: "https://covers.openlibrary.org/b/id/8231990-M.jpg",
    year: 1952,
    description: "An old man, a boy, and a marlin."
  }, { readers: ["Siddhesh"], genre: "fictional", summary: "" });

  const payload = sent();
  assert.equal(payload.title, "The Old Man and the Sea");
  assert.equal(payload.author, "Ernest Hemingway");
  assert.equal(payload.isbn, "9780684801223");
  assert.ok(payload.cover, "a blank Thumbnail Url is the bug this exists for");
  assert.equal(payload.cover, "https://covers.openlibrary.org/b/id/8231990-M.jpg");
  assert.equal(payload.year, 1952);
  assert.deepEqual(payload.readers, ["Siddhesh"]);
});

await t("a book with no cover of its own still gets one from its ISBN", async () => {
  ok();
  // Exactly what a trending or subject result looks like: a title, an author,
  // and nothing else the sheet has a column for.
  await writer.markRead(
    { title: "Nothing But Covers", authors: ["A Nobody"], isbn13: "9780062315007" },
    { readers: ["Pratiksha"], genre: "Fictional" }
  );
  const payload = sent();
  assert.match(payload.cover, /covers\.openlibrary\.org\/b\/isbn\/9780062315007-L\.jpg$/);
  // ?default=false is there so an <img> can fall back to a second URL. In a
  // cell it is just a link that 404s.
  assert.ok(!payload.cover.includes("default=false"));
});

await t("the cleaned genre and summary are what get written, not the raw ones", async () => {
  ok();
  await writer.markRead(
    { title: "Case Test", authors: ["Someone"], isbn13: "9780000000019" },
    { readers: ["Dhanashri"], genre: "short   story", summary: "First line.\n\n\n\nSecond line.  " }
  );
  const payload = sent();
  // extra used to be spread last and overwrite both of these with the raw text.
  assert.equal(payload.genre, "Short Story");
  assert.equal(payload.summary, "First line.\n\nSecond line.");
});

await t("a summary keeps its line breaks all the way to the cell", async () => {
  ok();
  await writer.addToReadlist(
    { title: "Queued Book", authors: ["Writer"], cover: "https://img/q.jpg" },
    { genre: "Fantasy", reader: "Dhanashri", summary: "One.\nTwo.\nThree." }
  );
  const payload = sent();
  assert.equal(payload.summary, "One.\nTwo.\nThree.");
  assert.equal(payload.reader, "Dhanashri", "Readlist of Who ? is a real column");
  assert.equal(payload.cover, "https://img/q.jpg");
});

await t("an ISBN-10 is converted before it is written, so it matches later", async () => {
  ok();
  await writer.markRead(
    { title: "Ten Digits", authors: ["Someone"], isbn10: "0062315005" },
    { readers: ["Siddhesh"], genre: "Fictional" }
  );
  assert.equal(sent().isbn, "9780062315007");
});

await t("a book with no title is refused before it reaches the wire", async () => {
  ok();
  const before = calls.post.length;
  await assert.rejects(() => writer.markRead({ title: "" }, { readers: ["Siddhesh"], genre: "X" }));
  assert.equal(calls.post.length, before, "nothing should have been sent");
});

done();
