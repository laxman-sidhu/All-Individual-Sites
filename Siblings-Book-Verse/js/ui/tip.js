// A tooltip inside a card is always a cropped tooltip: .card and .card__cover
// are both overflow:hidden and must stay so. This one lives on <body>.

let node = null;
let anchor = null;

function shell() {
  if (node) return node;
  node = document.createElement("div");
  node.className = "tip";
  node.setAttribute("role", "tooltip");
  document.body.appendChild(node);
  return node;
}

// Placed by measurement, not by arithmetic. :root carries zoom on a wide
// screen, and whether that scales a fixed element's own offsets differs by
// browser - so the bubble is parked at 0,0, asked where that actually landed,
// and moved by the difference. Correct under either answer.
function place(target) {
  const tip = shell();
  tip.style.top = "0px";
  tip.style.left = "0px";
  const origin = tip.getBoundingClientRect();
  const scale = tip.offsetWidth ? origin.width / tip.offsetWidth : 1;
  if (!scale) return;

  const box = target.getBoundingClientRect();
  const gap = 8;

  let top = box.bottom + gap;
  if (top + origin.height > window.innerHeight - 8) top = Math.max(8, box.top - origin.height - gap);

  let left = box.left + box.width / 2 - origin.width / 2;
  left = Math.min(Math.max(8, left), window.innerWidth - origin.width - 8);

  tip.style.top = `${Math.round((top - origin.top) / scale)}px`;
  tip.style.left = `${Math.round((left - origin.left) / scale)}px`;
}

export function showTip(target) {
  const text = target?.getAttribute("data-tip");
  if (!text) return;
  anchor = target;
  const tip = shell();
  tip.textContent = text;
  tip.classList.add("is-on");
  place(target);
}

export function hideTip() {
  anchor = null;
  if (node) node.classList.remove("is-on");
}

// One listener for the whole document, so a repainted card needs no rewiring.
export function wireTips() {
  if (document.body.dataset.tipsWired) return;
  document.body.dataset.tipsWired = "1";

  const find = event => event.target.closest?.("[data-tip]");

  document.addEventListener("pointerover", event => {
    const target = find(event);
    if (target) showTip(target); else if (anchor && !event.target.closest?.(".tip")) hideTip();
  });
  document.addEventListener("focusin", event => {
    const target = find(event);
    if (target) showTip(target); else hideTip();
  });
  // A tap on the trigger toggles it; a tap anywhere else dismisses it.
  document.addEventListener("pointerdown", event => { if (!find(event)) hideTip(); });
  document.addEventListener("click", event => {
    const target = find(event);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (anchor === target && node?.classList.contains("is-on")) hideTip(); else showTip(target);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideTip(); });
  // Fixed position is measured against the viewport, so a scroll invalidates it.
  window.addEventListener("scroll", () => { if (anchor) place(anchor); }, { passive: true });
  window.addEventListener("resize", hideTip);
}
