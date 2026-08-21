import assert from "node:assert";
import { suite } from "./harness.mjs";

const { t, done } = suite();
const api = await import("../../js/books/api.js");

// A real Google Books volume, trimmed to the fields that are read.
const GOOGLE = {
  id: "FmyBAwAAQBAJ",
  volumeInfo: {
    title: "The Alchemist",
    subtitle: "A Fable About Following Your Dream",
    authors: ["Paulo Coelho"],
    publisher: "HarperCollins",
    publishedDate: "1993-05-01",
    description: "<p>Santiago, an <b>Andalusian</b> shepherd boy.</p>",
    industryIdentifiers: [
      { type: "ISBN_10", identifier: "0062315005" },
      { type: "ISBN_13", identifier: "9780062315007" }
    ],
    pageCount: 197,
    categories: ["Fiction / Literary", "Fiction / Fantasy / General"],
    averageRating: 4.5,
    ratingsCount: 1200,
    imageLinks: {
      smallThumbnail: "http://books.google.com/books/content?id=X&zoom=5&edge=curl",
      thumbnail: "http://books.google.com/books/content?id=X&zoom=1&edge=curl&source=gbs_api"
    },
    previewLink: "http://books.google.com/books?id=X",
    infoLink: "http://books.google.com/books?id=X&source=gbs_api"
  }
};

// A real Open Library search doc, same trimming.
const OL_DOC = {
  key: "/works/OL82563W",
  title: "Harry Potter and the Philosopher's Stone",
  author_name: ["J. K. Rowling"],
  cover_i: 10521270,
  first_publish_year: 1997,
  subject: ["Wizards", "Magic", "fantasy fiction"],
  ratings_average: 4.283,
  ratings_count: 812,
  number_of_pages_median: 320,
  isbn: ["9780747532743"],
  publisher: ["Bloomsbury"]
};

// subjects.json returns a DIFFERENT shape for the same thing.
const OL_WORK = {
  key: "/works/OL27448W",
  title: "The Lord of the Rings",
  authors: [{ name: "J.R.R. Tolkien", key: "/authors/OL26320A" }],
  cover_id: 8231990,
  first_publish_year: 1954,
  subject: ["Fantasy", "Middle Earth"]
};

await t("a Google volume becomes the one shape", () => {
  const book = api.fromGoogle(GOOGLE);
  assert.equal(book.id, "gb:FmyBAwAAQBAJ");
  assert.equal(book.source, "google");
  assert.equal(book.title, "The Alchemist");
  assert.equal(book.subtitle, "A Fable About Following Your Dream");
  assert.deepEqual(book.authors, ["Paulo Coelho"]);
  assert.equal(book.year, 1993);
  assert.equal(book.pages, 197);
  assert.equal(book.isbn13, "9780062315007");
  assert.equal(book.isbn10, "0062315005");
  assert.equal(book.rating, 4.5);
  assert.equal(book.ratingCount, 1200);
});

await t("their thumbnails arrive over http with a page curl drawn on", () => {
  const book = api.fromGoogle(GOOGLE);
  assert.ok(book.cover.startsWith("https:"), "http covers are blocked on an https page");
  assert.ok(!book.cover.includes("edge=curl"), "the curl overlay is drawn into the image");
});

await t("their description is HTML and ours is not", () => {
  assert.equal(api.fromGoogle(GOOGLE).description, "Santiago, an Andalusian shepherd boy.");
});

await t('categories are split, because Google files things as "Fiction / Fantasy"', () => {
  const book = api.fromGoogle(GOOGLE);
  assert.ok(book.genres.includes("Fantasy"), "the leaf is the useful part");
  assert.ok(book.genres.includes("Literary"));
  assert.equal(book.genres.filter(g => g === "Fiction").length, 1, "the root repeats and must be deduped");
});

await t("a volume with no cover falls back to Open Library by ISBN", () => {
  const bare = { ...GOOGLE, volumeInfo: { ...GOOGLE.volumeInfo, imageLinks: undefined } };
  const book = api.fromGoogle(bare);
  assert.ok(book.cover.includes("covers.openlibrary.org"));
  assert.ok(book.cover.includes("9780062315007"));
  assert.ok(book.cover.includes("default=false"), "without this the fallback returns a blank 1x1 rather than a 404");
});

await t("a volume with nothing at all gets no cover, not a broken one", () => {
  const book = api.fromGoogle({ id: "z", volumeInfo: { title: "Nothing" } });
  assert.equal(book.cover, "");
  assert.equal(book.coverAlt, "");
});

await t("an Open Library search doc becomes the same shape", () => {
  const book = api.fromOpenLibraryDoc(OL_DOC);
  assert.equal(book.id, "ol:/works/OL82563W");
  assert.equal(book.source, "openlibrary");
  assert.deepEqual(book.authors, ["J. K. Rowling"]);
  assert.equal(book.year, 1997);
  assert.equal(book.pages, 320);
  assert.equal(book.isbn13, "9780747532743");
  assert.equal(book.rating, 4.3, "a rating is rounded to one place, not printed as 4.283");
  assert.ok(book.cover.includes("/b/id/10521270-M.jpg"));
  assert.ok(book.coverAlt.includes("-L.jpg"), "the modal needs a bigger one than the card");
});

await t("a search doc keeps every printing it lists, not just the one it shows", () => {
  // The index returns a work's entire ISBN list in one flat array. Taking one
  // and discarding the rest is what stopped a trending card ever recognising
  // itself as another edition of something on the shelf.
  const book = api.fromOpenLibraryDoc({
    ...OL_DOC,
    isbn: ["0747532745", "9780747532743", "9780439362139", "978-0-7475-3849-3"]
  });
  assert.equal(book.isbn13, "9780747532743", "the one on the cover is still picked by shape");
  assert.ok(book.editionIsbns.includes("9780439362139"));
  assert.ok(book.editionIsbns.includes("9780747538493"), "hyphens are not part of a number");
  assert.equal(book.editionIsbns.length, 3, "both forms of one printing are one entry");
});

await t("a subjects.json work has cover_id and authors[], not cover_i and author_name", () => {
  const book = api.fromOpenLibraryWork(OL_WORK);
  assert.equal(book.title, "The Lord of the Rings");
  assert.deepEqual(book.authors, ["J.R.R. Tolkien"]);
  assert.ok(book.cover.includes("/b/id/8231990-M.jpg"));
  assert.equal(book.year, 1954);
});

await t("subjects are title-cased, so the chips do not shout in mixed case", () => {
  const book = api.fromOpenLibraryDoc(OL_DOC);
  assert.ok(book.genres.includes("Fantasy Fiction"), book.genres.join(","));
});

await t("both shapes carry every field, blank rather than missing", () => {
  const fields = ["id", "source", "title", "subtitle", "authors", "year", "cover", "coverAlt",
    "genres", "description", "isbn13", "isbn10", "pages", "publisher", "rating", "ratingCount"];
  for (const book of [api.fromGoogle(GOOGLE), api.fromOpenLibraryDoc(OL_DOC), api.fromOpenLibraryWork(OL_WORK)]) {
    fields.forEach(field => assert.ok(field in book, `${book.source} is missing ${field}`));
  }
});

done();
