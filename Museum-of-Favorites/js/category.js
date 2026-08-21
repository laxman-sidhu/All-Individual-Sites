/**
 * Museum of Favorites — Category page
 * Reads ?category=<slug> from the URL, resolves the collection from CONFIG,
 * fetches its sheet and renders the gallery with search, skeleton loading,
 * empty/error states and the exhibit modal. All markup lives in the
 * <template> elements in category.html.
 */

import { findCategoryBySlug } from "./config.js";
import { fetchCategory } from "./api.js";
import { qs, cloneTpl, getQueryParam, hydrateImage } from "./utils.js";
import { initChrome, observeReveals, staggerReveals } from "./animations.js";
import { initModal, openModal } from "./modal.js";
import { initSearch } from "./search.js";

const PLACEHOLDER = "assets/placeholders/exhibit.svg";

const gallery = qs("#gallery");
const stateHost = qs("#state-host");
const countEl = qs("#exhibit-count");
const searchCountEl = qs("#search-count");

let category = null;
let exhibits = [];

/* -------------------------------------------------------------------------
 * States (built from the #tpl-state template)
 * ----------------------------------------------------------------------- */

function showState({ illus, title, text, alert = false, onRetry = null }) {
  const panel = cloneTpl("tpl-state");
  qs("[data-illus]", panel).src = illus;
  qs("[data-title]", panel).textContent = title;
  qs("[data-text]", panel).textContent = text;
  if (alert) panel.setAttribute("role", "alert");

  const retry = qs("[data-retry]", panel);
  if (onRetry) {
    retry.hidden = false;
    retry.addEventListener("click", onRetry);
  }

  stateHost.replaceChildren(panel);
  observeReveals(stateHost);
}

function showSkeletons(count = 10) {
  gallery.replaceChildren(
    ...Array.from({ length: count }, () => cloneTpl("tpl-skeleton-card"))
  );
  const note = document.createElement("p");
  note.className = "loading-note";
  note.setAttribute("role", "status");
  note.textContent = "Preparing the gallery";
  stateHost.replaceChildren(note);
}

function showEmptyState() {
  gallery.replaceChildren();
  showState({
    illus: "assets/illustrations/empty.svg",
    title: "An empty wing, for now",
    text: "This gallery is waiting for its first exhibit.",
  });
}

function showErrorState() {
  gallery.replaceChildren();
  showState({
    illus: "assets/illustrations/closed.svg",
    title: "This gallery is temporarily unavailable.",
    text: "Please try again shortly.",
    alert: true,
    onRetry: loadExhibits,
  });
}

function showNoMatches(query) {
  showState({
    illus: "assets/illustrations/empty.svg",
    title: "No exhibits found",
    text: `Nothing here matches “${query}”. Try a different name.`,
  });
}

/* -------------------------------------------------------------------------
 * Gallery rendering (from the #tpl-exhibit-card template)
 * ----------------------------------------------------------------------- */

function buildExhibitCard(exhibit, index) {
  const card = cloneTpl("tpl-exhibit-card");
  const img = qs("img", card);

  card.dataset.index = index;
  card.setAttribute("aria-label", `View ${exhibit.name}`);

  img.src = (exhibit.images && exhibit.images[0]) || exhibit.image || PLACEHOLDER;
  img.alt = exhibit.name;

  qs(".exhibit-card__count", card).textContent =
    (exhibit.images && exhibit.images.length) || (exhibit.image ? 1 : 0);
  qs(".exhibit-card__name", card).textContent = exhibit.name;

  return card;
}

function renderGallery(items) {
  stateHost.replaceChildren();

  if (items.length === 0) {
    gallery.replaceChildren();
    return;
  }

  gallery.replaceChildren(
    ...items.map((item) => buildExhibitCard(item, exhibits.indexOf(item)))
  );

  const cards = [...gallery.children];
  staggerReveals(cards, 45, 400);
  cards.forEach((card) => hydrateImage(qs("img", card)));
  observeReveals(gallery);
}

function updateCounts(visible, total, query) {
  countEl.textContent = total === 1 ? "1 exhibit" : `${total} exhibits`;
  searchCountEl.textContent = !query
    ? ""
    : visible === 1
    ? "1 exhibit matches"
    : `${visible} exhibits match`;
}

/* -------------------------------------------------------------------------
 * Search + modal wiring
 * ----------------------------------------------------------------------- */

function handleQuery(query) {
  const filtered = query
    ? exhibits.filter(({ name }) => name.toLowerCase().includes(query))
    : exhibits;

  renderGallery(filtered);
  updateCounts(filtered.length, exhibits.length, query);

  if (query && filtered.length === 0) showNoMatches(query);
}

function handleGalleryClick(event) {
  const card = event.target.closest(".exhibit-card");
  if (!card) return;

  const exhibit = exhibits[Number(card.dataset.index)];
  if (exhibit) openModal(exhibit, card);
}

/* -------------------------------------------------------------------------
 * Boot
 * ----------------------------------------------------------------------- */

async function loadExhibits() {
  showSkeletons();

  try {
    exhibits = await fetchCategory(category.gid);
  } catch {
    countEl.textContent = "";
    showErrorState();
    return;
  }

  if (exhibits.length === 0) {
    countEl.textContent = "0 exhibits";
    showEmptyState();
    return;
  }

  renderGallery(exhibits);
  updateCounts(exhibits.length, exhibits.length, "");
}

function applyCategoryChrome() {
  qs("#category-icon").textContent = category.icon;
  qs("#category-title").textContent = category.title;
  document.title = `${category.title} — Museum of Favorites`;
}

function init() {
  initChrome();
  initModal();

  category = findCategoryBySlug(getQueryParam("category"));

  if (!category) {
    qs("#category-title").textContent = "Unknown collection";
    countEl.textContent = "";
    showErrorState();
    return;
  }

  applyCategoryChrome();
  gallery.addEventListener("click", handleGalleryClick);
  initSearch(handleQuery);
  loadExhibits();
}

init();
