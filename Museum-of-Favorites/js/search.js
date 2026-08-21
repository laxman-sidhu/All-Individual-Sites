/**
 * Museum of Favorites — Search
 * Instant, debounced filtering of the current gallery. No reloads.
 */

import { qs, debounce } from "./utils.js";

/**
 * Attach search behaviour to the toolbar.
 * @param {(query: string) => void} onQuery — called with the trimmed,
 *        lower-cased query after the debounce window.
 */
export function initSearch(onQuery) {
  const wrapper = qs(".search");
  if (!wrapper) return;

  const input = qs(".search__input", wrapper);
  const clearBtn = qs(".search__clear", wrapper);

  const emit = debounce(() => {
    onQuery(input.value.trim().toLowerCase());
  }, 180);

  input.addEventListener("input", () => {
    wrapper.classList.toggle("has-value", input.value.length > 0);
    emit();
  });

  // Escape clears the field without leaving it.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      event.stopPropagation();
      input.value = "";
      wrapper.classList.remove("has-value");
      onQuery("");
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    wrapper.classList.remove("has-value");
    onQuery("");
    input.focus();
  });
}
