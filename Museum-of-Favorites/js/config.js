/**
 * Museum of Favorites — Configuration
 * ------------------------------------------------------------------
 * This is the only file you need to edit to change the collections.
 *
 * To add a new collection, append one object to the `categories` array
 * below (a sheet tab with columns Name | Image Url must exist for its gid):
 *
 *   { title: "Favourite Characters", icon: "🎭", gid: "<tab-gid>" }
 *
 * The homepage card, category page, navbar dropdown, footer link, URL slug
 * and colour theme are all generated automatically from this list.
 *
 * A clean URL `slug` is generated from each title with the leading
 * "Favourite" dropped (e.g. "Favourite Actors" -> "actors"), so pages
 * open as category.html?category=actors.
 */

export const CONFIG = {
  sheetBaseUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTbfhZ3WRK8s_9_B8vbfo92cLprTbaY1OHl_HT2kjYvYV6u2ycqHKsIqpUAXuhQAmWbk1kXAPLHfW_Q/pub",

  categories: [
    { title: "Favourite Actors",        icon: "🎬", gid: "0" },
    { title: "Favourite Actress",       icon: "✨", gid: "516486146" },
    { title: "Favourite Superheroes",   icon: "🦸", gid: "1154234558" },
    { title: "Favourite Supervillains", icon: "😈", gid: "455423366" },
  ],
};

/**
 * Pastel washes cycled across collection cards. Categories pick theirs
 * by index, so new collections are styled automatically.
 */
export const CARD_THEMES = [
  { wash: "var(--grad-lavender)", glow: "0 14px 40px rgba(160, 138, 240, 0.30)" },
  { wash: "var(--grad-mint)",     glow: "0 14px 40px rgba(102, 194, 160, 0.30)" },
  { wash: "var(--grad-blue)",     glow: "0 14px 40px rgba(111, 168, 220, 0.30)" },
  { wash: "var(--grad-peach)",    glow: "0 14px 40px rgba(242, 163, 124, 0.30)" },
  { wash: "var(--grad-butter)",   glow: "0 14px 40px rgba(230, 195, 100, 0.30)" },
];

/**
 * Short display label — drops a leading "Favourite"/"Favorite" so labels
 * read "Actors", "Superheroes", etc. The full title is kept for page
 * headings; the slug is built from this short form.
 */
export function displayTitle(category) {
  const title = typeof category === "string" ? category : category.title;
  return String(title).replace(/^\s*favou?rite\s+/i, "").trim();
}

/** Turn a label into a clean URL slug. */
function slugify(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

// Give every category a clean slug once, at load.
CONFIG.categories.forEach((category) => {
  if (!category.slug) category.slug = slugify(displayTitle(category));
});

/** Find a category by its URL slug. */
export function findCategoryBySlug(slug) {
  if (!slug) return null;
  const wanted = slugify(slug);
  return CONFIG.categories.find((c) => c.slug === wanted) || null;
}

/** Build the public URL for a category page. */
export function categoryUrl(category) {
  return `category.html?category=${encodeURIComponent(category.slug)}`;
}
