import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

// The stylesheet has never been seen rendered, so these check the silent failures:
// an element unstyled, invisible, or the wrong size, with no error anywhere.
const { t, done } = suite();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?<![\\w-])" + escaped + "\\s*(?:,[^{}]*)?\\{([^}]*)\\}", "g");
  let body = "", match;
  while ((match = re.exec(bare))) body += match[1];
  return body;
}

await t("no block is left unclosed", () => {
  let depth = 0;
  for (const ch of bare) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    assert.ok(depth >= 0, "a stray closing brace ends every rule after it");
  }
  assert.equal(depth, 0, "an unclosed block swallows every rule that follows");
});

await t("every class the code emits has a rule somewhere", () => {
  // Renaming a class in JS without renaming it in CSS produces an unstyled
  // element, not an error.
  const defined = new Set([...bare.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1]));
  const used = new Set();

  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|html)$/.test(entry.name)) files.push(full);
  });
  walk(path.join(ROOT, "js"));
  ["index.html", "library.html", "editions.html", "readlist.html"].forEach(page => files.push(path.join(ROOT, page)));

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/class="([^"${]+)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
    for (const m of text.matchAll(/class="([\w\- ]+)[$]\{/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
    for (const m of text.matchAll(/classList\.(?:add|toggle)\("([\w-]+)"/g)) used.add(m[1]);
  }

  // Hooks that exist for JS or descendant selectors and need no rule of their own.
  const HOOKS = new Set(["page-collection", "hidden"]);
  const missing = [...used].filter(name => !defined.has(name) && !HOOKS.has(name));
  assert.deepEqual(missing, [], `these classes are emitted but never styled: ${missing.join(", ")}`);
});

await t("an image covering a fallback is positioned, or it paints underneath", () => {
  // A positioned element paints above a non-positioned one whatever the source
  // order says, so the title would print over every cover in the grid.
  for (const selector of [".card__cover img", ".detail__cover img", ".face img", ".picker__face img", ".reader__photo img"]) {
    const body = declarations(selector);
    assert.ok(body, `${selector} has no rule at all`);
    assert.match(body, /position:\s*absolute/, `${selector} sits over a fallback and must be positioned`);
  }
  assert.match(declarations(".cover__fallback"), /position:\s*absolute/);
});

await t("no fixed-count grid of text uses a track with an auto minimum", () => {
  // repeat(N, 1fr) is repeat(N, minmax(auto, 1fr)), and that auto minimum is the
  // longest unbreakable word, so one long name starves every other track.
  for (const match of bare.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
    assert.ok(!/repeat\(\s*\d+\s*,\s*1fr\s*\)/.test(match[1]),
      `"${match[1].trim()}" needs minmax(0, 1fr), or one long word sets the column width`);
  }
});

await t("text that can run long is allowed to break", () => {
  for (const selector of [".card__title", ".card__facts", ".detail__title", ".stat__value", ".cover__fallback"]) {
    assert.match(declarations(selector), /overflow-wrap:\s*anywhere/,
      `${selector} can hold a word wider than its column and would overflow instead of wrapping`);
  }
});

await t("the two state colours are declared once and never reused for decoration", () => {
  const root = declarations(":root");
  assert.match(root, /--read:/);
  assert.match(root, /--queued:/);
  // Green means read and gold means queued, so the filled controls must say so.
  assert.match(declarations('.cardact[data-act="read"].is-on'), /var\(--read\)/);
  assert.match(declarations('.cardact[data-act="readlist"].is-on'), /var\(--queued\)/);
});

await t("no typeable control drops under 16px on a phone", () => {
  // iOS zooms on any focused control below it and never zooms back out.
  const phone = css.split(/@media \(max-width: (?:720|480)px\)/).slice(1).join("\n");
  assert.ok(phone.length, "the phone blocks moved; this test needs updating");
  for (const match of phone.matchAll(/([^{}]*(?:input|select|textarea|\.field)[^{}]*)\{([^}]*)\}/g)) {
    const size = (match[2].match(/font-size:\s*(\d+(?:\.\d+)?)px/) || [])[1];
    if (size) assert.ok(Number(size) >= 16, `${match[1].trim()} is ${size}px on mobile — iOS will zoom`);
  }
});

await t("the card grid never collapses below two columns", () => {
  const narrow = css.split("@media (max-width: 480px)").slice(1).join("");
  assert.match(narrow, /\.grid \{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    "a one-column grid of book covers on a phone is a very long page");
});

await t("a row that scrolls sideways is not also allowed to wrap", () => {
  // flex-wrap and overflow-x: auto together means it wraps and never scrolls,
  // which on a phone is a block of pills where a single line was intended.
  for (const [name, body] of [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]])) {
    if (!/overflow-x:\s*auto/.test(body)) continue;
    if (!/flex-wrap/.test(body)) continue;
    assert.match(body, /flex-wrap:\s*nowrap/, `${name} scrolls sideways, so it must not wrap`);
  }
});

await t("the navbar has something that can give", () => {
  // Six controls and a name on a 360px screen. If nothing in the row may
  // shrink, the bar runs past the viewport and every page below it looks
  // knocked out of line - the sticky background ends where the screen does and
  // the content does not.
  const wordmark = declarations(".wordmark");
  assert.match(wordmark, /min-width:\s*0/, "the name is the only part with no hit area to protect");
  assert.match(declarations(".wordmark__text"), /text-overflow:\s*ellipsis/);
  assert.ok(!/flex-shrink:\s*0/.test(wordmark), "a wordmark that refuses to shrink is what overflowed the bar");
});

await t("body uses overflow-x: clip, not hidden", () => {
  // hidden on body makes it a scroll container and the sticky topbar stops sticking.
  assert.match(declarations("body"), /overflow-x:\s*clip/);
});

await t("reduced motion is respected", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

await t("focus stays visible", () => {
  assert.match(bare, /:focus-visible\s*\{[^}]*outline:/);
});

await t("hidden actually hides", () => {
  // [hidden] is a UA rule and any author display rule outranks it. Every panel
  // in this file sets display, so without this a closed drawer renders open.
  assert.match(bare, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    "a display rule beats [hidden] unless this exists");
});

done();
