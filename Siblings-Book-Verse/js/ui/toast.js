import { esc } from "../core/util.js";

function tray() {
  let node = document.querySelector(".toasts");
  if (!node) {
    node = document.createElement("div");
    node.className = "toasts";
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }
  return node;
}

function render(node, kind, message) {
  const spinner = kind === "pending" ? '<span class="toast__spin" aria-hidden="true"></span>' : "";
  const mark = kind === "ok" ? "✓" : kind === "fail" ? "!" : "";
  const glyph = mark ? `<span class="toast__mark" aria-hidden="true">${mark}</span>` : "";
  node.className = `toast toast--${kind}`;
  node.innerHTML = `${spinner}${glyph}<span class="toast__text">${esc(message)}</span>`;
}

// A handle, so the same toast settles rather than a second stacking under it.
export function toast(message, kind = "ok", life = 3200) {
  const node = document.createElement("div");
  render(node, kind, message);
  tray().appendChild(node);

  let timer = null;
  const dismiss = () => {
    node.classList.add("is-going");
    setTimeout(() => node.remove(), 220);
  };
  const arm = ms => { clearTimeout(timer); if (ms) timer = setTimeout(dismiss, ms); };
  arm(kind === "pending" ? 0 : life);

  return {
    settle(text, nextKind = "ok", nextLife = 3200) { render(node, nextKind, text); arm(nextLife); },
    fail(text, nextLife = 5200) { render(node, "fail", text); arm(nextLife); },
    close: dismiss
  };
}

export const pending = message => toast(message, "pending", 0);
