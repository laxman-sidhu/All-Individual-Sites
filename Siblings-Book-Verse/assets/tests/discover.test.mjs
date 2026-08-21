import assert from "node:assert";
import { suite, stubFetch, calls } from "./harness.mjs";

// These assert the REQUESTS, not the results: a test that checked only the titles
// would pass just as happily on a call that searched the wrong index.
const { t, done } = suite();

const { cacheClear } = await import("../../js/core/cache.js");
const discover = await import("../../js/books/discover.js");

const googleItem = title => ({ id: "g1", volumeInfo: { title, authors: ["A"] } });

function serve({ google = 1, ol = 1 } = {}) {
  stubFetch(url => {
    if (url.includes("googleapis.com")) {
      return { body: { totalItems: google, items: Array.from({ length: google }, (_, i) => googleItem(`G${i}`)) } };
    }
    if (url.includes("/subjects/")) {
      return { body: { name: "Fantasy", work_count: ol, works: Array.from({ length: ol }, (_, i) => ({ key: `/works/W${i}`, title: `S${i}`, authors: [{ name: "A" }] })) } };
    }
    if (url.includes("/trending/")) {
      return { body: { works: Array.from({ length: ol }, (_, i) => ({ key: `/works/T${i}`, title: `T${i}`, author_name: ["A"] })) } };
    }
    if (url.includes("search.json")) {
      return { body: { numFound: ol, docs: Array.from({ length: ol }, (_, i) => ({ key: `/works/D${i}`, title: `D${i}`, author_name: ["A"] })) } };
    }
    return undefined;
  });
}

const reset = options => { cacheClear(); serve(options); };

await t("a bare phrase goes to Google Books, which ranks relevance better", async () => {
  reset();
  await discover.search({ scope: "auto", phrase: "the alchemist" });
  assert.equal(calls.get.length, 1);
  assert.ok(calls.get[0].includes("googleapis.com/books/v1/volumes"));
  assert.ok(calls.get[0].includes("q=the%20alchemist"));
  assert.ok(calls.get[0].includes("printType=books"));
});

await t("Title and Author use the field operators, not a bare phrase", async () => {
  reset();
  await discover.search({ scope: "title", phrase: "The Alchemist" });
  assert.ok(decodeURIComponent(calls.get[0]).includes('intitle:"The Alchemist"'));

  reset();
  await discover.search({ scope: "author", phrase: "Ruskin Bond" });
  assert.ok(decodeURIComponent(calls.get[0]).includes('inauthor:"Ruskin Bond"'));
});

await t("Subject goes to Open Library, which is the only one with real subject browsing", async () => {
  reset();
  const result = await discover.search({ scope: "subject", phrase: "Fantasy" });
  assert.ok(calls.get[0].includes("openlibrary.org/subjects/fantasy.json"), calls.get[0]);
  assert.equal(calls.get.length, 1, "Google must not also be called when the subject answered");
  assert.ok(result.headline.includes("Fantasy"));
});

await t("a subject the slug table does not know is slugified, not dropped", async () => {
  reset();
  await discover.search({ scope: "subject", phrase: "Magical Realism" });
  assert.ok(calls.get[0].includes("/subjects/magical_realism.json"), calls.get[0]);
});

await t("an ISBN is recognised on its own, without the scope being set", () => {
  assert.ok(discover.looksLikeIsbn("9780747532743"));
  assert.ok(discover.looksLikeIsbn("978-0-7475-3274-3"));
  assert.ok(discover.looksLikeIsbn("0062315005"), "the 10-digit form counts too");
  assert.ok(!discover.looksLikeIsbn("The Alchemist"));
  assert.ok(!discover.looksLikeIsbn("1997"));
  // Thirteen digits that are not an ISBN must not be sent to an ISBN index.
  assert.ok(!discover.looksLikeIsbn("1234567890123"));
});

// An ISBN names ONE printing, and the failure mode is not an error but a
// different book presented as the answer.
function serveIsbn({ edition = true, google = false, title = "The Alchemist" } = {}) {
  stubFetch(url => {
    if (url.includes("/api/books")) {
      if (!edition) return { body: {} };
      return { body: { "ISBN:9780062315007": {
        key: "/books/OL1M", title, url: "https://openlibrary.org/books/OL1M",
        authors: [{ name: "Paulo Coelho" }], publishers: [{ name: "HarperOne" }],
        publish_date: "2014", number_of_pages: 197,
        identifiers: { isbn_13: ["9780062315007"], isbn_10: ["0062315005"] },
        cover: { medium: "https://covers/m.jpg", large: "https://covers/l.jpg" }
      } } };
    }
    if (/\/isbn\/\d/.test(url)) {
      if (!edition) return undefined;
      return { body: { key: "/books/OL1M", languages: [{ key: "/languages/eng" }],
        works: [{ key: "/works/OL796465W" }], publishers: ["HarperOne"], publish_date: "2014" } };
    }
    if (url.includes("googleapis.com")) {
      return { body: google
        ? { totalItems: 1, items: [{ id: "g1", volumeInfo: { title, authors: ["Paulo Coelho"], description: "A shepherd.", industryIdentifiers: [{ type: "ISBN_13", identifier: "9780062315007" }] } }] }
        : { totalItems: 0, items: [] } };
    }
    return { body: { numFound: 0, docs: [] } };
  });
}

await t("an ISBN goes to the edition endpoints, never to a text index", async () => {
  cacheClear();
  serveIsbn();
  const result = await discover.search({ scope: "auto", phrase: "978-0-06-231500-7" });

  assert.equal(result.scope, "isbn");
  assert.ok(calls.get.some(url => url.includes("/api/books?bibkeys=ISBN:9780062315007")), "the dashes have to come out");
  assert.ok(calls.get.some(url => url.includes("/isbn/9780062315007.json")));
  // The whole bug: not one request may carry the digits as a phrase.
  const textSearch = calls.get.filter(url => url.includes("search.json") && !url.includes("isbn="));
  assert.deepEqual(textSearch, [], "a bare number must never be searched as words");
});

await t("the ISBN asked for is the ISBN shown, and the edition is the right one", async () => {
  cacheClear();
  serveIsbn({ google: true });
  const result = await discover.search({ scope: "isbn", phrase: "9780062315007" });

  assert.equal(result.items.length, 1, "one ISBN is one answer, not a page of them");
  const found = result.items[0];
  assert.equal(found.isbn13, "9780062315007");
  assert.equal(found.isbn10, "0062315005");
  assert.equal(found.publisher, "HarperOne", "the edition's publisher, not another printing's");
  assert.equal(found.language, "English");
  assert.equal(found.pages, 197);
  // Google carries the description Open Library's edition record does not.
  assert.equal(found.description, "A shepherd.");
  // The strips and the blurb hang off the work, not this one printing.
  assert.equal(found.workKey, "/works/OL796465W");
});

await t("an ISBN nobody holds says so, instead of answering with something else", async () => {
  cacheClear();
  serveIsbn({ edition: false });
  const result = await discover.search({ scope: "isbn", phrase: "9788845269110" });
  assert.deepEqual(result.items, [], "a wrong book is worse than no book");
  assert.ok(/9788845269110/.test(result.headline));
});

await t("a malformed ISBN is refused before either API is troubled", async () => {
  cacheClear();
  serveIsbn();
  const result = await discover.search({ scope: "isbn", phrase: "12345" });
  assert.deepEqual(result.items, []);
  assert.equal(calls.get.length, 0);
});

await t("a quoted field search that finds nothing relaxes before it gives up", async () => {
  cacheClear();
  let hits = 0;
  stubFetch(url => {
    if (!url.includes("googleapis.com")) return { body: { numFound: 0, docs: [] } };
    hits++;
    // The quoted form is empty; the same words unquoted are not.
    const empty = decodeURIComponent(url).includes('intitle:"');
    return { body: { totalItems: empty ? 0 : 1, items: empty ? [] : [googleItem("Found")] } };
  });
  const result = await discover.search({ scope: "title", phrase: "animals on the train" });
  assert.equal(hits, 2, "the narrow query runs first and the wide one only if needed");
  assert.equal(result.items.length, 1);
});

await t("Open Library is the last resort, and it is a genuinely different index", async () => {
  cacheClear();
  stubFetch(url => {
    if (url.includes("googleapis.com")) return { body: { totalItems: 0, items: [] } };
    return { body: { numFound: 1, docs: [{ key: "/works/X", title: "Only On OL", author_name: ["A"] }] } };
  });
  const result = await discover.search({ scope: "auto", phrase: "a regional edition" });
  assert.equal(result.items[0].title, "Only On OL");
  assert.ok(calls.get.some(url => url.includes("openlibrary.org/search.json")));
});

await t("an empty phrase asks nothing of anyone", async () => {
  reset();
  const result = await discover.search({ scope: "auto", phrase: "   " });
  assert.equal(calls.get.length, 0);
  assert.deepEqual(result.items, []);
});

await t("trending uses Open Library, because Google has no popularity signal", async () => {
  reset();
  await discover.trending("weekly");
  assert.ok(calls.get[0].includes("openlibrary.org/trending/weekly.json"), calls.get[0]);
  reset();
  await discover.trending("daily");
  assert.ok(calls.get[0].includes("/trending/daily.json"));
});

await t('"best short stories" asks for a shelf, not a title', async () => {
  reset();
  const result = await discover.search({ scope: "auto", phrase: "best short stories" });
  const first = decodeURIComponent(calls.get[0]);
  // Google is not asked at all: it ranks the phrase and answers with novels
  // that happen to carry those words, which is the whole complaint.
  assert.ok(!first.includes("googleapis.com"), first);
  assert.ok(first.includes("search.json"), first);
  assert.ok(first.includes("subject=short+stories"), first);
  assert.ok(first.includes("sort=rating"), first);
  assert.equal(result.scope, "subject");
});

await t("a title that merely contains a superlative still reaches Google", async () => {
  // "best served cold" strips to "served cold", which is nobody's shelf, so the
  // subject attempt finds nothing and the ordinary search runs after it.
  reset({ ol: 0 });
  await discover.search({ scope: "auto", phrase: "best served cold" });
  assert.ok(calls.get.some(url => url.includes("googleapis.com")), calls.get.join("\n"));
});

await t("a subject chip browses that subject and nothing else", async () => {
  reset();
  await discover.browse({ subject: "fantasy" });
  const first = decodeURIComponent(calls.get[0]);
  assert.ok(first.includes("search.json"), first);
  assert.ok(first.includes("subject=fantasy"), first);
  // Refine shortlists what came back. It is not a query, so nothing it offers
  // may leak into one - a sort here would mean two places decide the order.
  assert.ok(!first.includes("sort="), first);
});

await t("browsing with no subject still carries a query to filter", async () => {
  reset();
  await discover.browse({});
  // *:* is solr's match-all and the only spelling it accepts; a bare * is
  // parsed as a term and finds nothing.
  assert.ok(decodeURIComponent(calls.get[0]).includes("q=*:*"), calls.get[0]);
});

await t("a Google Books request states its country, or some regions get a 403", async () => {
  reset();
  await discover.search({ scope: "auto", phrase: "country check" });
  assert.match(calls.get[0], /[?&]country=[A-Z]{2}/, calls.get[0]);
});

await t("a result is cached, and an empty one is not", async () => {
  reset();
  await discover.search({ scope: "auto", phrase: "cached phrase" });
  await discover.search({ scope: "auto", phrase: "cached phrase" });
  assert.equal(calls.get.length, 1, "the second identical search should not hit the wire");

  cacheClear();
  stubFetch(() => ({ body: { totalItems: 0, items: [] } }));
  await discover.search({ scope: "auto", phrase: "nothing yet" });
  const first = calls.get.length;
  await discover.search({ scope: "auto", phrase: "nothing yet" });
  assert.ok(calls.get.length > first, "a book added tomorrow should be findable tomorrow");
});

await t("one ISBN leads to every other edition of the same work", async () => {
  cacheClear();
  stubFetch(url => {
    if (/\/isbn\/\d/.test(url)) return { body: { key: "/books/OL1M", works: [{ key: "/works/OL796465W" }] } };
    if (url.includes("/editions.json")) {
      return { body: { entries: [
        { key: "/books/OL1M", isbn_13: ["9780062315007"], isbn_10: ["0062315005"], publishers: ["HarperOne"],
          languages: [{ key: "/languages/eng" }], publish_date: "2014", number_of_pages: 197 },
        { key: "/books/OL2M", isbn_13: ["9788845269110"], publishers: ["Vallardi"],
          languages: [{ key: "/languages/ita" }], publish_date: "2002" },
        { key: "/books/OL3M", isbn_13: ["9780061122415"], publishers: ["HarperCollins"],
          languages: [{ key: "/languages/eng" }], publish_date: "2006" }
      ] } };
    }
    return { body: {} };
  });

  const editions = await discover.otherEditions({ isbn13: "9780062315007", title: "The Alchemist" });
  assert.equal(editions.length, 3);
  // The one we came in on is flagged, so the list can say which is which.
  assert.equal(editions.find(e => e.isbn13 === "9780062315007").isMine, true);
  assert.equal(editions.find(e => e.isbn13 === "9788845269110").isMine, false);

  const italian = editions.find(e => e.isbn13 === "9788845269110");
  assert.equal(italian.language, "Italian");
  assert.equal(italian.publisher, "Vallardi");

  // Every ISBN the book is known by, so a shelf can be checked for all of them.
  const all = discover.editionIsbns(editions);
  assert.ok(all.includes("9788845269110") && all.includes("9780061122415") && all.includes("0062315005"));
});

await t("an edition's facts move as a set, never mixed between printings", async () => {
  cacheClear();
  stubFetch(url => {
    if (url.includes("/works/") && url.endsWith(".json") && !url.includes("editions")) {
      return { body: { key: "/works/OL796465W", description: "A shepherd." } };
    }
    if (url.includes("/editions.json")) {
      return { body: { entries: [
        { key: "/books/OL9M", isbn_13: ["9789754584158"], publishers: ["Can Yayinlari"],
          languages: [{ key: "/languages/tur" }], publish_date: "April 25, 2006" },
        { key: "/books/OL1M", isbn_13: ["9780062315007"], publishers: ["HarperOne"],
          languages: [{ key: "/languages/eng" }], publish_date: "2014", number_of_pages: 197,
          covers: [1] }
      ] } };
    }
    return { body: { totalItems: 0, items: [] } };
  });

  // The search doc's publisher belongs to whichever printing sorted first and
  // must not survive next to another edition's language.
  const full = await discover.details({
    id: "ol:/works/OL796465W", source: "openlibrary", workKey: "/works/OL796465W",
    title: "The Alchemist", authors: ["Paulo Coelho"], publisher: "Gelios", genres: []
  });
  assert.equal(full.publisher, "HarperOne", "the chosen edition's publisher, not the doc's");
  assert.equal(full.language, "English", "and its language, from the same edition");
  assert.equal(full.isbn13, "9780062315007");
});

await t("the trending feed retries without its parameter, then falls back", async () => {
  cacheClear();
  // A rejected query parameter is a 400, not an ignored argument.
  stubFetch(url => {
    if (url.includes("/trending/") && url.includes("limit=")) return undefined;
    if (url.includes("/trending/")) {
      return { body: { works: [{ key: "/works/OL1W", title: "Trending Book", author_name: ["Someone"] }] } };
    }
    return { body: { numFound: 0, docs: [] } };
  });

  const result = await discover.trending("weekly");
  assert.equal(result.source, "trending");
  assert.equal(result.items[0].title, "Trending Book");
});

await t("a dead trending feed shows books anyway, and says which", async () => {
  cacheClear();
  stubFetch(url => {
    if (url.includes("/trending/")) return undefined;
    if (url.includes("search.json")) {
      return { body: { numFound: 1, docs: [{ key: "/works/OL2W", title: "Most Read", author_name: ["A"] }] } };
    }
    return { body: { totalItems: 0, items: [] } };
  });

  const result = await discover.trending("daily");
  assert.equal(result.source, "readinglog", "the page must not go blank when one endpoint is down");
  assert.equal(result.items[0].title, "Most Read");
  assert.ok(calls.get.some(url => url.includes("sort=readinglog")));
  // The reason is carried out, not swallowed: a silent fallback cannot be reported.
  assert.ok(result.problems.length, "whatever failed upstream has to reach the screen");
});

await t("the subjects index is the last Open Library resort, because the chips prove it works", async () => {
  cacheClear();
  stubFetch(url => {
    if (url.includes("/trending/")) return undefined;
    if (url.includes("search.json")) return undefined;
    if (url.includes("/subjects/fiction.json")) {
      return { body: { work_count: 9, name: "Fiction", works: [{ key: "/works/OL5W", title: "Shelved Book", authors: [{ name: "C" }] }] } };
    }
    return { body: { totalItems: 0, items: [] } };
  });

  const result = await discover.trending("monthly");
  assert.equal(result.source, "subject");
  assert.equal(result.items[0].title, "Shelved Book");
  assert.equal(result.problems.length, 2, "both earlier failures are reported");
});

await t("when everything is down, the last feed that loaded is shown", async () => {
  cacheClear();
  // Something worked once...
  stubFetch(url => url.includes("/trending/") && !url.includes("limit=")
    ? { body: { works: [{ key: "/works/OL7W", title: "Kept Book", author_name: ["D"] }] } }
    : undefined);
  await discover.trending("yearly");

  // ...and now nothing does.
  cacheClear();
  stubFetch(() => undefined);
  const result = await discover.trending("yearly");
  assert.equal(result.source, "stale", "stale beats a blank page with an apology on it");
  assert.equal(result.items[0].title, "Kept Book");
});

await t("a browser error is translated into something you can act on", () => {
  // "Failed to fetch" and "signal is aborted" tell nobody what to do.
  assert.match(discover.explain("Failed to fetch"), /Open Library did not respond/);
  assert.match(discover.explain("signal is aborted without reason"), /timed out/);
  assert.match(
    discover.explain("HTTP 429: Quota exceeded for quota metric 'Queries' ... of service 'books.googleapis.com'"),
    /GOOGLE_BOOKS_KEY in js\/config\.js/
  );
  assert.match(discover.explain("HTTP 403: unknown location"), /GOOGLE_BOOKS_COUNTRY/);
});

await t("an ISBN ignores the filters entirely", async () => {
  cacheClear();
  serveIsbn();
  const result = await discover.search({ scope: "isbn", phrase: "9780062315007", filters: { sort: "rating", language: "eng" } });
  // One printing is one printing. Sorting it by rating is meaningless.
  assert.equal(result.scope, "isbn");
  assert.ok(!calls.get.some(u => u.includes("sort=rating")));
});

await t("only a quota refusal moves to the next key", async () => {
  const { outOfQuota } = await import("../../js/books/api.js");

  // Out of allowance on this project: the next one has its own.
  assert.equal(outOfQuota({ status: 429, message: "HTTP 429: Quota exceeded for quota metric 'Queries'" }), true);
  assert.equal(outOfQuota({ message: "rateLimitExceeded" }), true);

  // Not quota. Rotating on these would spend every key in turn and then report
  // the last one's error instead of the real fault, which is a line of config.
  assert.equal(outOfQuota({ status: 403, message: "unknown location" }), false);
  assert.equal(outOfQuota({ status: 404, message: "HTTP 404" }), false);
  assert.equal(outOfQuota({ message: "Failed to fetch" }), false);
});

done();
