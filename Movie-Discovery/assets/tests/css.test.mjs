// The stylesheet has never been seen rendered, so these check the two failure
// modes that have actually shipped bugs in this project. Both are silent: no
// error anywhere, just an element that is invisible or unstyled.

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("FAIL " + name + ": " + e.message); } };

function lastDeclaration(selector) {
  const re = new RegExp("(?<![\\w-])" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
  let body = null, m;
  while ((m = re.exec(bare))) body = (body || "") + m[1];
  return body;
}

// .wash is position:fixed, 760px tall, and its gradient is opaque. A positioned
// element at z-index 0 paints ABOVE non-positioned content, so any page region
// that is not itself ranked gets veiled by it. This is what made the library
// title, counts and view pills invisible.
t("every top-level page region outranks .wash", () => {
  for (const region of [".topbar", ".hero", ".results", ".coll", ".footer"]) {
    const body = lastDeclaration(region);
    assert.ok(body, `${region} has no rule at all`);
    const position = (body.match(/position:\s*(\w+)/) || [])[1];
    const z = (body.match(/z-index:\s*(-?\d+)/) || [])[1];
    assert.ok(["relative", "absolute", "fixed", "sticky"].includes(position),
      `${region} is not positioned, so its z-index would be ignored`);
    assert.ok(z && Number(z) >= 1, `${region} needs z-index >= 1 or .wash paints over it`);
  }
});

t(".wash still is what these rules assume", () => {
  const body = lastDeclaration(".wash");
  assert.match(body, /position:\s*fixed/);
  assert.match(body, /z-index:\s*0/);
});

// Renaming a class in JS without renaming it in CSS produces an unstyled
// element, not an error. That shipped once: the detail modal was ported to
// .detail__* while the stylesheet still carried .castcard / .similar-card.
t("every class the code emits has a rule", () => {
  const defined = new Set([...bare.matchAll(/\.([A-Za-z][\w-]+)/g)].map(m => m[1]));

  const BOOTSTRAP = new Set(["modal", "modal-dialog", "modal-dialog-centered", "modal-xl",
    "modal-dialog-scrollable", "modal-content", "fade", "show", "visually-hidden", "modal-backdrop"]);
  // Hooks that exist for JS and CSS descendant selectors, with no rule of their own.
  const HOOKS = new Set(["is-owner", "no-writes", "page-collection"]);

  const used = new Set();
  const scan = text => {
    for (const m of text.matchAll(/class="([^"$]+)"/g)) m[1].split(/\s+/).forEach(c => used.add(c));
    for (const m of text.matchAll(/class="([\w\- ]+)\$\{/g)) m[1].split(/\s+/).forEach(c => used.add(c));
    for (const m of text.matchAll(/classList\.(?:add|toggle|remove|contains)\("([\w-]+)"/g)) used.add(m[1]);
  };

  for (const f of ["index.html", "watched.html", "watchlist.html"]) scan(fs.readFileSync(path.join(ROOT, f), "utf8"));
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) scan(fs.readFileSync(p, "utf8"));
  });
  walk(path.join(ROOT, "js"));

  const missing = [...used].filter(c =>
    /^[a-z][\w-]*$/.test(c) && !c.endsWith("--") && !defined.has(c) && !BOOTSTRAP.has(c) && !HOOKS.has(c));

  assert.deepEqual(missing, [], "unstyled classes: " + missing.join(", "));
});

// The title sat on top of every poster in the grid. .card__noposter is
// absolute and comes FIRST so the image can cover it - but a positioned element
// paints above a non-positioned one whatever the source order says, so the
// image has to be positioned too. The modal's fallbacks were always built this
// way; the card was the one that was not.
t("an image that covers a fallback is positioned itself", () => {
  for (const [box, image] of [
    [".card__noposter", ".card__poster img"],
    [".detail__similar-alt", ".detail__similar-art img"],
    [".detail__face-ini", ".detail__face img"]
  ]) {
    const behind = lastDeclaration(box);
    const front = lastDeclaration(image);
    assert.ok(behind && front, `${box} or ${image} has no rule`);
    if (!/position:\s*(absolute|relative|fixed|sticky)/.test(behind)) continue;
    assert.match(front, /position:\s*(absolute|relative|fixed|sticky)/,
      `${behind === null ? box : image} would paint UNDER ${box}, showing the title over the artwork`);
  }
});

// The phone dropdown is fixed and lives on <body> for one reason: an ancestor
// with overflow would clip it to nothing, and .topbar__tools has exactly that.
t("the nav dropdown cannot be clipped by the strip it sits in", () => {
  const list = lastDeclaration(".navmenu__list");
  assert.ok(list, ".navmenu__list has no rule at all");
  assert.match(list, /position:\s*fixed/, "absolute inside .topbar__tools is clipped away");
  const z = Number((list.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z > 60, "the topbar sits at 60, so a lower menu paints behind it");
});

// A control may be drawn smaller with a transform, never with a smaller
// font-size: Safari reads the computed font-size when the field takes focus,
// and a transform does not change it. This checks the trick was not "tidied"
// into the thing it exists to avoid.
t("a scaled control still declares 16px", () => {
  for (const m of bare.matchAll(/([^{}]*)\{([^}]*transform:\s*scale[^}]*)\}/g)) {
    const [, selector, body] = m;
    if (!/select|input|textarea/.test(selector)) continue;
    const size = (body.match(/font-size:\s*(\d+(?:\.\d+)?)px/) || [])[1];
    assert.ok(size && Number(size) >= 16,
      `${selector.trim()} is scaled but declares ${size || "no"} font-size - iOS will zoom`);
  }
});

// The two controls sit in one row and have to line up. Both take an explicit
// height from the same token, and the scaled one divides by exactly the scale
// it is drawn at - get that wrong and it is short by the rounding.
t("the sort dropdown and the status buttons share one height", () => {
  const segmented = lastDeclaration(".toolbar__controls .segmented");
  const sort = lastDeclaration(".sortfield select");
  assert.match(segmented, /height:\s*var\(--row-h\)/, "the button row has no fixed height");
  assert.match(sort, /height:/, "the sort control has no fixed height");

  // Where it is scaled, the height must be the pre-scale one or the drawn
  // control comes out short.
  const scaled = css.match(/\.sortfield select \{[^}]*transform:\s*scale\(var\(--sort-scale\)\)[^}]*\}/);
  if (scaled) {
    assert.match(scaled[0], /height:\s*calc\(var\(--row-h\)\s*\/\s*var\(--sort-scale\)\)/,
      "a scaled control must divide its height by the same scale it is drawn at");
    assert.match(scaled[0], /margin-block:\s*calc\(/,
      "the extra layout height has to be given back, or the row grows around it");
  }
});

t("braces balance and no at-rule is left open", () => {
  let depth = 0, i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const j = css.indexOf("*/", i); i = j === -1 ? css.length : j + 2; continue; }
    if (css[i] === "{") depth++;
    else if (css[i] === "}") { depth--; assert.ok(depth >= 0, "extra closing brace"); }
    i++;
  }
  assert.equal(depth, 0, "an unclosed block swallows every rule after it");
});

// iOS zooms on any focused control under 16px and never zooms back out.
// Only the phone blocks count: a 14px desktop base is fine as long as a mobile
// rule lifts it.
function phoneBlocks() {
  const out = [];
  const needle = "@media (max-width: 767px)";
  let at = css.indexOf(needle);
  while (at !== -1) {
    let i = css.indexOf("{", at), depth = 0, start = i;
    while (i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (!depth) break; }
      i++;
    }
    out.push(css.slice(start + 1, i));
    at = css.indexOf(needle, i);
  }
  return out.join("\n");
}

t("every typeable control is 16px on a phone", () => {
  const phone = phoneBlocks();
  assert.ok(phone.length > 0, "no phone block found - the selector may have changed");

  for (const selector of ["gate__input", "gate__select", "facets__select", "collbar__search input",
    "scopepick__select", "sortfield select"]) {
    const re = new RegExp("[^{}]*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "[^{}]*\\{([^}]*)\\}", "g");
    let m;
    while ((m = re.exec(phone))) {
      const size = (m[1].match(/font-size:\s*(\d+(?:\.\d+)?)px/) || [])[1];
      if (size) assert.ok(Number(size) >= 16, `${selector} is ${size}px on mobile - iOS will zoom`);
    }
  }
});


// The band down the right side of a phone screen was the navbar being wider than
// the viewport: the document grew, and every full-width section below was laid
// out against the document rather than the screen.
t("the navbar fits the narrowest phone", () => {
  const phone = css.split("@media (max-width: 600px)").slice(1).join("")
    + css.split("@media (max-width: 380px)").slice(1).join("");

  assert.match(phone, /\.wordmark__text[^{]*\{[^}]*display:\s*none/,
    "the wordmark text has to go; it is ~114px of a budget that has none");

  const btn = [...phone.matchAll(/\.icon-btn \{[^}]*width:\s*(\d+)px/g)].map(m => Number(m[1]));
  assert.ok(btn.length && Math.min(...btn) <= 32,
    "seven buttons at more than 32px will not fit 320px");

  // A future button must scroll the strip, never the page.
  assert.match(phone, /\.topbar__tools \{[^}]*overflow-x:\s*auto/,
    "the icon row needs its own overflow as a last resort");
  assert.match(css, /body \{[^}]*overflow-x:\s*clip/,
    "clip, not hidden - hidden on body stops the sticky topbar sticking");
});

// The cast grid drew a different-sized circle in every column on a phone, and
// clipped the longest names off the right edge of the modal. `1fr` is
// `minmax(auto, 1fr)`, and that auto minimum is the item's MIN-CONTENT width -
// the longest unbreakable word in it. Cast lists are full of them
// ("Brahmanandam", "Balasubramanian"), so any track holding one was floored at
// the width of that word, the rest shared what was left, and the faces - sized
// at width:100% of their track on a phone - inherited the unevenness.
//
// Nothing in a rendered DOM would catch this either: jsdom has no layout
// engine, so the grid resolves correctly in modal.test.mjs and wrongly on a
// phone. It has to be asserted against the stylesheet text.
t("no fixed-count grid of text uses a track with an auto minimum", () => {
  for (const selector of [".detail__people", ".detail__similars"]) {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      + "[^{}]*\\{([^}]*)\\}", "g");
    let m;
    while ((m = re.exec(bare))) {
      const tracks = (m[1].match(/grid-template-columns:\s*([^;]+)/) || [])[1];
      if (!tracks) continue;
      assert.ok(!/repeat\(\s*\d+\s*,\s*1fr\s*\)/.test(tracks),
        `${selector} uses repeat(N, 1fr); the auto minimum is min-content, so one `
        + "long name widens its track and starves the others - use minmax(0, 1fr)");
    }
  }
});

t("cast names may break, or a word wider than its track paints over its neighbour", () => {
  for (const selector of [".detail__person-name", ".detail__person-role"]) {
    const body = lastDeclaration(selector);
    assert.ok(body, `${selector} has no rule at all`);
    assert.match(body, /overflow-wrap:\s*anywhere/,
      `${selector} cannot break, and minmax(0, 1fr) no longer widens the track for it`);
  }
});

// Rule bodies for a selector, with selector LISTS split: ".a, .b { }" is a rule
// for .a as much as for .b, and lastDeclaration above anchors on "selector {"
// so it misses every grouped rule.
function grouped(selector, text = bare) {
  const out = [];
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map(part => part.trim().replace(/\s+/g, " ")).includes(selector)) out.push(m[2]);
  }
  return out;
}

// @media bodies removed, so a phone override is not read as the base rule.
function withoutMedia(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const at = text.indexOf("@media", i);
    if (at === -1) { out += text.slice(i); break; }
    out += text.slice(i, at);
    let j = text.indexOf("{", at), depth = 0;
    while (j < text.length) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (!depth) break; }
      j++;
    }
    i = j + 1;
  }
  return out;
}

function lastValue(selector, property, text) {
  let value = null;
  for (const body of grouped(selector, text)) {
    const m = body.match(new RegExp(property + ":\\s*([^;]+)"));
    if (m) value = m[1].trim();
  }
  return value;
}

// Two rules, each correct alone. .facets__caret pulls up by half its height with
// a negative margin; .facets__wrap .facets__caret then adds translateY(-50%)
// without clearing it, so every chevron sat half a caret above centre. It reads
// as "the dropdowns look a bit off" rather than as a bug, which is why it lasted.
t("the dropdown caret is centred once, not twice", () => {
  const body = grouped(".facets__wrap .facets__caret", withoutMedia(bare)).join("");
  assert.ok(body, ".facets__wrap .facets__caret has no rule");
  if (/transform:\s*translateY\(-50%\)/.test(body)) {
    const margin = lastValue(".facets__wrap .facets__caret", "margin-top", withoutMedia(bare));
    assert.equal(margin && parseFloat(margin), 0,
      "translateY(-50%) and a negative margin-top both centre it, so together they overshoot");
  }
});

// New rules go at the bottom, media queries add no specificity, and the later
// rule wins at equal specificity at EVERY width - so a base rule written at the
// bottom silently reverts the phone tuning written above it.
t("a base rule at the bottom does not revert the phone block above it", () => {
  const phone = bare.split("@media (max-width: 600px)").slice(1).join("\n");
  for (const selector of [".facets--inline .facets__wrap"]) {
    const base = lastValue(selector, "padding-left", withoutMedia(bare));
    const small = lastValue(selector, "padding-left", phone);
    if (base === null || small === null) continue;
    assert.ok(parseFloat(small) < parseFloat(base),
      `${selector} is ${base} everywhere - the phone block above it has been overridden`);
  }
});

// The page is full of glass, each pane running its own backdrop-filter, so a
// dim-only backdrop left the top frosted and the grid below it sharp.
t("the modal backdrop blurs, and covers the viewport", () => {
  const body = grouped(".modal-backdrop", withoutMedia(bare)).join("");
  assert.ok(body, ".modal-backdrop has no rule");
  assert.match(body, /backdrop-filter:\s*blur\(/, "the glass panes blur and the grid does not");
  assert.match(body, /-webkit-backdrop-filter:\s*blur\(/, "Safari needs the prefix");
  assert.ok(!/100vw|100vh/.test(body),
    "100vw counts the scrollbar and 100vh is the large viewport on a phone");
});

// The native option list is drawn by the browser and honours almost nothing, so
// its items sit hard against the left edge with no rule that can move them. The
// replacement has to clear the two things that would make it useless: no padding,
// and a stacking rank that buries it under the dialogs its selects live in.
t("the replacement option list is padded and on top", () => {
  const item = lastDeclaration(".pickmenu__item");
  assert.ok(item, ".pickmenu__item has no rule");
  const pad = item.match(/padding:\s*([\d.]+)px\s+([\d.]+)px/);
  assert.ok(pad && Number(pad[2]) >= 12,
    `option padding is ${pad ? pad[2] + "px" : "unset"} - the native list gave it none`);

  const menu = lastDeclaration(".pickmenu");
  assert.match(menu, /position:\s*fixed/,
    ".panel__body scrolls and .topbar has a backdrop-filter, so anything else is clipped or trapped");
  const z = Number((menu.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z > 1055, `z-index ${z} sits under the modal, burying the mark-watched dialog's own selects`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
