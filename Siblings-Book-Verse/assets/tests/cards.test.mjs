import assert from "node:assert";
import { suite } from "./harness.mjs";

const { t, done } = suite();

// The action bar is hidden unless writes are configured, so the shapes below
// are asserted against the read-only build too.
const cards = await import("../../js/ui/cards.js");
const bar = await import("../../js/ui/cardactions.js");

const book = extra => ({ id: "gb:1", title: "The Alchemist", authors: ["Paulo Coelho"], year: 1988, genres: ["Fictional"], cover: "https://img/a.jpg", ...extra });

await t("the fallback is rendered BEHIND the image, not instead of it", () => {
  const html = cards.cover(book());
  const fallbackAt = html.indexOf("cover__fallback");
  const imgAt = html.indexOf("<img");
  assert.ok(fallbackAt !== -1 && imgAt !== -1);
  assert.ok(fallbackAt < imgAt, "the fallback must come first so the image covers it");
  assert.ok(html.includes("The Alchemist"), "the fallback names the book, not a generic graphic");
});

await t("no cover means the title, never a placeholder graphic", () => {
  const html = cards.cover(book({ cover: "", coverAlt: "" }));
  assert.ok(!html.includes("<img"), "an <img> with no URL draws a broken icon");
  assert.ok(html.includes("The Alchemist"));
});

await t("a second cover source rides along as data, not as a second <img>", () => {
  const html = cards.cover(book({ coverAlt: "https://covers.openlibrary.org/b/isbn/9-L.jpg" }));
  assert.equal((html.match(/<img/g) || []).length, 1);
  assert.ok(html.includes("data-fallback-src="));
});

await t("markup is escaped, because a title is other people's data", () => {
  const html = cards.cardMarkup(book({ title: 'Ampersands & "quotes" <script>' }));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&amp;") && html.includes("&quot;"));
});

await t("readers become faces, and a face falls back to initials", () => {
  const html = cards.faces(["Siddhesh", "Pratiksha"]);
  assert.equal((html.match(/class="face"/g) || []).length, 2);
  assert.ok(html.includes('<span class="face__ini">S</span>'), "initials sit behind the photo");
  assert.ok(html.includes("sidhu.jpeg"), "a known reader gets their own photograph");
  assert.ok(html.includes('aria-label="Read by Siddhesh, Pratiksha"'));
});

await t("an unknown reader still gets a face, just without a photo", () => {
  const html = cards.faces(["Someone New"]);
  assert.ok(html.includes("SN"));
  assert.ok(!html.includes("<img"), "no photo means no broken image");
});

await t("more than four readers collapses rather than overflowing", () => {
  const html = cards.faces(["A B", "C D", "E F", "G H", "I J", "K L"]);
  assert.equal((html.match(/class="face"/g) || []).length, 4);
  assert.ok(html.includes("+2"));
});

await t("a read book gets a Read tag and its readers; an unread one gets neither", () => {
  const read = cards.cardMarkup(book({ read: true, readers: ["Dhanashri"] }));
  assert.ok(read.includes("card__tag--read"));
  assert.ok(read.includes("card__faces"));
  assert.ok(read.includes("is-read"));

  const unread = cards.cardMarkup(book());
  assert.ok(!unread.includes("card__tag--read"));
  assert.ok(!unread.includes("card__faces"));
});

await t("a queued book is tagged gold and a read one never is", () => {
  assert.ok(cards.cardMarkup(book({ queued: true })).includes("card__tag--queued"));
  assert.ok(!cards.cardMarkup(book({ read: true, readers: ["A"] })).includes("card__tag--queued"));
});

await t("the action bar follows what the sheet can record", () => {
  // Queueing something already read is a contradiction, so the two are never
  // offered together. The tick sits in one place on every card either way.
  const read = bar.cardBar({ read: true, title: "x" });
  const unread = bar.cardBar({ read: false, queued: false, title: "x" });

  assert.notEqual(read, "", "writes are configured, so the bar must render");
  assert.ok(!read.includes('data-act="readlist"'), "already read cannot also be queued");
  assert.ok(unread.includes('data-act="readlist"'));
  assert.ok(read.includes('data-act="read"') && unread.includes('data-act="read"'));
  assert.ok(!read.includes('data-act="favorite"'), "there is no favourites column, so there is no button");
});

await t("a queued book says whose readlist it is on", () => {
  const html = bar.cardBar({ read: false, queued: true, queued_for: "Dhanashri", title: "x" });
  assert.ok(html.includes("for Dhanashri"));
});

await t("a grid of one shape renders one card per book", () => {
  const host = { innerHTML: "", querySelectorAll: () => [] };
  cards.renderGrid(host, [book(), book({ id: "gb:2", title: "Ikigai" })]);
  assert.equal((host.innerHTML.match(/<article class="card/g) || []).length, 2);
});

await t("the empty state invites an action rather than stating a fact", () => {
  const html = cards.emptyState("Nothing here yet", "Find a book from the search page and mark it read.");
  assert.ok(html.includes("Find a book"));
});

await t("an empty state with nothing to add does not leave a blank line", () => {
  const { emptyState } = cards;
  // The reason is printed above the grid; repeating it reads as two failures.
  assert.ok(!emptyState("Nothing here", "").includes("empty__note"));
  assert.match(emptyState("Nothing here", "Try fewer words."), /empty__note">Try fewer words\./);
});

done();
