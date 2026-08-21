import { CACHE_TTL_MS } from "../config.js";

const memory = new Map();
const PREFIX = "bv:cache:";

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() > entry.until) { sessionStorage.removeItem(PREFIX + key); return null; }
    return entry.value;
  } catch { return null; }
}

function writeSession(key, value, until) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify({ value, until })); } catch { /* full */ }
}

export function cacheGet(key) {
  const hit = memory.get(key);
  if (hit && Date.now() <= hit.until) return hit.value;
  if (hit) memory.delete(key);
  const stored = readSession(key);
  if (stored != null) memory.set(key, { value: stored, until: Date.now() + CACHE_TTL_MS });
  return stored;
}

export function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  const until = Date.now() + ttl;
  memory.set(key, { value, until });
  writeSession(key, value, until);
}

// Both APIs wrap results, so "empty" means an empty list inside the envelope.
function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    for (const key of ["items", "docs", "works", "entries"]) {
      if (Array.isArray(value[key])) return value[key].length === 0;
    }
    // Open Library answers an unknown ISBN with {} rather than a 404.
    if (!Object.keys(value).length) return true;
  }
  return false;
}

// An empty result is never cached: a book added tomorrow should be findable tomorrow.
export async function cached(key, producer, ttl = CACHE_TTL_MS) {
  const hit = cacheGet(key);
  if (hit != null) return hit;
  const value = await producer();
  if (!isEmpty(value)) cacheSet(key, value, ttl);
  return value;
}

export function cacheClear() {
  memory.clear();
  try {
    Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX)).forEach(k => sessionStorage.removeItem(k));
  } catch { /* private mode */ }
}
