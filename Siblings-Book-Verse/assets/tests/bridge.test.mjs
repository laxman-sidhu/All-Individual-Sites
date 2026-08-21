import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

// Code.gs and the browser hold the same rules twice on purpose, and drift is
// silent: the bridge writes to a row the site can no longer find.
const { t, done } = suite();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = fs.readFileSync(path.join(ROOT, "assets/apps_script/Code.gs"), "utf8");

const util = await import("../../js/core/util.js");
const sheets = await import("../../js/data/sheets.js");
const id = await import("../../js/data/identity.js");

// Apps Script is plain ES5 here, so the file can simply be evaluated.
const gs = new Function(source + "\n; return { normaliseTitle, filingTitle, normaliseAuthorText, normaliseHeader, COLUMN_ALIASES, READ_SHEET, READLIST_SHEET, SECRET };")();

await t("Code.gs parses at all", () => {
  assert.ok(typeof gs.normaliseTitle === "function");
});

await t("both sides normalise a title identically", () => {
  const cases = ["The Alchemist", "  The   Alchemist!  ", "Héctor García", "अलवणी", "こころ",
    "Harry Potter and the Sorcerer's Stone", "Men Are from Mars, Women Are from Venus", ""];
  cases.forEach(text => {
    assert.equal(gs.normaliseTitle(text), util.normaliseText(text), JSON.stringify(text));
  });
});

await t("both sides file a title identically, articles and all", () => {
  // The drift this suite exists for. If one side shelves "The Metamorphosis"
  // under M and the other under T, the site finds a row the bridge cannot, and
  // a write fails with nothing on screen to explain it.
  ["The Metamorphosis", "Metamorphosis", "A Game of Thrones", "An Ideal Husband",
   "The Alchemist", "Theodore Boone", "Animals on the Train", "अलवणी", "  the  hunger   games "]
    .forEach(text => assert.equal(gs.filingTitle(text), id.filingTitle(text), JSON.stringify(text)));
  // And an author is NOT filed: stripping a leading article off a name would
  // turn A. A. Milne into A. Milne on both sides at once.
  assert.equal(gs.normaliseAuthorText("A. A. Milne"), util.normaliseAuthor("A. A. Milne"));
  assert.equal(util.normaliseAuthor("A. A. Milne"), "aamilne");
});

await t("both sides normalise an author identically", () => {
  ["J.K. Rowling", "JK Rowling", "J. K. Rowling", "Héctor García & Francesc Miralles", "Guy de Maupassant"]
    .forEach(text => assert.equal(gs.normaliseAuthorText(text), util.normaliseAuthor(text), text));
});

await t("both sides normalise a header identically", () => {
  ["Read by Who ?", "  READ BY WHO ? ", "Title", ""]
    .forEach(text => assert.equal(gs.normaliseHeader(text), util.normaliseHeader(text), JSON.stringify(text)));
});

await t("every field the site maps is a field the bridge can write", () => {
  for (const field of Object.keys(sheets.READ_ALIASES)) {
    assert.ok(gs.COLUMN_ALIASES[field], `Code.gs has no aliases for "${field}"`);
  }
});

await t("every header the site accepts, the bridge accepts too", () => {
  for (const [field, spellings] of Object.entries(sheets.READ_ALIASES)) {
    const theirs = gs.COLUMN_ALIASES[field] || [];
    for (const spelling of spellings) {
      assert.ok(theirs.includes(spelling),
        `"${spelling}" maps to ${field} in the browser but not in Code.gs, so a rename would break writes only`);
    }
  }
});

await t("the readlist's own spellings are covered as well", () => {
  for (const [field, spellings] of Object.entries(sheets.READLIST_ALIASES)) {
    const theirs = gs.COLUMN_ALIASES[field] || [];
    for (const spelling of spellings) {
      assert.ok(theirs.includes(spelling), `"${spelling}" -> ${field} is missing from Code.gs`);
    }
  }
});

await t("the tab names match the ones config.js reads", async () => {
  const config = await import("../../js/config.js");
  assert.equal(gs.READ_SHEET, config.READ_TAB);
  assert.equal(gs.READLIST_SHEET, config.READLIST_TAB);
});

await t("Code.gs SECRET and config APPS_SCRIPT_TOKEN are the same string", async () => {
  // A mismatch is every write returning "Not authorised", and easy to create
  // by editing only one of the two files.
  const config = await import("../../js/config.js");
  assert.equal(gs.SECRET, config.APPS_SCRIPT_TOKEN);
  assert.ok(gs.SECRET.length >= 16, "a short secret is worth less than no secret");
  assert.notEqual(gs.SECRET, "change-me-to-a-long-random-string", "still the shipped placeholder");
});

await t("every action the writer sends is an action the bridge handles", () => {
  const writer = fs.readFileSync(path.join(ROOT, "js/data/writer.js"), "utf8");
  const sent = [...writer.matchAll(/call\("([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(sent.length >= 4, "expected the four write paths");
  sent.forEach(action => {
    assert.ok(new RegExp(`\\b${action}:\\s*\\w+`).test(source), `Code.gs has no handler for "${action}"`);
  });
});

await t("writes go out as text/plain, the one carrier with no CORS preflight", () => {
  const http = fs.readFileSync(path.join(ROOT, "js/core/http.js"), "utf8");
  assert.match(http, /"Content-Type":\s*"text\/plain/);
  assert.ok(!/application\/json/.test(http), "application/json triggers a preflight Apps Script cannot answer");
});

done();
