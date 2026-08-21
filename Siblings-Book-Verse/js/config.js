// Every credential and constant lives here. Nothing else in the site hardcodes one.

// --- the spreadsheet --------------------------------------------------------
export const SHEET_ID = "17ppW5EKbs89bfTDyfU0kSshgyNkHqgyAszAaShSqxL0";
export const READ_GID = "0";
export const READLIST_GID = "798459865";

// Tab names, as Code.gs sees them. Must match the workbook exactly.
export const READ_TAB = "All Read Books";
export const READLIST_TAB = "Readlist";

// File > Share > Publish to web, CSV. Used only when the bridge is unreachable,
// and cached by Google for a few minutes.
export const PUBLISHED_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRHEji0MCywpiCqKw_aMNA2woVKKaU7VnBnbajgUvfU3Z2rIbHQUZghAZ867mXlpyHC-pw9TiSRmLSu/pub?output=csv";

// --- the write bridge -------------------------------------------------------
// Paste the /exec URL from Deploy > Manage deployments. Empty means read-only.
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwqinDFvHQWPcqSH0zSgBxrHdLn2UL_SmTFhN-nORKTxDeqIDCnZnv2M1d38o659L33Yw/exec";
// Must match SECRET in Code.gs. Public by design; see SETUP.txt section 7.
export const APPS_SCRIPT_TOKEN = "this-is-a-long-random-string-for-bookverse";

// Unlocks the write buttons in this browser. Empty means read-only.
export const OWNER_PASSWORD = "SPD@12345";
export const SESSION_HOURS = 72;

// --- who reads --------------------------------------------------------------
// `key` goes in the URL; `name` must match the "Read by Who ?" column exactly.
export const READERS = [
  { key: "siddhesh", name: "Siddhesh", photo: "assets/images/sidhu.jpeg", blurb: "Short stories, and anything with a twist" },
  { key: "pratiksha", name: "Pratiksha", photo: "assets/images/pratu.jpeg", blurb: "Non-fiction, romance, and quiet wisdom" },
  { key: "dhanashri", name: "Dhanashri", photo: "assets/images/dhanu.jpeg", blurb: "Fantasy, and one very long series" }
];

// --- the book APIs ----------------------------------------------------------
// Both are free and need no key. Google Books is rate limited per IP.
export const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1";
// NOT optional: Google answers 403 "unknown location" without it. ISO 3166-1.
export const GOOGLE_BOOKS_COUNTRY = "IN";
// Optional but strongly recommended. Without a key every anonymous browser on
// the internet shares ONE Google quota, and "Quota exceeded ... per day" is what
// running out of somebody else's allowance looks like. A free key from
// console.cloud.google.com (enable "Books API", then Credentials > API key)
// gives this site its own 1,000 a day. Restrict it to your domain.
// One or more. Each Google Cloud PROJECT gets its own daily allowance, so a
// second key is a second allowance; the site moves to the next one the moment
// Google answers "quota exceeded". See SETUP.txt before adding several.
export const GOOGLE_BOOKS_KEYS = [];
export const OPEN_LIBRARY_API = "https://openlibrary.org";
export const OPEN_LIBRARY_COVERS = "https://covers.openlibrary.org";


// --- tuning -----------------------------------------------------------------
export const PAGE_SIZE = 24;
export const CACHE_TTL_MS = 10 * 60 * 1000;
// Open Library is often slow before it is unavailable, and 12s was cutting off
// requests that would have arrived.
export const REQUEST_TIMEOUT_MS = 20000;

// Browse chips. Open Library subject slugs, with the label shown on screen.
export const SUBJECTS = [
  { label: "Fiction", slug: "fiction" },
  { label: "Fantasy", slug: "fantasy" },
  { label: "Romance", slug: "romance" },
  { label: "Mystery", slug: "mystery" },
  { label: "Thriller", slug: "thriller" },
  { label: "Short Stories", slug: "short_stories" },
  { label: "Biography", slug: "biography" },
  { label: "Self-Help", slug: "self-help" },
  { label: "History", slug: "history" },
  { label: "Science", slug: "science" },
  { label: "Poetry", slug: "poetry" },
  { label: "Horror", slug: "horror" },
  { label: "Philosophy", slug: "philosophy" },
  { label: "Young Adult", slug: "juvenile_fiction" }
];

export const SITE_NAME = "BookVerse";
