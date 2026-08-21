# Debugging

Every debug switch and check in one place. **Nothing here changes the sheet.**

For setup problems — CORS, bad tokens, a bridge that will not answer — see [SETUP.md](SETUP.md#troubleshooting) instead.

---

## 1. URL switches

### `?dupes=1` on watched.html

Why the page and the sheet disagree about how many titles there are.

The page counts **distinct titles**; the sheet counts **rows**. `firstSeen()` in `js/data/identity.js` collapses any two rows sharing a TMDB id, or a title and year, because a re-watch is one title and the per-industry buckets have to sum to the total rather than exceed it. So 1,043 rows can be 1,042 titles, and Bollywood can read one short of its own column with nothing saying why.

This lists every collapse above the grid: the row that was dropped, the row it merged into, and the key they had in common. **The key is the diagnosis:**

| Key | Meaning | Fix |
|---|---|---|
| `id:20453` | A TMDB id was pasted onto two different rows | A typo — fix the wrong id and the count corrects itself |
| `t:ved\|2022` | Two rows agree on title and year | Either a genuine second entry (delete the spare row) or two different films sharing a title and release year, which is the accepted cost of title-plus-year identity |

To tell two films apart, compare their ids at `themoviedb.org/movie/<id>`.

```
https://laxman-sidhu.github.io/SidCinema/watched.html?dupes=1
```

Add it with `&` rather than `?` when the URL already has a query:

```
watched.html?view=favorite&dupes=1
```

### `?view=favorite` and `?view=must_watch` on watched.html

Not debug switches — the library's two flag views. Listed here because they are the reason `?dupes=1` sometimes needs an `&` instead of a `?`.

---

## 2. From the browser console

The last read of the sheet is in localStorage, so these need no deploy and no network. Open the page, press F12, use the Console tab.

**What the site last read:**

```javascript
JSON.parse(localStorage.getItem("sidcinema-snapshot-watched-v2")).rows.length
JSON.parse(localStorage.getItem("sidcinema-snapshot-watchlist-v2")).rows.length
```

**Force a cold read, discarding the snapshot:**

```javascript
Object.keys(localStorage).filter(k => k.startsWith("sidcinema-snapshot-"))
  .forEach(k => localStorage.removeItem(k)); location.reload();
```

**Sign out of the owner session:**

```javascript
Object.keys(localStorage).filter(k => k.startsWith("sidcinema-auth"))
  .forEach(k => localStorage.removeItem(k)); location.reload();
```

---

## 3. From the Apps Script editor

Open the workbook, then **Extensions → Apps Script**. Select the function in the dropdown and press **Run**, then read the execution log.

| Function | What it does |
|---|---|
| `testSetup()` | Reads all three tabs and reports row counts and the columns it matched. The first thing to run when a column looks wrong. Changes nothing. |
| `cleanWatchlist()` | Removes duplicate Watchlist rows and any row for something already in All Watched, keeping the first of each title. Logs what it removed. **This one does change the sheet** — File → Version history undoes it. |

---

## 4. Checking the bridge itself

Open the `/exec` URL directly in a browser. It should answer with JSON rather than a Google sign-in page.

| URL | Expected |
|---|---|
| `<APPS_SCRIPT_URL>` | A short "bridge is deployed" message |
| `<APPS_SCRIPT_URL>?action=read` | All three tabs as JSON |

A sign-in page means the deployment is not set to **Who has access: Anyone**.

---

## 5. Running the tests

Nine suites in `assets/tests/`. Seven run with plain node and need nothing installed:

```bash
for t in logic data watchlist people nav cardbar css; do
  node assets/tests/$t.test.mjs
done
```

`flow.test.mjs` and `modal.test.mjs` boot a real page in a real DOM and need jsdom (`npm install jsdom`); both skip cleanly without it.

**134 assertions without jsdom, 157 with.**

`css.test.mjs` is the one worth running after any styling change — the bugs this stylesheet produces are silent ones, and it checks for the specific shapes they take. See [PROJECT_DESCRIPTION.md](PROJECT_DESCRIPTION.md#tests) for what each suite covers.
