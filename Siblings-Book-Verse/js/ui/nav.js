import { SITE_NAME } from "../config.js";
import { esc } from "../core/util.js";
import { toast } from "./toast.js";

// One list, every page.
export const NAV = [
  { key: "library", label: "Library", href: "library.html", icon: "shelf" },
  { key: "editions", label: "Editions", href: "editions.html", icon: "editions" },
  { key: "readlist", label: "Readlist", href: "readlist.html", icon: "bookmark" }
];

const ICONS = {
  shelf: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.6l3.4.9-4 15.1-3.4-.9z"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
  editions: '<path d="M12 3.4l8 4.1-8 4.1-8-4.1z"/><path d="M4 12l8 4.1 8-4.1"/><path d="M4 16.4l8 4.1 8-4.1"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>'
};

function icon(name, filled) {
  const style = filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="nav__icon" viewBox="0 0 24 24" ${style} aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

// The current entry is marked, never hidden.
function isCurrent(entry, page) {
  return Boolean(page) && entry.key === page;
}

export function mountNav({ page = "" } = {}) {
  const host = document.querySelector("[data-nav]");
  if (!host) return;

  const links = NAV.map(entry => {
    const current = isCurrent(entry, page);
    return `<a class="nav__link${current ? " is-current" : ""}" href="${entry.href}"${current ? ' aria-current="page"' : ""}>`
      + `${icon(entry.icon, current)}<span>${esc(entry.label)}</span></a>`;
  }).join("");

  host.innerHTML = `
    <div class="nav__inner">
      <a class="wordmark" href="index.html" aria-label="${esc(SITE_NAME)} home">
        <span class="wordmark__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>
          </svg>
        </span>
        <span class="wordmark__text">${esc(SITE_NAME)}</span>
      </a>
      <nav class="nav__links" aria-label="Collections">${links}</nav>
      <div class="nav__tools">
        <button class="iconbtn" type="button" data-reload title="Reload from the sheet" aria-label="Reload from the sheet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS.reload}</svg>
        </button>
        <a class="iconbtn" href="index.html" title="Find a book" aria-label="Find a book">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS.search}</svg>
        </a>
      </div>
    </div>`;
}

// A silent control gets clicked again, which is how one reload becomes four.
export function wireReload(reader) {
  const button = document.querySelector("[data-reload]");
  if (!button) return;
  let running = false;

  button.addEventListener("click", async () => {
    if (running) return;
    running = true;
    button.classList.add("is-spinning");
    const note = toast("Reloading from the sheet...", "pending", 0);
    try {
      const summary = await reader();
      note.settle(summary || "Up to date", "ok");
      button.classList.remove("is-spinning");
      button.classList.add("is-done");
      setTimeout(() => button.classList.remove("is-done"), 1400);
    } catch (error) {
      note.fail(error?.message || "Could not reach the sheet.");
      button.classList.remove("is-spinning");
    } finally {
      running = false;
    }
  });
}
