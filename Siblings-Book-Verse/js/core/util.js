// Escaping, normalisation and the helpers everything else borrows.

export function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// \p{L} not \w: \w is ASCII-only and would empty a Devanagari or Japanese title.
// \p{M} stays because a Devanagari vowel sign is a combining mark, not a letter.
const PUNCT = /[^\p{L}\p{N}\p{M}\s]/gu;

export function normaliseText(text) {
  return String(text == null ? "" : text)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(PUNCT, " ").replace(/\s+/g, " ").trim();
}

// Author keys drop spaces too, so "J.K. Rowling" and "JK Rowling" are one person.
export function normaliseAuthor(text) {
  return normaliseText(text).replace(/\s+/g, "");
}

export function normaliseHeader(text) {
  return String(text == null ? "" : text).replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function titleCase(text) {
  return String(text || "").toLowerCase().replace(/\b[\p{L}]/gu, ch => ch.toUpperCase());
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function truthy(value) {
  return /^(yes|y|true|1|x|✓|done)$/i.test(String(value == null ? "" : value).trim());
}

export function yearOf(value) {
  const match = String(value == null ? "" : value).match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
}

export function clean(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

// Keeps the line breaks clean() would collapse. Every summary goes through this.
export function cleanLines(text) {
  return String(text == null ? "" : text)
    .replace(/\r\n?/g, "\n")
    .split("\n").map(line => line.replace(/[^\S\n]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// Google's blurbs are HTML and Open Library's are not, so both are stripped.
export function stripHtml(text) {
  return clean(String(text == null ? "" : text)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/\n{3,}/g, "\n\n");
}

// Every word must appear somewhere, so word order and hyphens stop mattering.
export function searchTerms(query) {
  return normaliseText(query).split(" ").filter(Boolean);
}

export function matchesTerms(haystack, terms) {
  if (!terms.length) return true;
  const hay = normaliseText(haystack);
  return terms.every(term => hay.includes(term));
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } }
};

export function qs(name) {
  return new URLSearchParams(location.search).get(name) || "";
}

export function setQuery(params) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  });
  history.replaceState(null, "", url);
}

export function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
