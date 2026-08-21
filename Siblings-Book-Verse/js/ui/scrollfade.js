// Edge fades on a row that scrolls sideways.
//
// Not pure CSS: a mask that is always on fades the first chip even when the row
// is at its start, which reads as a fault rather than an affordance. So the
// sides are switched by what is actually off-screen, and the gradient itself
// stays in the stylesheet as .is-fade-left and .is-fade-right.

const SLACK = 4;

export function wireEdgeFades(node) {
  if (!node) return () => {};

  const update = () => {
    const max = node.scrollWidth - node.clientWidth;
    if (max <= SLACK) {
      node.classList.remove("is-fade-left", "is-fade-right");
      return;
    }
    node.classList.toggle("is-fade-left", node.scrollLeft > SLACK);
    node.classList.toggle("is-fade-right", node.scrollLeft < max - SLACK);
  };

  node.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);

  // The webfont lands after the first paint and every chip changes width with it.
  if (document.fonts?.ready) document.fonts.ready.then(update).catch(() => {});
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(node);

  requestAnimationFrame(update);
  return update;
}
