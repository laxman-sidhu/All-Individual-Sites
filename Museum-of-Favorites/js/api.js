/**
 * Museum of Favorites — Data layer
 * Fetches published Google Sheets tabs as CSV and normalises them
 * into exhibit objects: { name, image }.
 *
 * Results are cached in sessionStorage so navigating between the
 * homepage and category pages never refetches the same sheet.
 */

import { CONFIG } from "./config.js";
import { parseCsv } from "./utils.js";

const CACHE_PREFIX = "mof-sheet-";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes — fresh enough, kind to Google

/** Build the published-CSV URL for a sheet tab. */
function csvUrl(gid) {
  return `${CONFIG.sheetBaseUrl}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
}

function readCache(gid) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + gid);
    if (!raw) return null;
    const { time, exhibits } = JSON.parse(raw);
    if (Date.now() - time > CACHE_TTL) return null;
    return exhibits;
  } catch {
    return null;
  }
}

function writeCache(gid, exhibits) {
  try {
    sessionStorage.setItem(
      CACHE_PREFIX + gid,
      JSON.stringify({ time: Date.now(), exhibits })
    );
  } catch {
    // Storage full or unavailable — caching is best-effort only.
  }
}

/** Turn raw CSV rows into clean exhibit objects. */
function normaliseRows(rows) {
  const exhibits = [];

  rows.forEach((cells, index) => {
    const name = (cells[0] || "").trim();
    const rawImage = cells[1] || "";

    // Skip the header row (first row whose name cell is "Name").
    if (index === 0 && name.toLowerCase() === "name") return;
    if (!name) return;

    // A cell may hold one URL, or many (one per line). Split on line
    // breaks, trim each, drop blanks — giving an ordered image list.
    const images = rawImage
      .split(/[\r\n]+/)
      .map((url) => url.trim())
      .filter(Boolean);

    // Keep `image` (the first URL) for backwards-compatible callers
    // such as the homepage preview rings.
    exhibits.push({ name, images, image: images[0] || "" });
  });

  return exhibits;
}

/**
 * Fetch one category's exhibits.
 * @param {string} gid — the Google Sheet tab id
 * @returns {Promise<Array<{name: string, image: string}>>}
 */
export async function fetchCategory(gid) {
  const cached = readCache(gid);
  if (cached) return cached;

  const response = await fetch(csvUrl(gid), { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Sheet request failed with status ${response.status}`);
  }

  const text = await response.text();
  const exhibits = normaliseRows(parseCsv(text));

  writeCache(gid, exhibits);
  return exhibits;
}

/**
 * Fetch every configured category in parallel.
 * Failures never reject the whole batch — each entry reports its
 * own status so the homepage can degrade gracefully per card.
 *
 * @returns {Promise<Map<string, {ok: boolean, exhibits: Array}>>}
 */
export async function fetchAllCategories() {
  const results = new Map();

  await Promise.all(
    CONFIG.categories.map(async ({ gid }) => {
      try {
        const exhibits = await fetchCategory(gid);
        results.set(String(gid), { ok: true, exhibits });
      } catch {
        results.set(String(gid), { ok: false, exhibits: [] });
      }
    })
  );

  return results;
}
