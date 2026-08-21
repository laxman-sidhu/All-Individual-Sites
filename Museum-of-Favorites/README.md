# 🏛️ Museum of Favorites

A beautiful, fully static digital museum that showcases favourite actors, actresses, superheroes, supervillains and any other collections you dream up — all powered by a single Google Sheet.

Built with **HTML5, CSS3 and Vanilla JavaScript (ES6 modules)**. No frameworks, no build tools, no backend.

---

## ✨ Features

- **Google Sheets as a database** — every collection is a sheet tab with two columns: `Name` and `Image Url`.
- **Config-driven** — add a new collection by appending one object to `js/config.js`. Nothing else changes.
- **Immersive homepage** — animated hero, floating pastel blobs, glowing rings, sparkles, and self-generating collection cards with live exhibit counts and three preview portraits.
- **Exhibition pages** — each collection opens as its own gallery with a search bar, responsive grid and elegant exhibit cards.
- **Instant search** — debounced, filters as you type, no reload.
- **Fullscreen modal** — blurred backdrop, spring animation, closes on ✕, Escape, or outside click.
- **Thoughtful states** — shimmering skeleton cards while loading, an illustrated empty state, and an error panel with a retry button.
- **Resilient images** — lazy loading, fade-in on load, and a pastel placeholder for broken URLs.
- **Performance** — parallel fetching, sessionStorage caching (5 min TTL), Intersection Observer reveals, minimal DOM churn.
- **Accessible** — semantic HTML, keyboard navigation, visible focus rings, ARIA labels, skip link, `prefers-reduced-motion` support.
- **Responsive** — mobile-first with a full-screen glass hamburger menu, 2→6 gallery columns from phones to ultra-wide monitors, safe-area support for notched phones.

---

## 📁 Folder structure

```
museum-of-favorites/
├── index.html            Homepage (hero, collections, about)
├── category.html         Exhibition page (gallery, search, modal)
├── css/
│   ├── variables.css     Design tokens (colors, type, motion, layout)
│   ├── style.css         Reset, typography, ambient background
│   ├── layout.css        Navbar, sections, footer
│   ├── components.css    Buttons, cards, gallery, modal, states
│   ├── animations.css    Keyframes, reveal utilities, reduced motion
│   ├── home.css          Homepage-only styles
│   ├── category.css      Category-page-only styles
│   └── responsive.css    All breakpoints
├── js/
│   ├── config.js         ⭐ The only file you edit to add collections
│   ├── api.js            Google Sheets CSV fetching + caching
│   ├── utils.js          Debounce, CSV parser, DOM helpers
│   ├── animations.js     Reveal-on-scroll, navbar, hamburger, ripples
│   ├── modal.js          Exhibit modal
│   ├── search.js         Debounced search
│   ├── home.js           Homepage controller
│   └── category.js       Category page controller
├── assets/
│   ├── favicon/          SVG favicon
│   ├── icons/            GitHub icon
│   ├── illustrations/    Empty & error state artwork
│   └── placeholders/     Broken-image fallback
└── README.md
```

---

## 📊 Google Sheets integration

The site reads a **published** Google Sheet as CSV:

```
{sheetBaseUrl}?gid={SHEET_GID}&single=true&output=csv
```

Each tab needs exactly two columns:

| Name           | Image Url                    |
| -------------- | ---------------------------- |
| Some Favourite | https://…/portrait.jpg       |

To publish a sheet: **File → Share → Publish to web → Entire document → CSV**.

Fetched tabs are cached in `sessionStorage` for 5 minutes, so hopping between the homepage and galleries never refetches the same data.

---

## ➕ How to add a new collection

1. Add a new tab to your Google Sheet with `Name` and `Image Url` columns.
2. Select the tab and copy the `gid` number from the browser URL (`…#gid=123456789`).
3. Open `js/config.js` and append one object:

```js
{
  title: "Favourite Directors",
  icon: "🎥",
  gid: "123456789",
},
```

That's it. The homepage card, the **Galleries** dropdown in the navbar, the footer links, the exhibit count, previews, gallery page, search and card colour theme all generate automatically. Card colours cycle through five pastel washes, so every new collection is styled without any CSS changes.

### Clean URLs

Each collection page opens at `category.html?category=<slug>`, where the slug is generated automatically from the title (e.g. *Favourite Actors* → `favouriteactors`). The underlying sheet id is never shown in the address bar. To pin a custom slug, add a `slug: "…"` field to the category object.

---

## 🚀 Running & deploying

### Run locally

Because the site uses ES6 modules, browsers require it to be served over HTTP (opening `index.html` directly via `file://` blocks module loading in most browsers). Any tiny static server works:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`.

### Deploy to GitHub Pages

1. Push the folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**, select `main` and the root folder.
4. Save — your museum goes live at `https://<username>.github.io/<repo>/`.

### Deploy to Vercel

1. Push the folder to GitHub (or use `vercel` CLI in the project folder).
2. On [vercel.com](https://vercel.com), click **New Project** and import the repo.
3. Framework preset: **Other**. No build command, no output directory needed.
4. Deploy — done.

---

## 🎨 How to customize colors

Every colour lives in `css/variables.css`. Change the palette in one place:

```css
:root {
  --lavender: #cabdf7;
  --mint:     #b9ecd7;
  --baby-blue:#bfe1fa;
  --peach:    #ffd6c2;
  --butter:   #ffefc0;
  --ink:      #3d3660;   /* text colour */
}
```

Gradients, shadows and card washes are all derived from these tokens. The pastel washes cycled across collection cards live in `CARD_THEMES` inside `js/config.js`.

---

## 🖼️ How to replace icons

- **Collection icons** are emoji set per collection in `js/config.js` (`icon: "🎬"`). Swap in any emoji — or an `<img>`/SVG if you prefer, since the value is rendered inside the card's icon tile.
- **Brand mark** — the 🏛️ in the navbar lives in both HTML files (`.nav__brand-mark`).
- **GitHub icon** — replace `assets/icons/github.svg` and point the `.nav__icon-link` href at your profile.
- **Favicon** — replace `assets/favicon/favicon.svg`.
- **Footer credit** — the footer reads *Made with ❤️ by Your Name*. Replace `Your Name` inside the `.footer__author` span in both `index.html` and `category.html`.
- **Illustrations & placeholder** — swap the SVGs in `assets/illustrations/` and `assets/placeholders/` with any artwork of the same aspect ratio.

---

Curated with ❤️ · Powered by Google Sheets
