/**
 * Museum of Favorites — Homepage
 * Builds the collection cards from CONFIG (markup lives in the
 * #tpl-collection-card template), then fills each card with a live
 * exhibit count and three preview portraits once the sheets load.
 */

import { CONFIG, CARD_THEMES, categoryUrl, displayTitle } from "./config.js";
import { fetchAllCategories } from "./api.js";
import { qs, cloneTpl, hydrateImage } from "./utils.js";
import { initChrome, observeReveals, staggerReveals } from "./animations.js";

const PLACEHOLDER = "assets/placeholders/exhibit.svg";

/** Build one collection card from the template. */
function buildCard(category, index) {
  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const card = cloneTpl("tpl-collection-card");

  card.href = categoryUrl(category);
  card.dataset.gid = category.gid;
  card.setAttribute("aria-label", `Open the ${category.title} collection`);
  card.style.setProperty("--card-wash", theme.wash);
  card.style.setProperty("--card-glow", theme.glow);

  qs("[data-icon]", card).textContent = category.icon;
  qs("[data-wing]", card).textContent = `WING ${String(index + 1).padStart(2, "0")}`;
  qs("[data-title]", card).textContent = displayTitle(category);

  return card;
}

/** Render all cards immediately (before any network work). */
function renderCards() {
  const grid = qs("#collections-grid");
  grid.replaceChildren(...CONFIG.categories.map(buildCard));

  staggerReveals([...grid.children], 90);
  observeReveals(grid);
}

/** Fill counts + preview portraits once sheet data arrives. */
async function hydrateCards() {
  const results = await fetchAllCategories();

  for (const card of document.querySelectorAll(".collection-card")) {
    const result = results.get(String(card.dataset.gid));
    const countEl = qs("[data-count]", card);
    const previewsEl = qs("[data-previews]", card);

    if (!result || !result.ok) {
      countEl.textContent = "Temporarily unavailable";
      previewsEl.replaceChildren();
      continue;
    }

    const { exhibits } = result;
    countEl.textContent =
      exhibits.length === 1 ? "1 exhibit" : `${exhibits.length} exhibits`;

    const rings = exhibits.slice(0, 3).map(({ image }) => {
      const ring = cloneTpl("tpl-preview-ring");
      const img = qs("img", ring);
      img.src = image || PLACEHOLDER;
      hydrateImage(img);
      img.style.opacity = "1"; // preview rings are tiny; show instantly
      return ring;
    });
    previewsEl.replaceChildren(...rings);
  }
}

function init() {
  initChrome();
  renderCards();
  hydrateCards();
}

init();
