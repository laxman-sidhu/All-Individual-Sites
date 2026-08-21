// Browser stubs and the fixture workbook. The rows are a slice of the real sheet,
// because the cases that matter only show up in real data.

const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear()
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

export const READ_HEADER = ["Title", "ISBN", "Author", "Genre", "Thumbnail Url", "Read by Who ?", "Summary"];

export const READ_ROWS = [
  ["The Alchemist", "9780062315007", "Paulo Coelho", "Fictional", "https://img/alchemist.jpg", "Siddhesh", "A shepherd chases a dream."],
  ["The Alchemist", "0062315005", "Paulo Coelho", "Fictional", "https://covers.openlibrary.org/b/id/7463992-L.jpg", "Pratiksha", "A shepherd chases a dream."],
  ["Animals on the Train", "", "Ruskin Bond", "Short Story", "https://img/animals.jpg", "Siddhesh", "A very crowded compartment."],
  ["The Necklace", "", "Guy de Maupassant", "Short Story", "https://img/necklace.png", "Siddhesh", "A twist that turns pride into tragedy."],
  ["Ikigai", "9780143130727", "Héctor García & Francesc Miralles", "Non-Fiction", "https://img/ikigai.jpg", "Pratiksha", "A reason to get up."],
  ["Becoming", "9781524763138", "Michelle Obama", "Non-Fiction", "https://img/becoming.jpg", "Pratiksha", "A memoir."],
  ["Harry Potter and the Sorcerer's Stone", "9780747532743", "J.K. Rowling", "Fantasy", "https://img/hp1.jpg", "Dhanashri", "A letter arrives."],
  ["Harry Potter and the Chamber of Secrets", "9780747538493", "J.K. Rowling", "Fantasy", "https://img/hp2.jpg", "Dhanashri", "The chamber opens."],
  ["Alavani", "", "Ranjit Desai", "Horror", "https://img/alavani.jpg", "Pratiksha", "Not all battles are fought in the open."],
  // No author recorded. It must stay reachable, and must not collide with
  // anything that does have one.
  ["Untitled Notebook", "", "", "Fictional", "", "Siddhesh", ""]
];

export const READLIST_HEADER = ["Title", "ISBN", "Author", "Genre", "Thumbnail Url", "Summary", "Readlist of Who ?"];

export const READLIST_ROWS = [
  ["Dune", "9780441013593", "Frank Herbert", "Fantasy", "https://img/dune.jpg", "Spice.", "Dhanashri"],
  ["Shoe Dog", "9781471146725", "Phil Knight", "Non-Fiction", "https://img/shoedog.jpg", "Fifty borrowed dollars.", "Pratiksha"]
];

export function workbook(overrides = {}) {
  return {
    read: { header: READ_HEADER, rows: READ_ROWS.map(r => r.slice()), ...(overrides.read || {}) },
    readlist: { header: READLIST_HEADER, rows: READLIST_ROWS.map(r => r.slice()), ...(overrides.readlist || {}) }
  };
}

// Records every URL asked for, so a test can assert the REQUEST rather than the
// result — which is the whole point when the feature is "which endpoint runs".
export const calls = { get: [], post: [] };

export function stubFetch(handler) {
  calls.get.length = 0;
  calls.post.length = 0;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (options.method === "POST") {
      calls.post.push({ url: href, body: JSON.parse(options.body) });
    } else {
      calls.get.push(href);
    }
    const answer = await handler(href, options);
    if (answer === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    return {
      ok: answer.ok !== false,
      status: answer.status || 200,
      json: async () => answer.body,
      text: async () => JSON.stringify(answer.body)
    };
  };
}

export function bridge(tabs = workbook()) {
  return url => {
    if (url.includes("action=read")) return { body: { ok: true, tabs } };
    return undefined;
  };
}

// A tiny runner, so the suites read the same and need nothing installed.
export function suite() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; }
    catch (error) { fail++; console.log("FAIL " + name + ": " + (error && error.message)); }
  };
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { t, done };
}
