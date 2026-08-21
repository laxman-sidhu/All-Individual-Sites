import { store } from "../core/util.js";

// Bump when the row shape changes, or a stale snapshot outlives its reader.
const VERSION = 2;
const KEY = tab => `bv:snapshot:v${VERSION}:${tab}`;

export function readSnapshot(tab) {
  const raw = store.get(KEY(tab));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function writeSnapshot(tab, rows) {
  try { store.set(KEY(tab), JSON.stringify(rows)); } catch { /* quota */ }
}

export function clearSnapshots() {
  ["read", "readlist"].forEach(tab => store.remove(KEY(tab)));
}
