import { READERS } from "../config.js";
import { esc, initials, clean } from "../core/util.js";

// Its own module because cards.js draws the pile and cardactions.js redraws it
// after a write, and neither may import the other.

export function readerPhoto(name) {
  const key = clean(name).toLowerCase();
  const hit = READERS.find(reader => reader.name.toLowerCase() === key || reader.key === key);
  return hit ? hit.photo : "";
}

// Faces, not names: three initials read as a code, three photographs as people.
export function faces(names, { size = "" } = {}) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "";
  const chips = list.slice(0, 4).map(name => {
    const photo = readerPhoto(name);
    const fallback = `<span class="face__ini">${esc(initials(name))}</span>`;
    const image = photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async">` : "";
    return `<span class="face${size ? ` face--${size}` : ""}" title="${esc(name)}">${fallback}${image}</span>`;
  }).join("");
  const more = list.length > 4 ? `<span class="face face--more">+${list.length - 4}</span>` : "";
  return `<span class="faces" aria-label="Read by ${esc(list.join(", "))}">${chips}${more}</span>`;
}
