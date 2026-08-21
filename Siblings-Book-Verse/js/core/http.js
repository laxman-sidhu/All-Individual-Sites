import { REQUEST_TIMEOUT_MS } from "../config.js";

export class HttpError extends Error {
  constructor(message, status) { super(message); this.name = "HttpError"; this.status = status; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function once(url, { timeout, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || REQUEST_TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      // Google explains itself in the body, not the status; losing that text costs an afternoon.
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.error?.errors?.[0]?.message || "";
      } catch { /* not JSON */ }
      throw new HttpError(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// 429 and 5xx are worth retrying; a 404 never is.
export async function getJSON(url, options = {}) {
  const attempts = options.attempts ?? 3;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await once(url, options);
    } catch (error) {
      last = error;
      const status = error.status || 0;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || i === attempts - 1) break;
      await sleep(400 * Math.pow(2, i));
    }
  }
  throw last;
}

export async function getText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// text/plain is the one JSON carrier that never triggers a CORS preflight, which
// Apps Script cannot answer. Changing this header breaks every write.
export async function postPlain(url, payload, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 25000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* Apps Script error page */ }
    if (!response.ok) throw new HttpError(parsed?.error || `HTTP ${response.status}`, response.status);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
