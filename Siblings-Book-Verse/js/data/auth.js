import { OWNER_PASSWORD, SESSION_HOURS, APPS_SCRIPT_URL } from "../config.js";
import { store } from "../core/util.js";

const KEY = "bv:owner";

// A convenience, not a security boundary: the token Code.gs checks is the real gate.
export function writesEnabled() {
  return Boolean(APPS_SCRIPT_URL && OWNER_PASSWORD);
}

export function isOwner() {
  if (!writesEnabled()) return false;
  const raw = store.get(KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until) || Date.now() > until) { store.remove(KEY); return false; }
  return true;
}

export function signIn(password) {
  if (!writesEnabled()) return false;
  if (String(password || "") !== OWNER_PASSWORD) return false;
  store.set(KEY, String(Date.now() + SESSION_HOURS * 3600 * 1000));
  return true;
}

export function signOut() {
  store.remove(KEY);
}
