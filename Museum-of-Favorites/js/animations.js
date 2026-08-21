/**
 * Museum of Favorites — Animations & shared chrome
 * Reveal-on-scroll, navbar blur, hamburger menu, the Galleries dropdown,
 * footer category links, ripple buttons, and the ambient sparkle field.
 * The dropdown + footer links are built from CONFIG (markup lives in the
 * #tpl-nav-dropdown-item / #tpl-footer-category templates). Imported by
 * both pages.
 */

import { qs, qsa, cloneTpl, prefersReducedMotion } from "./utils.js";
import { CONFIG, categoryUrl, displayTitle } from "./config.js";

/* --------------------------------------------------------------------------
 * Reveal on scroll
 * ------------------------------------------------------------------------ */

let revealObserver = null;

function getRevealObserver() {
  if (revealObserver) return revealObserver;

  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  return revealObserver;
}

/** Observe every `.reveal` element (call again after injecting content). */
export function observeReveals(scope = document) {
  if (prefersReducedMotion()) {
    qsa(".reveal", scope).forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const observer = getRevealObserver();
  qsa(".reveal:not(.is-visible)", scope).forEach((el) => observer.observe(el));
}

/** Stagger helper: sets an incremental reveal delay on a set of cards. */
export function staggerReveals(elements, step = 60, cap = 480) {
  elements.forEach((el, i) => {
    el.style.setProperty("--reveal-delay", `${Math.min(i * step, cap)}ms`);
  });
}

/* --------------------------------------------------------------------------
 * Galleries dropdown (populated from CONFIG so it stays automatic)
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * Galleries dropdown (built from CONFIG so it stays automatic)
 * ------------------------------------------------------------------------ */

function initDropdown() {
  const dropdown = qs("[data-dropdown]");
  if (!dropdown) return;

  const toggle = qs(".nav__dropdown-toggle", dropdown);
  const panel = qs("[data-category-menu]", dropdown);

  panel.replaceChildren(
    ...CONFIG.categories.map((category) => {
      const item = cloneTpl("tpl-nav-dropdown-item");
      item.href = categoryUrl(category);
      qs("[data-icon]", item).textContent = category.icon;
      qs("[data-label]", item).textContent = displayTitle(category);
      return item;
    })
  );

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    dropdown.classList.toggle("is-open", open);
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  panel.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

/* --------------------------------------------------------------------------
 * Footer category links (also built from CONFIG)
 * ------------------------------------------------------------------------ */

function populateFooterCategories() {
  const host = qs("[data-footer-categories]");
  if (!host) return;

  host.replaceChildren(
    ...CONFIG.categories.map((category) => {
      const li = cloneTpl("tpl-footer-category");
      const link = qs("[data-link]", li);
      link.href = categoryUrl(category);
      link.textContent = displayTitle(category);
      return li;
    })
  );
}

/* --------------------------------------------------------------------------
 * Navbar: blur boost on scroll + hamburger menu
 * ------------------------------------------------------------------------ */

function initNavbar() {
  const nav = qs(".nav");
  if (!nav) return;

  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 12);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = qs(".nav__toggle");
  const links = qs(".nav__links");
  if (!toggle || !links) return;

  const dropdown = qs("[data-dropdown]", links);
  const dropdownToggle = dropdown ? qs(".nav__dropdown-toggle", dropdown) : null;
  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

  const setDropdown = (open) => {
    if (!dropdown || !dropdownToggle) return;
    dropdown.classList.toggle("is-open", open);
    dropdownToggle.setAttribute("aria-expanded", String(open));
  };

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    links.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);

    // On mobile, the Galleries dropdown starts open when the sheet opens
    // (the visitor can still collapse it or navigate elsewhere). Deferring
    // the open lets the global "click outside" handler settle first.
    if (isMobile()) {
      if (open) requestAnimationFrame(() => setDropdown(true));
      else setDropdown(false);
    }
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  links.addEventListener("click", (event) => {
    // Close the mobile sheet when a real link (not the dropdown toggle) is used.
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && links.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
}

/* --------------------------------------------------------------------------
 * Ripple buttons
 * ------------------------------------------------------------------------ */

function initRipples() {
  if (prefersReducedMotion()) return;

  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".btn");
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");

    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;

    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
}

/* --------------------------------------------------------------------------
 * Ambient sparkles
 * ------------------------------------------------------------------------ */

function initSparkles() {
  const scenery = qs(".scenery");
  if (!scenery || prefersReducedMotion()) return;

  const isSmallScreen = window.matchMedia("(max-width: 767px)").matches;
  const count = isSmallScreen ? 8 : 16;

  for (let i = 0; i < count; i++) {
    const sparkle = document.createElement("span");
    sparkle.className = "sparkle";
    sparkle.style.left = `${Math.random() * 100}%`;
    sparkle.style.top = `${Math.random() * 100}%`;
    sparkle.style.animationDelay = `${Math.random() * 6}s`;
    sparkle.style.animationDuration = `${4 + Math.random() * 4}s`;
    scenery.appendChild(sparkle);
  }
}

/* --------------------------------------------------------------------------
 * Boot shared chrome
 * ------------------------------------------------------------------------ */

export function initChrome() {
  document.documentElement.classList.remove("no-js");
  initNavbar();
  initDropdown();
  populateFooterCategories();
  initRipples();
  initSparkles();
  observeReveals();
}
