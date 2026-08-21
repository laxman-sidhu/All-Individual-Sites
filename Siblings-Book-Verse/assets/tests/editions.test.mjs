import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

// The Other Versions cell READ back out: one line per printing, and the same
// format whether OtherVersions.gs wrote it, the site wrote it, or a person did.
const { t, done } = suite();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sheets = await import("../../js/data/sheets.js");
const { library } = await import("../../js/data/library.js");
const { parseEditionLine, parseEditionLines, editionLine, editionGroups, matchesEdition } = await import("../../js/data/editions.js");
const { editionLines } = await import("../../js/books/discover.js");
const { cardBar } = await import("../../js/ui/cardactions.js");

const CELL = [
  "9781869409258 · English · Auckland University Press · 2021",
  "9789671897614 · MAY · Biblio Press · 2021",
  "9788845226571 · Italian · Bompiani.",
  "9780007835393 · FSC + HarperCollins",
  "9788982814471 · Korean · 2001"
].join("\n");

const HEADER = ["Title", "ISBN", "Author", "Genre", "Thumbnail Url", "Read by Who ?", "Other Versions", "Count", "Summary"];
const ROWS = [
  ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "", "Siddhesh", CELL, "5", "A shepherd."],
  ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "", "Pratiksha", CELL, "5", "A shepherd."],
  ["Ikigai", "9781786330895", "Héctor García", "Non-Fiction", "", "Pratiksha", "None", "0", "A reason."]
];
const load = () => library.reset(sheets.shapeTab("read", HEADER, ROWS.map(r => r.slice())));
load();

await t("a line is an ISBN and then whatever a human wrote", () => {
  const full = parseEditionLine("9781869409258 · English · Auckland University Press · 2021");
  assert.deepEqual(full, {
    isbn: "9781869409258", language: "English", publisher: "Auckland University Press", year: 2021,
    line: "9781869409258 · English · Auckland University Press · 2021"
  });
});

await t("the optional halves are actually optional", () => {
  // Every one of these is on the real sheet.
  assert.equal(parseEditionLine("9788845226571 · Italian · Bompiani.").year, null);
  assert.equal(parseEditionLine("9788982814471 · Korean · 2001").publisher, "");
  assert.equal(parseEditionLine("9780007835393 · FSC + HarperCollins").language, "");
  assert.equal(parseEditionLine("9780007835393 · FSC + HarperCollins").publisher, "FSC + HarperCollins");
  // A language OtherVersions.gs could not name is left as its bare code.
  assert.equal(parseEditionLine("9789671897614 · MAY · Biblio Press · 2021").language, "MAY");
  // A publisher with a dot in the middle is not two fields.
  assert.equal(parseEditionLine("9788408080664 · Editorial Planeta, S.A. · 2008").publisher, "Editorial Planeta, S.A.");
});

await t("anything that is not an ISBN is not a line", () => {
  assert.equal(parseEditionLine("None"), null);
  assert.equal(parseEditionLine(""), null);
  assert.equal(parseEditionLine("B0176M1A44 · Scribner · 2016"), null, "an Amazon ASIN is not an ISBN");
  assert.equal(parseEditionLine("132 · English · James Bay · 2009"), null);
});

await t("a cell parses to whole lines, deduplicated, in the order written", () => {
  const found = parseEditionLines(`${CELL}\n9781869409258 · English · Auckland University Press · 2021`);
  assert.equal(found.length, 5, "the repeat and the None are both dropped");
  assert.equal(found[0].isbn, "9781869409258");
  assert.deepEqual(parseEditionLines("None"), []);
});

await t("a ten-digit number is filed as the thirteen it also is", () => {
  // Or the same printing sits in the cell twice under two spellings.
  assert.equal(parseEditionLine("0062315005 · English · HarperOne").isbn, "9780062315007");
});

await t("what the site writes is what the site reads back", () => {
  const line = editionLine({ isbn: "9780007835393", language: "English", publisher: "HarperCollins", year: 2018 });
  assert.equal(line, "9780007835393 · English · HarperCollins · 2018");
  assert.deepEqual(parseEditionLine(line), { isbn: "9780007835393", language: "English", publisher: "HarperCollins", year: 2018, line });
  assert.equal(editionLine({ isbn: "" }), "", "no ISBN, no line");
});

await t("the lookup path writes that same format", () => {
  // js/books/discover.js fills the cell after a book is marked read, and
  // OtherVersions.gs fills it in bulk. A parser that only understood one of
  // them would empty half the page.
  const text = editionLines([
    { isbn13: "9780061122415", language: "English", publisher: "HarperOne", year: 2006 },
    { isbn13: "9780062315007", isMine: true, publisher: "HarperOne" }
  ]);
  assert.equal(text, "9780061122415 · English · HarperOne · 2006");
  assert.equal(parseEditionLines(text).length, 1);
});

await t("Code.gs reads a line exactly the way the browser does", () => {
  const source = fs.readFileSync(path.join(ROOT, "assets/apps_script/Code.gs"), "utf8");
  const gs = new Function(source + "\n; return { versionLines, listsIsbn };")();

  assert.deepEqual(gs.versionLines("None"), [], "None means the lookup ran and found nothing");
  assert.equal(gs.versionLines(CELL).length, parseEditionLines(CELL).length, "both sides count the same printings");
  for (const edition of parseEditionLines(CELL)) {
    assert.ok(gs.listsIsbn(gs.versionLines(CELL), edition.isbn), `${edition.isbn} is in the cell either way`);
  }
  assert.ok(gs.listsIsbn(["0062315005 · English · HarperOne"], "9780062315007"), "both forms compare as thirteen");
  assert.ok(!gs.listsIsbn(gs.versionLines(CELL), "9780007525492"));
});

await t("the page groups by book and leaves out the ones with none", () => {
  load();
  const groups = editionGroups(library.list({ sort: "title" }));
  assert.equal(groups.length, 1, "Ikigai has a None cell and no group");
  assert.equal(groups[0].entry.title, "The Alchemist");
  assert.equal(groups[0].editions.length, 5);
});

await t("the search box looks inside a line, not just at the number", () => {
  const edition = parseEditionLine("9781869409258 · English · Auckland University Press · 2021");
  assert.ok(matchesEdition(edition, ["auckland"]));
  assert.ok(matchesEdition(edition, ["english", "2021"]));
  assert.ok(matchesEdition(edition, []), "an empty search hides nothing");
  assert.ok(!matchesEdition(edition, ["penguin"]));
});

await t("filing a printing lands on every row for that book", () => {
  load();
  const line = "9780062511409 · Spanish · HarperSanFrancisco · 1994";
  assert.equal(library.applyVersion({ title: "The Alchemist", author: "Paulo Coelho" }, line), 2, "two readers, two rows");

  const entry = library.find({ title: "The Alchemist", author: "Paulo Coelho" });
  assert.equal(entry.versions.length, 6);
  assert.ok(entry.versionText.endsWith(line));
  entry.rows.forEach(row => assert.equal(row.version_count, "6", "the Count column moves with the cell"));
  assert.equal(library.applyVersion({ title: "Nothing We Have" }, line), 0, "no row, nothing written");
  load();
});

await t("the button is offered where filing would mean something", () => {
  const stranger = cardBar({ title: "x" });
  assert.ok(stranger.includes('data-act="version"'), "a book we have never seen may still be an edition of one we have");

  const guessed = cardBar({ title: "x", version_read: true, version_via: "guess" });
  assert.ok(guessed.includes('data-act="version"'), "a guess is exactly what wants confirming");

  const known = cardBar({ title: "x", version_read: true, version_via: "isbn" });
  assert.ok(!known.includes('data-act="version"'), "already in the cell");

  assert.ok(!cardBar({ title: "x", read: true }).includes('data-act="version"'));
  assert.ok(!cardBar({ title: "x", queued: true }).includes('data-act="version"'));
});

done();
