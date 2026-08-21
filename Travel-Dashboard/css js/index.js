    /* ============================================================
       WANDERLOG - Travel Dashboard
       Single-file JS application.
       Data: Google Sheets CSV (via PapaParse) with fallback to
       embedded sample data so the dashboard works out-of-the-box.
       ============================================================ */
    (() => {
      'use strict';

      /* ============================================================
         1. CONFIG - Google Sheet endpoints.
         The dashboard auto-refreshes from the sheet every REFRESH_MS.
         It tries the published-to-web URL first (works whenever the sheet
         is "published to web"), then falls back to /export?format=csv
         (works whenever the sheet is shared as "anyone with the link").
         ============================================================ */
      const CONFIG = {
        // The long token after /d/e/ that you get from File → Share → Publish to web
        PUB_TOKEN: "2PACX-1vRu5WZo8jYshhWVSUIYIHqWZFcwOC2tWeeQcJMowqYw5LG7CMjecBMhGT9iHX8tnLFIp6ob44QbJ6Ge",
        // The sheet ID (the /d/<this>/edit part of a normal Google Sheets URL)
        SHEET_ID: "1CtRBUNbgxf-Z-pEfwoKW9O5NTCUxTsbpTGBrfox9gSk",
        // Per-tab gid values (you find these in each tab's URL #gid=NNN)
        GID_PLACES: "0",
        GID_MONUMENTS: "1402125017",
        GID_GOALS: "1347265050",
        GID_ACTIVITIES: "1385001527",
        GID_TREKS: "726959271",
        REFRESH_MS: 5 * 60 * 1000,   // re-fetch every 5 minutes
      };

      /* ============================================================
         EMAILJS CONFIG - fill these in from your EmailJS dashboard
         ------------------------------------------------------------
         1. Sign up at https://www.emailjs.com (free tier is fine)
         2. Add an email service (Gmail / Outlook / etc.) - note the SERVICE ID
         3. Create an email template (suggested template variables below)
         4. Copy your PUBLIC KEY from Account → General
         ------------------------------------------------------------
         Recommended template body in the EmailJS dashboard:
      
         Subject:  New postcard from {{from_name}} - trip to {{destination}}
      
         Body:
         Hi Sid,
      
         A new postcard just landed.
      
             Name:        {{from_name}}
             Trip type:   {{trip_type}}
             Destination: {{destination}}
             Contact:     {{contact_info}}
      
         Message:
         {{message}}
      
         ------------------------------------------------------------
         The form below sends these exact variables:
           from_name, destination, trip_type, message, contact_info
         ============================================================ */
      const EMAILJS_CONFIG = {
        PUBLIC_KEY: "RVmNzVgh6Ro61mHV2",
        SERVICE_ID: "service_9u1wy35",
        TEMPLATE_ID: "template_h03u18v",
      };

      // Two endpoint shapes; we try in order until one returns rows.
      const csvUrls = (gid) => [
        // Published-to-web URL (works whenever File → Publish to web is enabled)
        `https://docs.google.com/spreadsheets/d/e/${CONFIG.PUB_TOKEN}/pub?output=csv&gid=${gid}&single=true`,
        // Direct export URL (works whenever the sheet is shared "Anyone with link")
        `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${gid}`,
      ];


      /* ============================================================
         3. UTILITIES
         ============================================================ */
      const $ = (sel, root = document) => root.querySelector(sel);
      const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

      const truthy = (v) => {
        if (v === true) return true;
        if (v === false || v === null || v === undefined || v === '') return false;
        const s = String(v).trim().toLowerCase();
        return s === 'true' || s === 'yes' || s === '1' || s === 'done' || s === 'completed' || s === 'complete';
      };

      /* ---------------------------------------------------------------------------
         DATES
         ---------------------------------------------------------------------------
         Everything arrives from the sheet as CSV text, so there are no Date objects
         to lean on - only whatever string the cell *displays*. `new Date(str)` is the
         wrong tool for that: it reads slash dates as US M/D/Y, so "1/12/2024" came
         back as 12 January instead of 1 December, and "25/12/2024" came back Invalid
         (which silently blanked the date chip). This parser handles the shapes the
         sheet actually produces and prefers DD/MM, disambiguating whenever it can.
         --------------------------------------------------------------------------- */
      const MONTH_IDX = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      };

      const mkDate = (y, mon, day) => {
        const d = new Date(y, mon, day || 1);
        return isNaN(d) ? null : d;
      };

      const parseDate = (v) => {
        if (!v) return null;
        if (v instanceof Date) return isNaN(v) ? null : v;
        const s = String(v).trim();
        if (!s) return null;

        // ISO-ish: 2024-12-01 / 2024-12
        let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
        if (m) return mkDate(+m[1], +m[2] - 1, +(m[3] || 1));

        // Numeric with separators: 1/12/2024, 25-12-2024, 01.12.2024
        m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
        if (m) {
          const a = +m[1], b = +m[2];
          let y = +m[3];
          if (y < 100) y += (y < 50 ? 2000 : 1900);
          let day, mon;
          if (a > 12) { day = a; mon = b; }        // 25/12 -> must be DD/MM
          else if (b > 12) { mon = a; day = b; }   // 12/25 -> must be MM/DD
          else { day = a; mon = b; }               // ambiguous -> DD/MM (sheet locale)
          if (mon < 1 || mon > 12) return null;
          return mkDate(y, mon - 1, day);
        }

        // Word months: "Dec 2024", "December 2024", "12 Dec 2024", "Dec 12, 2024"
        const t = s.toLowerCase().replace(/,/g, ' ');
        const mo = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
        const yr = t.match(/\b(\d{4})\b/);
        if (mo && yr) {
          const dy = t.match(/\b(\d{1,2})\b/);     // \b guards against matching inside "2024"
          return mkDate(+yr[1], MONTH_IDX[mo[1]], dy ? +dy[1] : 1);
        }
        if (yr && !mo) return mkDate(+yr[1], 0, 1);  // bare year

        const d = new Date(s);
        return isNaN(d) ? null : d;
      };

      /* A cell may hold one line per visit ("Dec 2024\nMay 2026"). Sheets forces such
         a cell to plain text and Papa keeps the newline inside the quoted field, so it
         arrives verbatim. Split it into trimmed, non-empty parts. */
      const splitCell = (v) => String(v == null ? '' : v)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s !== '');

      /* The newest date in a (possibly multi-line) cell - used for sorting and display. */
      const latestDateIn = (v) => {
        const ds = splitCell(v).map(parseDate).filter(Boolean);
        if (!ds.length) return null;
        return ds.reduce((a, b) => (b > a ? b : a));
      };

      const toNum = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(String(v).replace(/,/g, '').trim());
        return isNaN(n) ? null : n;
      };

      const fmtDate = (d) => {
        if (!d) return '';
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      };
      const fmtDateShort = (d) => {
        if (!d) return '';
        return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      };

      /* Canonical column names per tab. Each entry maps the canonical name
         to a list of acceptable aliases (case-insensitive, whitespace-insensitive).
         When a sheet row comes in, we rewrite its keys to the canonical form.
         This is what makes column reordering, header whitespace, and minor
         renames safe - the downstream code can always say row["Visit Date"]. */
      const SCHEMA = {
        Places: {
          "Place": ["place", "destination", "city"],
          "State": ["state"],
          "Region": ["region"],
          "Country": ["country"],
          "Status": ["status", "visited"],
          "Visit Date": ["visit date", "date visited", "visited date", "date"],
          "Type": ["type", "category"],
          "Travel With": ["travel with", "companions", "with"],
          "Famous For": ["famous for", "known for"],
          "Trip Duration (Days)": ["trip duration (days)", "duration (days)", "trip duration", "days"],
          "Rating": ["rating", "stars"],
          "Best Memory": ["best memory", "memory", "highlight"],
          "Image_URL": ["image_url", "image url", "image", "photo", "photo url", "thumbnail", "img"],
          "Carousel_Images": ["carousel_images", "carousel images", "carousel", "images", "gallery", "additional images", "more images"],
        },
        Monuments: {
          "Monument / Landmark": ["monument / landmark", "monument", "landmark", "name"],
          "Place": ["place", "city"],
          "State": ["state"],
          "Region": ["region"],
          "Country": ["country"],
          "Status": ["status", "visited"],
          "Visit Date": ["visit date", "date visited", "date"],
          "Famous For": ["famous for", "known for"],
          "Image_URL": ["image_url", "image url", "image", "photo", "photo url", "img"],
          "Carousel_Images": ["carousel_images", "carousel images", "carousel", "images", "gallery", "additional images", "more images"],
        },
        Goals: {
          "Goal": ["goal", "name", "title"],
          "Target": ["target"],
          "Progress": ["progress"],
          "Status": ["status"],
          "Completed": ["completed", "is completed", "done"],
          "Difficulty Level": ["difficulty level", "difficulty"],
          "Category": ["category"],
          "Notes": ["notes", "note", "details"],
        },
        Activities: {
          "Activity": ["activity", "name"],
          "Category": ["category", "type"],
          "Completion Status": ["completion status", "completed", "status", "done"],
          "Date Done": ["date done", "date completed", "completed date", "date"],
          "Location": ["location", "place"],
          "Image_URL": ["image_url", "image url", "image", "photo", "photo url", "img"],
          "Carousel_Images": ["carousel_images", "carousel images", "carousel", "images", "gallery", "additional images", "more images"],
        },
        Treks: {
          "Trek": ["trek", "trek name", "name", "peak", "summit", "trail"],
          "Place": ["place", "base village", "base", "city", "start point", "starting point"],
          "State": ["state"],
          "Region": ["region"],
          "Country": ["country"],
          "Status": ["status", "completed", "done", "summited", "trekked"],
          "Visit Date": ["visit date", "date", "date done", "summit date", "trek date", "completed date"],
          "Famous For": ["famous for", "known for", "highlights", "highlight"],
          "Image_URL": ["image_url", "image url", "image", "photo", "photo url", "thumbnail", "img"],
          "Carousel_Images": ["carousel_images", "carousel images", "carousel", "images", "gallery", "additional images", "more images"],
        },
      };

      /* Build a quick lookup: lowercased-trimmed-alias → canonical name.
         The result depends only on the (constant) schema, so it's memoized per
         schema object - previously this was rebuilt for every row of every sheet. */
      const _aliasMapCache = new WeakMap();
      function buildAliasMap(schemaForTab) {
        const cached = _aliasMapCache.get(schemaForTab);
        if (cached) return cached;
        const map = {};
        for (const [canonical, aliases] of Object.entries(schemaForTab)) {
          for (const alias of aliases) {
            map[alias.toLowerCase().trim()] = canonical;
          }
          // Also map the canonical name itself to itself
          map[canonical.toLowerCase().trim()] = canonical;
        }
        _aliasMapCache.set(schemaForTab, map);
        return map;
      }

      /* Apply schema: rewrite row keys to canonical names. Unknown columns are kept as-is. */
      function applySchema(row, schemaForTab) {
        if (!row || !schemaForTab) return row;
        const aliasMap = buildAliasMap(schemaForTab);
        const out = {};
        for (const k of Object.keys(row)) {
          const canonical = aliasMap[String(k).toLowerCase().trim()] || k;
          out[canonical] = row[k];
        }
        return out;
      }

      /* Normalize a raw PapaParse row: trim whitespace from headers and string values,
         filter out completely-empty rows. Returns the cleaned row, or null if empty. */
      const normalizeRow = (row) => {
        if (!row) return null;
        const out = {};
        let hasContent = false;
        for (const k of Object.keys(row)) {
          const cleanKey = String(k).trim();
          let v = row[k];
          if (typeof v === 'string') v = v.trim();
          out[cleanKey] = v;
          if (v !== '' && v !== null && v !== undefined) hasContent = true;
        }
        return hasContent ? out : null;
      };

      const unique = (arr) => Array.from(new Set(arr.filter(x => x !== null && x !== undefined && x !== '')));
      const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
      const avg = (arr) => arr.length ? sum(arr) / arr.length : 0;

      const initials = (s) => {
        if (!s) return '?';
        return s.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
      };

      /* Escape a value before it goes into an innerHTML template. */
      const escHtml = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const showBanner = (text, persist = false) => {
        const b = $('#loadingBanner');
        $('#loadingText').textContent = text;
        b.classList.add('show');
        if (!persist) setTimeout(() => b.classList.remove('show'), 2200);
      };
      const hideBanner = () => $('#loadingBanner').classList.remove('show');

      /* Animated counter from 0 → target */
      const animateCount = (el, target, duration = 1400) => {
        if (target === 0 || target === null || target === undefined) {
          el.textContent = '0';
          return;
        }
        const start = performance.now();
        const startVal = 0;
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          const val = Math.round(startVal + (target - startVal) * eased);
          el.textContent = val.toLocaleString();
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      /* ============================================================
         4. DATA FETCH - Google Sheets via PapaParse.
         Tries published-to-web URL first, falls back to /export.
         Normalizes rows and trims headers so column reordering or
         stray whitespace in headers won't break analytics.
         ============================================================ */

      // Try a single URL with PapaParse. Resolves with cleaned rows + meta,
      // or rejects with details we can show in the diagnostic panel.
      function fetchCsvFromUrl(url, schemaForTab) {
        return new Promise((resolve, reject) => {
          Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: 'greedy',  // skip rows where every field is empty
            transformHeader: (h) => String(h).trim(),  // strip header whitespace
            complete: (res) => {
              // Clean each row: trim values, drop empty rows, then rewrite keys
              // to canonical names so the rest of the app is column-order-proof.
              const rows = (res.data || [])
                .map(normalizeRow)
                .filter(Boolean)
                .map(r => applySchema(r, schemaForTab));
              resolve({ rows, url, meta: res.meta, errors: res.errors });
            },
            error: (err) => reject({ url, err }),
          });
        });
      }

      // Try each URL shape until one returns rows.
      async function fetchSheet(gid, label, schemaForTab) {
        const urls = csvUrls(gid);
        let lastErr = null;
        for (const url of urls) {
          try {
            const result = await fetchCsvFromUrl(url, schemaForTab);
            if (result.rows.length > 0) {
              return { ...result, label, ok: true };
            }
            lastErr = `${label}: 0 rows from ${url.split('?')[0].slice(-30)}`;
          } catch (e) {
            lastErr = `${label}: fetch failed - ${e.err?.message || 'network error'}`;
          }
        }
        return { rows: [], label, ok: false, error: lastErr };
      }

      async function loadAllData() {
        showBanner('Preparing my travel journal…', true);
        const results = await Promise.all([
          fetchSheet(CONFIG.GID_PLACES, 'Places', SCHEMA.Places),
          fetchSheet(CONFIG.GID_MONUMENTS, 'Monuments', SCHEMA.Monuments),
          fetchSheet(CONFIG.GID_GOALS, 'Goals', SCHEMA.Goals),
          fetchSheet(CONFIG.GID_ACTIVITIES, 'Activities', SCHEMA.Activities),
          fetchSheet(CONFIG.GID_TREKS, 'Treks', SCHEMA.Treks),
        ]);
        hideBanner();

        // Surface a diagnostic panel so the user can see exactly what loaded
        renderDiagnostic(results);

        const [pRes, mRes, gRes, aRes, tRes] = results;
        const allEmpty = results.every(r => r.rows.length === 0);
        if (allEmpty) {
          showBanner('⚠ Unable to load my travel data right now', true);
        } else {
          showBanner('✓ My travel journal is ready');
        }

        return {
          places: pRes.rows,
          monuments: mRes.rows,
          goals: gRes.rows,
          activities: aRes.rows,
          treks: tRes.rows,
          _diagnostic: results,
        };
      }

      // Render a small diagnostic card showing what loaded (or didn't)
      function renderDiagnostic(results) {
        const panel = $('#diagPanel');
        if (!panel) return;
        const allOk = results.every(r => r.ok && r.rows.length > 0);
        if (allOk) {
          panel.classList.remove('show');
          return;
        }
        panel.classList.add('show');
        panel.innerHTML = `
    <div class="diag-head">
      <strong>⚠ Some sheet tabs didn't load</strong>
      <button class="diag-close" onclick="this.parentElement.parentElement.classList.remove('show')">×</button>
    </div>
    <div class="diag-body">
      ${results.map(r => `
        <div class="diag-row ${r.rows.length > 0 ? 'ok' : 'fail'}">
          <span class="diag-label">${r.label}</span>
          <span class="diag-count">${r.rows.length} rows</span>
          ${r.error ? `<span class="diag-err">${r.error}</span>` : ''}
        </div>
      `).join('')}
      <div class="diag-tip">
        <strong>Fix:</strong> Open the sheet → Share → set "Anyone with the link" to Viewer.
        Also confirm File → Share → <em>Publish to web</em> is enabled for the entire document.
      </div>
    </div>
  `;
      }

      /* ============================================================
         5. ANALYTICS - All derived metrics live here.
         ============================================================ */

      /* ---------------------------------------------------------------------------
         MULTI-VISIT MODEL
         ---------------------------------------------------------------------------
         One row = one PLACE, not one trip. A place you went back to keeps its single
         row; the per-visit columns just gain a line each, and line N of every column
         describes the same trip:

             Visit Date     Trip Duration    Travel With    (Rating, Best Memory too)
             Dec 2024   →        2        →    Family        ← visit 1
             May 2026   →        4        →    Friends       ← visit 2

         A column holding a single value applies to every visit, so you only repeat
         yourself when something actually changed.

         The split that follows from this:
           · PLACE-level stats dedupe   - Munnar is 1 place, 1 map pin, 1 card
           · VISIT-level stats iterate  - 6 total days, and it shows in BOTH 2024 & 2026
         --------------------------------------------------------------------------- */
      function buildVisits(row) {
        const dates = splitCell(row['Visit Date']);
        const durs = splitCell(row['Trip Duration (Days)']);
        const withs = splitCell(row['Travel With']);
        const rates = splitCell(row['Rating']);
        const mems = splitCell(row['Best Memory']);

        const n = Math.max(1, dates.length, durs.length, withs.length, rates.length, mems.length);
        // One value -> applies to every visit. Several -> line up by index.
        const at = (arr, i) => !arr.length ? '' : (arr.length === 1 ? arr[0] : (arr[i] !== undefined ? arr[i] : ''));

        const visits = [];
        for (let i = 0; i < n; i++) {
          visits.push({
            date: parseDate(at(dates, i)),
            days: toNum(at(durs, i)),
            companion: at(withs, i),
            rating: toNum(at(rates, i)),
            memory: at(mems, i),
          });
        }
        return visits;
      }

      /* Attach the visit list + the place-level values derived from it. */
      function withVisits(p) {
        const visits = buildVisits(p);
        const dated = visits.filter(v => v.date);
        const ratings = visits.map(v => v.rating).filter(r => r !== null);
        return {
          ...p,
          _visits: visits,
          _dates: dated.map(v => v.date).sort((a, b) => b - a),   // newest first
          _latest: dated.length ? dated.reduce((a, v) => (v.date > a ? v.date : a), dated[0].date) : null,
          _totalDays: sum(visits.map(v => v.days || 0)),
          _tripCount: dated.length || 1,
          _companions: unique(visits.map(v => v.companion)),
          _memories: unique(visits.map(v => v.memory)),
          _rating: ratings.length ? avg(ratings) : null,
        };
      }

      function computeAnalytics(data) {
        const places = (data.places || []).map(withVisits);
        const monuments = data.monuments || [];
        const goals = data.goals || [];
        const activities = data.activities || [];
        const treks = data.treks || [];

        // Filter to completed only
        const visitedPlaces = places.filter(p => truthy(p.Status));
        const visitedMonuments = monuments.filter(m => truthy(m.Status));
        const doneActivities = activities.filter(a => truthy(a['Completion Status']));
        const completedGoals = goals.filter(g => truthy(g.Completed) || (g.Status || '').toLowerCase() === 'completed');
        const summitedTreks = treks.filter(t => truthy(t.Status));

        // Counters
        // States are counted only for India - international travel adds to countries instead.
        const isIndia = (p) => (p.Country || '').toString().toLowerCase().trim() === 'india';
        const states = unique(visitedPlaces.filter(isIndia).map(p => p.State));
        const countries = unique(visitedPlaces.map(p => p.Country));
        const regions = unique(visitedPlaces.map(p => p.Region));

        /* Every individual trip, flattened out of the places. A place visited twice
           contributes two entries here but stays ONE place in the counters above. */
        const allVisits = [];
        visitedPlaces.forEach(p => p._visits.forEach(v => allVisits.push({ ...v, place: p })));

        const totalDays = sum(visitedPlaces.map(p => p._totalDays));   // 2 + 4 = 6
        const ratings = visitedPlaces.map(p => p._rating).filter(r => r !== null);
        const avgRating = ratings.length ? (avg(ratings)).toFixed(1) : 0;
        const tripCount = sum(visitedPlaces.map(p => p._tripCount));

        // Most common state, type, companion (also India-only for state ranking)
        const counterOf = (arr, key) => {
          const m = {};
          arr.forEach(item => {
            const v = (item[key] || '').toString().trim();
            if (v) m[v] = (m[v] || 0) + 1;
          });
          return Object.entries(m).sort((a, b) => b[1] - a[1]);
        };
        const stateCounter = counterOf(visitedPlaces.filter(isIndia), 'State');
        const typeCounter = counterOf(visitedPlaces, 'Type');
        const regionCounter = counterOf(visitedPlaces, 'Region');

        /* Companions are credited with a PLACE, deduped on the (person → place) pair.
           Munnar with Family in 2024 and Friends in 2026 gives each of them Munnar once.
           Munnar with Family BOTH times still gives Family Munnar once - it's one place,
           twice - so the tile never reads "2 places" and list "Munnar, Munnar". */
        const companionPlaces = {};
        visitedPlaces.forEach(p => {
          p._companions.forEach(c => {
            if (!c) return;
            (companionPlaces[c] = companionPlaces[c] || new Set()).add(p.Place || '-');
          });
        });
        const companionCounter = Object.entries(companionPlaces)
          .map(([name, set]) => [name, set.size])
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const companionPlaceMap = {};
        Object.entries(companionPlaces).forEach(([name, set]) => { companionPlaceMap[name] = Array.from(set); });

        /* By year / month - driven by VISITS, so a place you returned to lights up
           every year you went. */
        const byYear = {};
        const byMonth = Array(12).fill(0);
        const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        allVisits.forEach(v => {
          if (v.date) {
            const y = v.date.getFullYear();
            byYear[y] = (byYear[y] || 0) + 1;
            byMonth[v.date.getMonth()]++;
          }
        });

        // Rating distribution (1..5)
        const ratingDist = [1, 2, 3, 4, 5].map(r => ratings.filter(x => Math.round(x) === r).length);

        // Longest single trip
        const longestTrip = allVisits.reduce((best, v) => {
          const d = v.days || 0;
          return d > (best?.days || 0) ? { place: v.place.Place, days: d } : best;
        }, null);

        // Recent trips (last 6 by most recent visit)
        const recent = visitedPlaces
          .filter(p => p._latest)
          .sort((a, b) => b._latest - a._latest)
          .slice(0, 6);

        // Activity categories
        const actCategories = {};
        activities.forEach(a => {
          const c = a.Category || 'Other';
          if (!actCategories[c]) actCategories[c] = { total: 0, done: 0 };
          actCategories[c].total++;
          if (truthy(a['Completion Status'])) actCategories[c].done++;
        });

        return {
          raw: { places, monuments, goals, activities, treks, visitedPlaces, visitedMonuments, doneActivities, completedGoals, summitedTreks },
          counters: {
            placesVisited: visitedPlaces.length,
            placesPending: places.length - visitedPlaces.length,
            monuments: visitedMonuments.length,
            states: states.length,
            countries: countries.length,
            regions: regions.length,
            totalDays,
            avgRating,
            goalsCompleted: completedGoals.length,
            goalsTotal: goals.length,
            activitiesDone: doneActivities.length,
            activitiesTotal: activities.length,
            treksDone: summitedTreks.length,
            treksTotal: treks.length,
            trekStates: unique(summitedTreks.map(t => t.State)).length,
            trips: tripCount,
          },
          leaders: {
            topState: stateCounter[0] || null,
            topType: typeCounter[0] || null,
            topCompanion: companionCounter[0] || null,
            longestTrip,
          },
          breakdowns: {
            byYear, byMonth, MONTH_NAMES,
            typeCounter, regionCounter, ratingDist, stateCounter, companionCounter,
            companionPlaceMap,
            actCategories,
          },
          recent,
        };
      }

      /* ============================================================
         6. RENDERERS - One function per section
         ============================================================ */

      /* ----- 6a. Hero ticker ----- */
      function renderHeroStats(a) {
        // Populate the floating hero card with the most recently visited place
        const visited = (a.raw.places || []).filter(p => truthy(p.Status));
        let latest = null;
        let latestTime = -Infinity;
        visited.forEach(p => {
          if (p._latest && p._latest.getTime() > latestTime) { latestTime = p._latest.getTime(); latest = p; }
        });
        // Fallback: last visited in sheet order if no dates
        if (!latest && visited.length) latest = visited[visited.length - 1];

        const valEl = $('#hfcValue');
        const subEl = $('#hfcSub');
        if (valEl && latest) {
          valEl.textContent = latest.Place || '-';
          const d = latest._latest;
          subEl.textContent = d ? fmtDate(d) : (latest.State || 'in the journal');
        } else if (valEl) {
          valEl.textContent = a.counters.placesVisited + ' places';
          subEl.textContent = 'explored so far';
        }
      }

      /* ----- 6a-tris. Footer mini-stats ----- */
      function renderFooterStats(a) {
        const map = {
          places: a.counters.placesVisited,
          states: a.counters.states,
          monuments: a.counters.monuments,
          treks: a.counters.treksDone,
        };
        $$('#footerMiniStats [data-stat]').forEach(el => {
          const key = el.dataset.stat;
          animateCount(el, map[key] || 0);
        });
      }

      /* ----- 6b. KPI grid (clickable, each jumps to its section) ----- */
      function renderKPIs(a) {
        const cards = [
          { label: 'Places visited', num: a.counters.placesVisited, sub: `${a.counters.placesPending} on the wishlist`, icon: '📍', accent: 'var(--mocha)', accentSoft: 'rgba(163, 119, 78, 0.20)', accentPale: 'var(--mocha-pale)', target: '#places' },
          { label: 'Indian states', num: a.counters.states, sub: `Top: ${a.leaders.topState ? a.leaders.topState[0] : '-'}`, icon: '🗺️', accent: 'var(--sky)', accentSoft: 'rgba(91, 139, 191, 0.22)', accentPale: 'var(--sky-pale)', target: '#map-section' },
          { label: 'Countries', num: a.counters.countries, sub: `${a.counters.regions} regions covered`, icon: '🌏', accent: 'var(--coral)', accentSoft: 'rgba(217, 129, 89, 0.22)', accentPale: 'var(--coral-pale)', target: '#map-section' },
          { label: 'Goals achieved', num: a.counters.goalsCompleted, sub: `of ${a.counters.goalsTotal} on the list`, icon: '🎯', accent: 'var(--mint)', accentSoft: 'rgba(79, 157, 134, 0.32)', accentPale: 'var(--mint-pale)', target: '#goals' },
          { label: 'Activities done', num: a.counters.activitiesDone, sub: `of ${a.counters.activitiesTotal} adventures`, icon: '🧗', accent: 'var(--lavender)', accentSoft: 'rgba(134, 116, 192, 0.24)', accentPale: 'var(--lavender-pale)', target: '#activities' },
          { label: 'Treks completed', num: a.counters.treksDone, sub: `of ${a.counters.treksTotal} on the trail list`, icon: '🏔️', accent: 'var(--butter)', accentSoft: 'rgba(201, 154, 63, 0.30)', accentPale: 'var(--butter-pale)', target: '#treks' },
        ];
        $('#kpiGrid').innerHTML = cards.map(c => `
    <a href="${c.target}" class="kpi-card" style="--accent: ${c.accent}; --accent-soft: ${c.accentSoft}; --accent-pale: ${c.accentPale}">
      <div class="jump-arrow">↗</div>
      <div class="icon">${c.icon}</div>
      <div class="label">${c.label}</div>
      <div class="num" data-target="${c.num}">${c.num}</div>
      <div class="sub">${c.sub || ''}</div>
    </a>
  `).join('');

        // Animate KPI numbers
        $$('#kpiGrid .num').forEach(el => {
          const tgt = el.dataset.target;
          if (!isNaN(parseFloat(tgt)) && !String(tgt).includes('.')) {
            animateCount(el, parseInt(tgt));
          }
        });
      }

      /* ----- 6c-bis. Travelogue - "The journey, in numbers" (Wrapped) -----
         Place-based analytics (never counts "trips", since one journey can
         cover several places). Reuses the analytics object computed from the
         Google Sheet; renders only what the data supports and skips the rest. */
      let twDidAnimate = false;
      let twObserver = null;

      function renderWrapped(a) {
        const bentoEl = $('#twBento');
        const section = $('#wrapped');
        if (!bentoEl || !section) return;

        const visited = (a.raw.visitedPlaces || []);
        if (!visited.length) { section.style.display = 'none'; return; }
        section.style.display = '';

        const esc = (s) => String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const plc = (n) => `${n} ${n === 1 ? 'place' : 'places'}`;

        const typeCounter = a.breakdowns.typeCounter || [];
        const companionCounter = a.breakdowns.companionCounter || [];
        const regionCounter = a.breakdowns.regionCounter || [];
        const stateCounter = a.breakdowns.stateCounter || [];

        /* Map each category value -> list of place names (for tooltips & tags). */
        const placesByKey = (key) => {
          const m = {};
          visited.forEach(p => {
            const v = p[key];
            if (v === null || v === undefined || v === '') return;
            (m[v] = m[v] || []).push(p.Place || '-');
          });
          return m;
        };
        const byType = placesByKey('Type');
        const byRegion = placesByKey('Region');
        const byState = placesByKey('State');
        // Companions come pre-deduped on the (person -> place) pair, so a place you
        // visited twice with the same person is listed once, not twice.
        const byCompanion = a.breakdowns.companionPlaceMap || {};

        const tiles = [];

        /* Horizontal bar rows that reveal their places on hover / tap. */
        const barRows = (entries, max, placeMap) => entries.map(([name, n]) => {
          const w = Math.max(4, Math.round((n / max) * 100));
          const list = (placeMap[name] || []).join(', ');
          return `<div class="tw-row tw-pop" data-title="${esc(name)}" data-count="${plc(n)}" data-places="${esc(list)}" tabindex="0">
        <div class="tw-row-top"><span class="tw-row-name">${esc(name)}</span><span class="tw-row-val">${n}</span></div>
        <div class="tw-track"><div class="tw-fill" data-w="${w}"></div></div>
      </div>`;
        }).join('');

        // Tile: travel style (place types)
        if (typeCounter.length) {
          tiles.push(`
      <div class="tw-tile" style="--accent:var(--coral);--accent-soft:var(--coral-soft);--accent-pale:var(--coral-pale)" data-aos="fade-up">
        <div class="tw-tile-head"><span class="tw-tile-ic">🧭</span><span class="tw-tile-title">Travel style</span><span class="tw-tile-meta">${typeCounter.length} styles</span></div>
        <div class="tw-rows">${barRows(typeCounter.slice(0, 6), typeCounter[0][1], byType)}</div>
      </div>`);
        }

        // Tile: in good company (radial + place tags, reveals full list on hover / tap)
        if (companionCounter.length) {
          const totalWith = sum(companionCounter.map(c => c[1]));
          const R = 17, C = 2 * Math.PI * R;
          const ringAccents = ['var(--mint)', 'var(--lavender)', 'var(--butter)', 'var(--pink)', 'var(--sky)'];
          const rows = companionCounter.map(([name, n], i) => {
            const pct = totalWith ? Math.round((n / totalWith) * 100) : 0;
            const off = C * (1 - pct / 100);
            const all = byCompanion[name] || [];
            const shown = all.slice(0, 2).map(pn => `<span class="tw-chip">${esc(pn)}</span>`).join('');
            const more = all.length > 2 ? `<span class="tw-chip tw-more">+${all.length - 2}</span>` : '';
            return `<div class="tw-cmp tw-pop" style="--accent:${ringAccents[i % ringAccents.length]}" data-title="${esc(name)}" data-count="${plc(n)}" data-places="${esc(all.join(', '))}" tabindex="0">
          <div class="tw-cmp-ring">
            <svg viewBox="0 0 44 44">
              <circle class="track" cx="22" cy="22" r="${R}"></circle>
              <circle class="prog" cx="22" cy="22" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-off="${off.toFixed(1)}"></circle>
            </svg>
            <span class="tw-cmp-pct">${pct}%</span>
          </div>
          <div class="tw-cmp-main">
            <div class="tw-cmp-top"><span class="tw-cmp-name">${esc(name)}</span><span class="tw-cmp-cnt">${plc(n)}</span></div>
            <div class="tw-cmp-tags">${shown}${more}</div>
          </div>
        </div>`;
          }).join('');
          tiles.push(`
      <div class="tw-tile" style="--accent:var(--mint)" data-aos="fade-up" data-aos-delay="60">
        <div class="tw-tile-head"><span class="tw-tile-ic">🧑‍🤝‍🧑</span><span class="tw-tile-title">In good company</span></div>
        <div class="tw-comp-list">${rows}</div>
      </div>`);
        }

        // Tile: across the regions (horizontal bars)
        if (regionCounter.length) {
          tiles.push(`
      <div class="tw-tile" style="--accent:var(--lavender);--accent-soft:var(--lavender-soft);--accent-pale:var(--lavender-pale)" data-aos="fade-up" data-aos-delay="120">
        <div class="tw-tile-head"><span class="tw-tile-ic">🗺️</span><span class="tw-tile-title">Across the regions</span><span class="tw-tile-meta">${regionCounter.length} covered</span></div>
        <div class="tw-rows">${barRows(regionCounter, regionCounter[0][1], byRegion)}</div>
      </div>`);
        }

        // Tile: travel timeline (places explored per year) - full width
        const yearMap = {};
        visited.forEach(p => {
          (p._visits || []).forEach(v => {
            if (!v.date) return;
            const y = v.date.getFullYear();
            (yearMap[y] = yearMap[y] || []).push({ name: p.Place || '-', t: v.date.getTime() });
          });
        });
        const tlYears = Object.keys(yearMap).map(Number).sort((x, y) => x - y);
        if (tlYears.length) {
          const tlAccents = ['var(--pink)', 'var(--sky)', 'var(--coral)', 'var(--mint)', 'var(--lavender)', 'var(--butter)', 'var(--lime)'];
          const stops = tlYears.map((y, i) => {
            const items = yearMap[y].sort((p, q) => p.t - q.t);
            const n = items.length;
            const chips = items.map(it => `<span class="tw-chip">${esc(it.name)}</span>`).join('');
            const ac = tlAccents[i % tlAccents.length];
            return `<div class="tw-tl-stop" style="--accent:${ac}">
          <span class="tw-tl-node"></span>
          <div class="tw-tl-year">${y}</div>
          <div class="tw-tl-count"><span class="tw-tl-num" data-count="${n}">0</span> ${n === 1 ? 'place' : 'places'}</div>
          <div class="tw-tl-chips">${chips}</div>
        </div>`;
          }).join('');
          tiles.push(`
      <div class="tw-tile w6" style="--accent:var(--lavender);--accent-soft:var(--lavender-soft);--accent-pale:var(--lavender-pale)" data-aos="fade-up">
        <div class="tw-tile-head"><span class="tw-tile-ic">🗓️</span><span class="tw-tile-title">The journey, year by year</span><span class="tw-tile-meta">${tlYears[0]}–${tlYears[tlYears.length - 1]}</span></div>
        <div class="tw-timeline"><span class="tw-tl-line"></span><div class="tw-tl-stops">${stops}</div></div>
      </div>`);
        }

        // Tile: states leaderboard (full width) - each row reveals its places
        if (stateCounter.length) {
          const maxS = stateCounter[0][1];
          const rows = stateCounter.slice(0, 8).map(([name, n], i) => {
            const w = Math.max(4, Math.round((n / maxS) * 100));
            const topCls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
            const list = (byState[name] || []).join(', ');
            return `<div class="tw-lead-row tw-pop ${topCls}" data-title="${esc(name)}" data-count="${plc(n)}" data-places="${esc(list)}" tabindex="0">
          <span class="tw-rank">${i + 1}</span>
          <div class="tw-lead-body">
            <div class="tw-lead-top"><span class="tw-lead-name">${esc(name)}</span><span class="tw-lead-cnt">${plc(n)}</span></div>
            <div class="tw-track"><div class="tw-fill" data-w="${w}"></div></div>
          </div>
        </div>`;
          }).join('');
          tiles.push(`
      <div class="tw-tile w6" style="--accent:var(--butter);--accent-soft:var(--butter-soft)" data-aos="fade-up">
        <div class="tw-tile-head"><span class="tw-tile-ic">🏆</span><span class="tw-tile-title">States I've stepped in</span><span class="tw-tile-meta">${stateCounter.length} ${stateCounter.length === 1 ? 'state' : 'states'}</span></div>
        <div class="tw-lead">${rows}</div>
      </div>`);
        }

        bentoEl.innerHTML = tiles.join('');
        twAttachTips(section);

        /* ---------- animate on scroll into view (once) ---------- */
        const runAnims = () => {
          section.classList.add('tw-animate');
          $$('.tw-fill', section).forEach(el => { el.style.width = (el.dataset.w || 0) + '%'; });
          $$('.tw-cmp-ring .prog', section).forEach(el => { el.style.strokeDashoffset = el.dataset.off || 0; });
          $$('.tw-tl-num', section).forEach(el => animateCount(el, parseInt(el.dataset.count) || 0));
        };

        if (twDidAnimate) {
          runAnims();
        } else {
          if (twObserver) twObserver.disconnect();
          twObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(e => { if (e.isIntersecting) { runAnims(); twDidAnimate = true; obs.disconnect(); } });
          }, { threshold: 0.18 });
          twObserver.observe(section);
          setTimeout(() => {
            const r = section.getBoundingClientRect();
            if (!twDidAnimate && r.top < window.innerHeight && r.bottom > 0) {
              runAnims(); twDidAnimate = true;
              if (twObserver) twObserver.disconnect();
            }
          }, 600);
        }
      }

      /* Shared tooltip for the "in numbers" section - reveals the places behind a
         bar / ring on hover (desktop) and on tap (mobile, where hover doesn't exist). */
      let twTipReady = false;
      function twAttachTips(section) {
        let tip = document.getElementById('twTip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'twTip';
          tip.className = 'tw-tip';
          document.body.appendChild(tip);
        }
        const hoverCapable = !window.matchMedia || window.matchMedia('(hover: hover)').matches;

        const place = (x, y) => {
          const r = tip.getBoundingClientRect();
          const pad = 14;
          let left = x + pad, top = y + pad;
          if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
          if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
          tip.style.left = Math.max(8, left) + 'px';
          tip.style.top = Math.max(8, top) + 'px';
        };
        const show = (el, x, y) => {
          const title = el.dataset.title || '';
          const cnt = el.dataset.count || '';
          const places = el.dataset.places || '';
          tip.innerHTML = `<div class="tw-tip-h">${title}${cnt ? ` <span>· ${cnt}</span>` : ''}</div><div class="tw-tip-b">${places || '-'}</div>`;
          tip.classList.add('show');
          place(x, y);
        };
        const hide = () => { tip.classList.remove('show'); tip._for = null; };

        $$('.tw-pop', section).forEach(el => {
          if (hoverCapable) {
            el.addEventListener('mouseenter', e => show(el, e.clientX, e.clientY));
            el.addEventListener('mousemove', e => place(e.clientX, e.clientY));
            el.addEventListener('mouseleave', hide);
            el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top + r.height / 2); });
            el.addEventListener('blur', hide);
          }
          el.addEventListener('click', e => {
            e.stopPropagation();
            const r = el.getBoundingClientRect();
            if (tip.classList.contains('show') && tip._for === el) { hide(); }
            else { show(el, r.left + r.width / 2, r.top + Math.min(r.height, 40)); tip._for = el; }
          });
        });

        if (!twTipReady) {
          document.addEventListener('click', hide);
          window.addEventListener('scroll', () => { if (tip._for) hide(); }, { passive: true });
          twTipReady = true;
        }
      }

      /* ----- 6d. Places - Visited (with images) + Wishlist (text) ----- */
      let placesState = { search: '', type: '', tab: 'all', all: [], visitedRendered: [], wishlistRendered: [], latestKey: '' };

      function renderPlaces(a) {
        placesState.all = a.raw.places;

        // Most recent visit anywhere -> that card gets the "Latest" sticker
        let latest = null, latestTime = -Infinity;
        a.raw.places.filter(p => truthy(p.Status)).forEach(p => {
          if (p._latest && p._latest.getTime() > latestTime) { latestTime = p._latest.getTime(); latest = p; }
        });
        placesState.latestKey = latest ? String(latest.Place || '') : '';

        // Populate type filter (preserve the current selection across refreshes)
        const typeSel = $('#placeTypeFilter');
        const types = unique(a.raw.places.map(p => p.Type)).sort();
        const keepType = placesState.type;
        typeSel.innerHTML = '<option value="">All types</option>' +
          types.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
        typeSel.value = types.includes(keepType) ? keepType : '';
        placesState.type = typeSel.value;

        // Status dropdown, with counts baked into the labels
        const statusSel = $('#placeStatusFilter');
        if (statusSel) {
          const nVisited = a.raw.places.filter(p => truthy(p.Status)).length;
          const nWish = a.raw.places.length - nVisited;
          statusSel.innerHTML = `
        <option value="all">All places (${a.raw.places.length})</option>
        <option value="visited">✓ Visited (${nVisited})</option>
        <option value="wishlist">◎ Wishlist (${nWish})</option>`;
          statusSel.value = placesState.tab;
        }

        applyPlaceFilters();
      }

      function applyPlaceFilters() {
        const { search, type, tab, all } = placesState;

        // Apply search + type filters to the master list first
        let filtered = all;
        if (type) filtered = filtered.filter(p => p.Type === type);
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(p =>
            (p.Place || '').toLowerCase().includes(q) ||
            (p.State || '').toLowerCase().includes(q) ||
            (p['Best Memory'] || '').toLowerCase().includes(q) ||
            (p['Famous For'] || '').toLowerCase().includes(q) ||
            (p.Country || '').toLowerCase().includes(q) ||
            (p['Travel With'] || '').toLowerCase().includes(q)
          );
        }

        // Split into visited and wishlist
        const visited = filtered
          .filter(p => truthy(p.Status))
          .sort((x, y) => (y._latest?.getTime() || 0) - (x._latest?.getTime() || 0));
        const wishlist = filtered
          .filter(p => !truthy(p.Status))
          .sort((x, y) => (x.Place || '').localeCompare(y.Place || ''));

        // Block counts (the tab totals now live in the status dropdown's labels)
        $('#visitedCount').textContent = visited.length;
        $('#wishlistCount').textContent = wishlist.length;

        // Show/hide blocks based on active tab
        const visitedBlock = $('#visitedBlock');
        const wishlistBlock = $('#wishlistBlock');
        const divider = $('#divider');
        if (tab === 'visited') {
          visitedBlock.classList.remove('hidden');
          wishlistBlock.classList.add('hidden');
          divider.classList.add('hidden');
        } else if (tab === 'wishlist') {
          visitedBlock.classList.add('hidden');
          wishlistBlock.classList.remove('hidden');
          divider.classList.add('hidden');
        } else {
          visitedBlock.classList.remove('hidden');
          wishlistBlock.classList.remove('hidden');
          divider.classList.remove('hidden');
        }

        renderVisitedCards(visited);
        renderWishlistCards(wishlist);
      }

      function renderVisitedCards(list) {
        const grid = $('#visitedGrid');
        if (list.length === 0) {
          grid.innerHTML = `<div class="empty-state"><p>No visited places match these filters.</p></div>`;
          return;
        }
        grid.innerHTML = list.map((p, i) => {
          const trips = p._tripCount || 1;
          const repeat = trips > 1;
          const date = p._latest;
          const duration = p._totalDays || null;
          const companions = (p._companions || []).filter(Boolean);
          const memory = (p._memories || []).filter(Boolean)[0] || '';
          const imgUrl = (p.Image_URL || '').trim();
          const hasImage = imgUrl && /^https?:\/\//i.test(imgUrl);
          return `
      <div class="visited-card" data-aos="fade-up" data-aos-delay="${(i % 6) * 50}" data-idx="${i}">
        <div class="image">
          ${hasImage
              ? `<img src="${imgUrl.replace(/"/g, '&quot;')}" alt="${p.Place}" loading="lazy" decoding="async" onerror="this.style.display='none';this.parentElement.classList.add('no-image');" />`
              : `<div class="image-fallback">${initials(p.Place)}</div>`
            }
          <div class="image-overlay"></div>
          ${placesState.latestKey && p.Place === placesState.latestKey ? `<span class="latest-sticker">◆ Latest</span>` : ''}
          ${repeat ? `<span class="repeat-badge" title="Visited ${trips} times">↺ ${trips} visits</span>` : ''}
          <div class="image-place">
            <h3>${p.Place}</h3>
            <div class="loc">${[p.State, p.Country !== 'India' ? p.Country : null].filter(Boolean).join(', ')}</div>
          </div>
        </div>
        <div class="body">
          ${p.Type ? `<span class="place-type">${p.Type}</span>` : ''}
          ${memory
              ? `<p class="memory">"${memory}"</p>`
              : (p['Famous For'] ? `<p class="memory" style="font-style:normal; border-left-color: var(--gold);">${p['Famous For']}</p>` : '')
            }
          <div class="meta">
            ${date ? `<span class="m-date">📅 ${fmtDateShort(date)}</span>` : ''}
            ${duration ? `<span class="m-dur">⏱️ ${duration}d</span>` : ''}
            ${companions.length ? `<span class="m-with">👥 ${escHtml(companions.join(' · '))}</span>` : ''}
          </div>
        </div>
      </div>
    `;
        }).join('');

        // Click handling is delegated from #visitedGrid (wired once in bindEvents);
        // we just record the list the cards were rendered from.
        placesState.visitedRendered = list;
      }

      function renderWishlistCards(list) {
        const grid = $('#wishlistGrid');
        if (list.length === 0) {
          grid.innerHTML = `<div class="empty-state"><p>Nothing on the wishlist matches.</p></div>`;
          return;
        }
        grid.innerHTML = list.map((p, i) => {
          const famousAttr = p['Famous For']
            ? ` data-famous="${String(p['Famous For']).replace(/"/g, '&quot;')}"` : '';
          return `
    <div class="wishlist-card" data-aos="fade-up" data-aos-delay="${(i % 6) * 40}" data-idx="${i}"${famousAttr}>
      <span class="wl-corner">↗</span>
      ${p.Type ? `<div class="wl-type">${p.Type}</div>` : ''}
      <h4>${p.Place}</h4>
      <div class="wl-loc">${[p.State, p.Country !== 'India' ? p.Country : null].filter(Boolean).join(', ')}</div>
    </div>
  `;
        }).join('');

        // Click handling is delegated from #wishlistGrid (wired once in bindEvents).
        placesState.wishlistRendered = list;
      }

      /* ===========================================================================
         MODAL IMAGE CONTROLLER
         ---------------------------------------------------------------------------
         The photo modal shows a single image from the record's Image_URL column.
         The image fills the stage: landscape images stretch to the full width,
         portrait images stretch to the full height (scaling up small/low-res
         sources, which may look soft - that's expected). If there's no valid
         image, the friendly empty state is shown instead.
         =========================================================================== */
      function fitModalImage() {
        const imgEl = $('#actModalImg');
        const stage = imgEl ? imgEl.parentElement : null;
        if (!imgEl || !stage) return;
        if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
        const stageRatio = stage.clientWidth / stage.clientHeight;
        const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight;
        if (imgRatio >= stageRatio) {
          // Wider than the stage → fill the full width
          imgEl.style.width = '100%';
          imgEl.style.height = 'auto';
        } else {
          // Taller than the stage → fill the full height
          imgEl.style.width = 'auto';
          imgEl.style.height = '100%';
        }
      }

      function setModalImage(url) {
        const imgEl = $('#actModalImg');
        const noImg = $('#actModalNoImg');
        const clean = (url == null ? '' : String(url)).trim();
        const isHttp = /^https?:\/\//i.test(clean);

        const showEmpty = () => {
          imgEl.onload = imgEl.onerror = null;
          imgEl.removeAttribute('src');
          imgEl.style.width = '';
          imgEl.style.height = '';
          imgEl.style.display = 'none';
          noImg.style.display = '';
        };

        if (!clean || !isHttp) { showEmpty(); return; }

        // Reset any sizing from a previous image; fitModalImage() picks the
        // fill axis once the real dimensions are known.
        imgEl.style.width = '';
        imgEl.style.height = '';
        imgEl.style.display = '';
        noImg.style.display = 'none';

        imgEl.onload = fitModalImage;
        imgEl.onerror = showEmpty;
        imgEl.fetchPriority = 'high';
        imgEl.src = clean;
        // Cached images may already be complete (onload won't fire) - fit now.
        if (imgEl.complete && imgEl.naturalWidth) fitModalImage();
      }


      /* ---------------------------------------------------------------------------
         THE PHOTO MODAL IS A PHOTO VIEWER.
         ---------------------------------------------------------------------------
         It shows the picture, the name, and a status tag - and for a place, the
         memory. Everything else (location, region, type, dates, "famous for") is
         already on the card you clicked, so repeating it here just crowded the
         image out. The meta row is deliberately left empty for every record type.
         --------------------------------------------------------------------------- */
      function openPlaceModal(p) {
        const modal = $('#actModal');
        if (!modal) return;

        const visited = truthy(p.Status);
        setModalImage(p.Image_URL);

        $('#actModalTitle').textContent = p.Place || '';
        $('#actModalStatus').innerHTML = visited
          ? `<span class="am-status done">\u2713 Visited</span>`
          : `<span class="am-status pending">On the wishlist</span>`;
        $('#actModalMeta').innerHTML = '';

        // A place you went back to can hold a memory per visit - show each of them.
        const mem = (p._memories || []).filter(Boolean);
        $('#actModalExtra').innerHTML = mem.length
          ? mem.map(m => `<div class="am-memory">\u201c${escHtml(m)}\u201d</div>`).join('')
          : '';

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }

      /* ----- 6e2. Monuments & Landmarks - heritage section with tab switcher ----- */
      /* ---------------------------------------------------------------------------
         Monuments state - region filter only (no pagination, all rows shown).
         --------------------------------------------------------------------------- */
      const monState = {
        region: 'all',  // 'all' | 'north' | 'south' | 'east' | 'west' | 'central'
        cache: { visited: [], wishlist: [], analytics: null },
        rendered: { visited: [], wishlist: [] },  // current region-filtered lists, for delegated clicks
      };

      function renderMonuments(a) {
        const monuments = a.raw.monuments || [];
        const visited = monuments.filter(m => truthy(m.Status));
        const wishlist = monuments.filter(m => !truthy(m.Status));

        // Cache for re-renders triggered by filter changes
        monState.cache.analytics = a;
        monState.cache.visited = visited;
        monState.cache.wishlist = wishlist;

        // Total counts on the tab pills + any summary spans
        $$('.ms-num[data-stat="mon-visited"]').forEach(el => el.textContent = visited.length);
        $$('.ms-num[data-stat="mon-pending"]').forEach(el => el.textContent = wishlist.length);
        $('#monVisitedCount').textContent = visited.length;
        $('#monWishlistCount').textContent = wishlist.length;

        /* Region dropdown, built from the sheet. Filtering compares the exact value,
           which also fixes a latent bug in the old pills: they matched by substring,
           so a "North East India" monument was caught by BOTH the North and East pills. */
        const sel = $('#monRegionFilter');
        if (sel) {
          const counts = {};
          monuments.forEach(m => {
            const r = String(m.Region || '').trim();
            if (r) counts[r] = (counts[r] || 0) + 1;
          });
          const regions = Object.keys(counts)
            .sort((x, y) => counts[y] - counts[x] || x.localeCompare(y));
          if (!regions.includes(monState.region)) monState.region = 'all';
          sel.innerHTML = `<option value="all">All regions (${monuments.length})</option>` +
            regions.map(r => `<option value="${escHtml(r)}">${escHtml(r)} (${counts[r]})</option>`).join('');
          sel.value = monState.region;
        }

        applyMonFilter();
      }

      /* Apply the current region filter to both visited + wishlist tables.
         Renders ALL matching rows - sticky header makes long lists scrollable. */
      function applyMonFilter() {
        const a = monState.cache.analytics;
        if (!a) return;

        const matchesRegion = (m) => monState.region === 'all'
          || String(m.Region || '').trim() === monState.region;

        const visitedAll = monState.cache.visited.filter(matchesRegion);
        const wishlistAll = monState.cache.wishlist.filter(matchesRegion);

        const regionClass = trekRegionClass;   // shared: checks "north east" before "north"

        const buildRow = (m, status, visIdx) => {
          const name = m['Monument / Landmark'] || 'Unnamed';
          const place = m.Place || '-';
          const region = m.Region || '-';
          const famous = (m['Famous For'] || '-').trim();
          const date = fmtDate(latestDateIn(m['Visit Date'])) || '-';
          const statusCell = status === 'wishlist'
            ? `<span class="mon-status-pill wishlist">◎ On the list</span>`
            : `<span class="mon-date-cell">${date}</span>`;
          return `
      <tr data-vis-idx="${visIdx}" role="button" tabindex="0">
        <td class="mon-name-cell">${name}</td>
        <td>${place}</td>
        <td><span class="region-pill ${regionClass(region)}">${region}</span></td>
        <td class="mon-famous-cell">${famous}</td>
        <td>${statusCell}</td>
        <td class="mon-view-cell"><span class="mon-view-arrow">↗</span></td>
      </tr>
    `;
        };

        // Visited table - render all matching rows
        const vBody = $('#monVisitedBody');
        if (visitedAll.length === 0) {
          const msg = monState.region === 'all'
            ? 'No monuments visited yet.'
            : `No visited monuments in ${monState.region}.`;
          vBody.innerHTML = `<tr><td colspan="6" class="mon-empty">${msg}</td></tr>`;
        } else {
          vBody.innerHTML = visitedAll.map((m, i) => buildRow(m, 'visited', i)).join('');
        }

        // Wishlist table - render all matching rows
        const wBody = $('#monWishlistBody');
        if (wishlistAll.length === 0) {
          const msg = monState.region === 'all'
            ? 'Nothing on the list yet.'
            : `Nothing on the list in ${monState.region}.`;
          wBody.innerHTML = `<tr><td colspan="6" class="mon-empty">${msg}</td></tr>`;
        } else {
          wBody.innerHTML = wishlistAll.map((m, i) => buildRow(m, 'wishlist', i)).join('');
        }

        // Record the lists the rows were rendered from; clicks/keys are delegated
        // from the table bodies (wired once in bindEvents), so arrows browse within
        // the same region-filtered table.
        monState.rendered.visited = visitedAll;
        monState.rendered.wishlist = wishlistAll;
      }

      /* Monument photo modal - photo + name + status, nothing else */
      function openMonumentModal(m) {
        if (!m) return;
        const modal = $('#actModal');
        if (!modal) return;

        setModalImage(m.Image_URL);

        $('#actModalTitle').textContent = m['Monument / Landmark'] || 'Unnamed';
        $('#actModalStatus').innerHTML = truthy(m.Status)
          ? `<span class="am-status done">\u2713 Visited</span>`
          : `<span class="am-status pending">On the list</span>`;
        $('#actModalMeta').innerHTML = '';
        $('#actModalExtra').innerHTML = '';

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }

      /* ----- 6f. Goals - Bucket List ----- */
      function renderGoals(a) {
        const goals = a.raw.goals;
        if (!goals || goals.length === 0) {
          $('#goalsGrid').innerHTML = `<div class="empty-state" style="color: rgba(254, 246, 239, 0.55);"><p>No goals yet - adventures to come.</p></div>`;
          $('#goalsCompletedPct').textContent = '0%';
          $('#featuredJourney').innerHTML = '';
          return;
        }

        // Completion percentage
        const completedCount = goals.filter(g => truthy(g.Completed) || (g.Status || '').toLowerCase() === 'completed').length;
        const overallPct = Math.round((completedCount / goals.length) * 100);
        $('#goalsCompletedPct').textContent = overallPct + '%';

        // Featured journey - prefer an in-progress goal whose target fits the 12-dot
        // display (target <= 12) so every dot is meaningful; fall back to most progress.
        const allCandidates = goals
          .filter(g => !truthy(g.Completed))
          .map(g => {
            const progress = toNum(g.Progress) || 0;
            const target = toNum((g.Target || '').match(/\d+/)?.[0]) || 1;
            return { g, progress, target };
          })
          .filter(x => x.progress > 0);

        // Prefer goals that fit cleanly in 12 dots (e.g. Jyotirlinga = 12): the goal
        // closest to filling all 12 dots wins the featured bar, then highest progress.
        const fitting = allCandidates.filter(x => x.target <= 12).sort((a, b) => (b.target - a.target) || (b.progress - a.progress));
        const rest = allCandidates.filter(x => x.target > 12).sort((a, b) => b.progress - a.progress);
        const candidates = [...fitting, ...rest];

        const fj = $('#featuredJourney');
        if (candidates.length > 0) {
          const f = candidates[0];
          const target = f.target;
          const dotCount = Math.min(target, 12);
          const dots = Array.from({ length: dotCount }, (_, i) =>
            `<div class="fj-dot ${i < Math.min(f.progress, dotCount) ? 'filled' : ''}"></div>`
          ).join('');
          // Pick an icon based on category
          const ICONS = { Travel: '🗺️', Adventure: '🏔️', Experience: '✨', Spiritual: '🕉️' };
          const icon = ICONS[f.g.Category] || '🎯';
          fj.innerHTML = `
      <div class="fj-icon">${icon}</div>
      <div class="fj-text">
        <div class="fj-title">${f.g.Goal}</div>
        <div class="fj-sub">${f.progress} of ${target} done · ${f.g.Category || 'Journey'}</div>
      </div>
      <div class="fj-progress">${dots}</div>
    `;
          fj.style.display = '';
        } else {
          fj.style.display = 'none';
        }

        // Goal cards
        $('#goalsGrid').innerHTML = goals.map((g, i) => {
          const isDone = truthy(g.Completed) || (g.Status || '').toLowerCase() === 'completed';
          const progress = toNum(g.Progress) || 0;
          const targetNum = toNum((g.Target || '').match(/\d+/)?.[0]) || 1;
          const pct = isDone ? 100 : Math.min(100, Math.round((progress / targetNum) * 100));
          const diff = (g['Difficulty Level'] || '').toLowerCase();
          const status = (g.Status || '').toLowerCase();
          // Started but not finished -> gets the yellow "in progress" highlight
          const inProgress = !isDone && (progress > 0 || status === 'in progress');

          let badge = '';
          if (isDone) badge = '';
          else if (inProgress) badge = `<span class="goal-badge b-progress">In Progress</span>`;
          else badge = `<span class="goal-badge b-pending">Not Started</span>`;

          const diffIcon = diff === 'easy' ? '🌱' : diff === 'medium' ? '⚡' : (diff === 'difficult' || diff === 'hard') ? '🔥' : '';
          const diffHtml = diff
            ? `<span class="goal-diff ${diff}">${diffIcon} ${g['Difficulty Level']}</span>`
            : `<span class="goal-diff-empty"></span>`;

          const notesAttr = g.Notes ? ` data-notes="${String(g.Notes).replace(/"/g, '&quot;')}"` : '';
          const notesIndicator = g.Notes ? `<span class="notes-indicator" title="Hover for notes">i</span>` : '';
          const catClass = g.Category ? '' : ' no-cat';

          return `
      <div class="goal-card${isDone ? ' completed' : (inProgress ? ' in-progress' : '')}${catClass}"${notesAttr} data-aos="fade-up" data-aos-delay="${(i % 3) * 80}">
        ${notesIndicator}
        <span class="cat">${g.Category || ' '}</span>
        <h4>${g.Goal}</h4>
        <div class="target">Target: ${g.Target || '-'}${progress ? ` · Done: ${progress}` : ''}</div>
        <div class="goal-progress"><div class="goal-progress-bar" data-pct="${pct}"></div></div>
        <div class="goal-meta">
          <span>${progress} / ${targetNum}</span>
          <span class="pct">${pct}%</span>
        </div>
        <div class="goal-spacer"></div>
        <div class="goal-footer">
          ${diffHtml}
          ${isDone ? '<span class="goal-check">✓</span>' : badge}
        </div>
      </div>
    `;
        }).join('');

        setTimeout(() => {
          $$('.goal-progress-bar').forEach(bar => {
            bar.style.width = bar.dataset.pct + '%';
          });
        }, 200);
      }

      /* ----- 6g. Activities ----- */
      let activityFilter = null; // null = show all; otherwise a Category string
      let activitiesRendered = []; // current (filtered) list the cards were built from, for delegated clicks

      function renderActivities(a) {
        const CAT_ICONS = { Water: '🌊', Air: '🪂', Snow: '❄️', Land: '🥾' };

        // Stats per category - these become CLICKABLE filter buttons
        const cats = a.breakdowns.actCategories;
        const showAllChip = activityFilter
          ? `<button class="show-all-chip" id="actShowAll">↻ Show all activities</button>`
          : '';

        $('#activityStats').innerHTML = Object.entries(cats).map(([cat, info]) => {
          const active = activityFilter === cat ? ' is-active' : '';
          return `
      <button class="activity-stat${active}" data-cat="${cat}" data-aos="fade-up">
        <div class="cat-icon">${CAT_ICONS[cat] || '🎯'}</div>
        <div class="num">${info.done} <span class="num-total">/ ${info.total}</span></div>
        <div class="label">${cat}</div>
      </button>
    `;
        }).join('') + showAllChip;

        // Wire up category filter clicks
        $$('#activityStats .activity-stat').forEach(el => {
          el.addEventListener('click', () => {
            const cat = el.dataset.cat;
            activityFilter = activityFilter === cat ? null : cat;
            renderActivities(a);
          });
        });
        const showAllBtn = $('#actShowAll');
        if (showAllBtn) {
          showAllBtn.addEventListener('click', () => {
            activityFilter = null;
            renderActivities(a);
          });
        }

        // Activity cards - filtered if category selected
        let activities = a.raw.activities;
        if (activityFilter) {
          activities = activities.filter(act => (act.Category || '') === activityFilter);
        }

        if (activities.length === 0) {
          $('#activitiesGrid').innerHTML = `<div class="empty-state"><p>No activities in this category yet.</p></div>`;
          return;
        }

        $('#activitiesGrid').innerHTML = activities.map((act, i) => {
          const done = truthy(act['Completion Status']);
          const cat = (act.Category || '').toLowerCase();
          const hasImg = !!(act.Image_URL && act.Image_URL.trim());
          return `
      <div class="activity-card ${done ? 'done' : 'pending'}${hasImg ? ' has-img' : ''}"
           data-aos="fade-up" data-aos-delay="${(i % 4) * 50}"
           data-vis-idx="${i}"
           role="button" tabindex="0">
        <div class="icon ${cat}">${CAT_ICONS[act.Category] || '🎯'}</div>
        <div class="card-body">
          <h5>${act.Activity}</h5>
          <div class="meta-text${done ? ' done-meta' : ''}">${done ? `${act.Location || ''}${act['Date Done'] ? ' · ' + fmtDateShort(parseDate(act['Date Done'])) : ''}` : 'Not done yet'}</div>
        </div>
        ${done ? '<span class="done-tick" aria-label="Completed">✓</span>' : ''}
      </div>
    `;
        }).join('');

        // Click/keyboard handling is delegated from #activitiesGrid (wired once in
        // bindEvents); arrows browse the currently visible (filtered) activities.
        activitiesRendered = activities;
      }

      /* Activity photo modal - photo + name + status, nothing else */
      function openActivityModal(act) {
        if (!act) return;
        const modal = $('#actModal');
        if (!modal) return;

        setModalImage(act.Image_URL);

        $('#actModalTitle').textContent = act.Activity || '';
        $('#actModalStatus').innerHTML = truthy(act['Completion Status'])
          ? `<span class="am-status done">\u2713 Done</span>`
          : `<span class="am-status pending">Not done yet</span>`;
        $('#actModalMeta').innerHTML = '';
        $('#actModalExtra').innerHTML = '';

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }

      function closeActivityModal() {
        const modal = $('#actModal');
        if (!modal) return;
        modal.classList.remove('open');
        document.body.style.overflow = '';
        modalNav = { list: [], index: -1, render: null };
        syncModalNav();
      }

      /* ============================================================
         6g-bis. TREKS - peaks, ridgelines & summits
         ------------------------------------------------------------
         Fully sheet-driven: add a row to the Treks tab and it appears
         here on the next refresh. Status TRUE => a "summited" photo card
         with a summit seal; anything else => a "planned" trail card.
         Region pills, stat tiles and the summit-progress ridge are all
         derived from the data, so a brand-new region or state needs no
         code change.
         ============================================================ */
      const trekState = {
        search: '',
        tab: 'all',          // 'all' | 'summited' | 'planned'
        region: 'all',       // 'all' | the exact Region string from the sheet
        all: [],
        rendered: [],        // the current filtered list, for delegated clicks + modal arrows
        latestKey: '',       // Trek name of the most recent climb (gets the "Latest" sticker)
      };

      /* Region -> colour class. Only drives the pill colour; filtering always
         compares the raw sheet value, so an unknown region still works. */
      const trekRegionClass = (r) => {
        const s = String(r || '').toLowerCase().replace(/[^a-z]/g, '');
        if (s.includes('northeast')) return 'region-northeast';
        if (s.includes('north')) return 'region-north';
        if (s.includes('south')) return 'region-south';
        if (s.includes('east')) return 'region-east';
        if (s.includes('west')) return 'region-west';
        if (s.includes('central')) return 'region-central';
        return 'region-default';
      };

      /* Ridge geometry for the summit-progress graphic (viewBox 1000 x 130).
         Ascends left -> right, so "progress" reads as climbing toward the peak. */
      const TREK_RIDGE = [
        [0, 116], [70, 100], [140, 108], [215, 84], [285, 94], [360, 70], [430, 80],
        [505, 56], [575, 66], [650, 42], [725, 52], [800, 30], [870, 40], [940, 18], [1000, 10],
      ];
      const TREK_RIDGE_D = TREK_RIDGE.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
      const TREK_RIDGE_AREA_D = `${TREK_RIDGE_D} L1000,130 L0,130 Z`;

      let trekDidAnimate = false;
      let trekObserver = null;

      function renderTreks(a) {
        const section = $('#treks');
        const treks = a.raw.treks || [];
        const navLink = $('#navLinks a[href="#treks"]');

        // No Treks tab / empty tab -> hide the section (and its nav link) entirely
        if (!section) return;
        if (!treks.length) {
          section.style.display = 'none';
          if (navLink) navLink.parentElement.style.display = 'none';
          return;
        }
        section.style.display = '';
        if (navLink) navLink.parentElement.style.display = '';

        trekState.all = treks;

        // Most recent summit gets the "Latest summit" ribbon
        let latest = null, latestTime = -Infinity;
        (a.raw.summitedTreks || []).forEach(t => {
          const d = latestDateIn(t['Visit Date']);
          if (d && d.getTime() > latestTime) { latestTime = d.getTime(); latest = t; }
        });
        trekState.latestKey = latest ? String(latest.Trek || '') : '';

        // If the active region vanished from the sheet, fall back to All
        const regionValues = unique(treks.map(t => String(t.Region || '').trim()));
        if (trekState.region !== 'all' && !regionValues.includes(trekState.region)) {
          trekState.region = 'all';
        }

        renderTrekProgress(a, latest);
        renderTrekFilters(treks, regionValues);
        applyTrekFilters();
      }

      /* ----- Summit progress: a ridgeline that draws itself as treks get done ----- */
      function renderTrekProgress(a, latest) {
        const el = $('#trekProgress');
        if (!el) return;

        const done = a.counters.treksDone;
        const total = a.counters.treksTotal;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const latestDate = latest ? latestDateIn(latest['Visit Date']) : null;

        el.innerHTML = `
      <div class="tp-card">
        <div class="tp-top">
          <div class="tp-headline">
            <div class="tp-label">Trek progress</div>
            <div class="tp-count">
              <span class="tp-num" data-count="${done}">0</span>
              <span class="tp-of">of ${total} ${total === 1 ? 'trek' : 'treks'} completed</span>
            </div>
          </div>
          ${latest ? `
            <div class="tp-latest-box">
              <span class="tp-latest-label">Latest climb</span>
              <span class="tp-latest-name">${escHtml(latest.Trek || '')}</span>
              ${latestDate ? `<span class="tp-latest-date">${fmtDate(latestDate)}</span>` : ''}
            </div>` : ''}
          <div class="tp-ring">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <circle class="tp-ring-track" cx="22" cy="22" r="17"></circle>
              <circle class="tp-ring-prog" cx="22" cy="22" r="17"
                stroke-dasharray="106.8" stroke-dashoffset="106.8"
                data-off="${(106.8 * (1 - pct / 100)).toFixed(1)}"></circle>
            </svg>
            <span class="tp-ring-pct">${pct}%</span>
          </div>
        </div>

        <div class="tp-ridge">
          <svg viewBox="0 0 1000 130" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="trekRidgeGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" class="trg-a" />
                <stop offset="100%" class="trg-b" />
              </linearGradient>
            </defs>
            <path class="tp-area" d="${TREK_RIDGE_AREA_D}" />
            <path class="tp-track" d="${TREK_RIDGE_D}" />
            <path class="tp-fill" id="trekRidgePath" d="${TREK_RIDGE_D}" />
          </svg>
          <span class="tp-flag" id="trekFlag" hidden>🚩</span>
          <span class="tp-peak-mark" aria-hidden="true">⛰️</span>
        </div>

        <div class="tp-foot">
          <span class="tp-foot-l">Base camp</span>
          <span class="tp-foot-r">Summit</span>
        </div>
      </div>`;

        // Dash the ridge so it can "draw" up to the current percentage, and park the
        // flag at base camp - it climbs to the end of the trail when the animation runs.
        const path = $('#trekRidgePath');
        const flag = $('#trekFlag');
        if (path) {
          let len = 0;
          try { len = path.getTotalLength(); } catch (e) { len = 0; }
          if (len) {
            path.style.strokeDasharray = String(len);
            path.style.strokeDashoffset = String(len);      // start undrawn
            path.dataset.off = String(len * (1 - pct / 100));

            const asPct = (p) => ({ left: `${(p.x / 1000) * 100}%`, top: `${(p.y / 130) * 100}%` });
            try {
              const start = asPct(path.getPointAtLength(0));
              const end = asPct(path.getPointAtLength(len * (pct / 100)));
              if (flag) {
                flag.style.left = start.left;
                flag.style.top = start.top;
                flag.dataset.left = end.left;
                flag.dataset.top = end.top;
                flag.hidden = false;
              }
            } catch (e) { if (flag) flag.hidden = true; }
          }
        }

        const runTrekAnims = () => {
          el.classList.add('tp-animate');
          const p = $('#trekRidgePath');
          if (p && p.dataset.off != null) p.style.strokeDashoffset = p.dataset.off;
          const f = $('#trekFlag');
          if (f && f.dataset.left) { f.style.left = f.dataset.left; f.style.top = f.dataset.top; }
          const ring = $('.tp-ring-prog', el);
          if (ring) ring.style.strokeDashoffset = ring.dataset.off || '0';
          const num = $('.tp-num', el);
          if (num) animateCount(num, parseInt(num.dataset.count, 10) || 0);
        };

        // Animate the first time the section scrolls into view. On later refreshes
        // (the 5-minute re-fetch) re-run it after a paint, so the trail redraws to
        // the new value instead of jumping.
        if (trekDidAnimate) {
          requestAnimationFrame(() => requestAnimationFrame(runTrekAnims));
          return;
        }
        if (trekObserver) trekObserver.disconnect();
        if (!('IntersectionObserver' in window)) {
          trekDidAnimate = true;
          requestAnimationFrame(() => requestAnimationFrame(runTrekAnims));
          return;
        }
        trekObserver = new IntersectionObserver((entries) => {
          if (entries.some(e => e.isIntersecting)) {
            trekDidAnimate = true;
            runTrekAnims();
            trekObserver.disconnect();
          }
        }, { threshold: 0.15 });
        trekObserver.observe($('#treks'));
      }

      /* ----- Status + region dropdowns, both built from the sheet ----- */
      function renderTrekFilters(treks, regionValues) {
        const done = treks.filter(t => truthy(t.Status)).length;

        const statusSel = $('#trekStatusFilter');
        if (statusSel) {
          statusSel.innerHTML = `
        <option value="all">All treks (${treks.length})</option>
        <option value="summited">\u2713 Completed (${done})</option>
        <option value="planned">\u25CE Planned (${treks.length - done})</option>`;
          statusSel.value = trekState.tab;
        }

        const regionSel = $('#trekRegionFilter');
        if (regionSel) {
          const counts = {};
          treks.forEach(t => {
            const r = String(t.Region || '').trim();
            if (r) counts[r] = (counts[r] || 0) + 1;
          });
          const opts = regionValues
            .filter(Boolean)
            .sort((x, y) => (counts[y] || 0) - (counts[x] || 0) || x.localeCompare(y))
            .map(r => `<option value="${escHtml(r)}">${escHtml(r)} (${counts[r]})</option>`)
            .join('');
          regionSel.innerHTML = `<option value="all">All regions (${treks.length})</option>${opts}`;
          regionSel.value = trekState.region;
        }
      }

      /* ----- Filter + render the single grid ----- */
      function applyTrekFilters() {
        const { search, tab, region, all } = trekState;

        let filtered = all;
        if (region !== 'all') {
          filtered = filtered.filter(t => String(t.Region || '').trim() === region);
        }
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(t =>
            [t.Trek, t.Place, t.State, t.Region, t.Country, t['Famous For']]
              .some(v => String(v || '').toLowerCase().includes(q))
          );
        }
        if (tab === 'summited') filtered = filtered.filter(t => truthy(t.Status));
        else if (tab === 'planned') filtered = filtered.filter(t => !truthy(t.Status));

        /* One list, kept in the original sheet/data order - no re-sorting. The
           completed cards' solid green highlight is what tells the two states
           apart, so the sequence on screen matches the source data exactly. */
        renderTrekCards(filtered);
      }

      /* ----- Trek cards. Both states use the same photo-thumbnail card; completed
              ones just carry a green tint and a small "Completed" tag. ----- */
      function trekCard(t, i, done) {
        const name = String(t.Trek || 'Unnamed trek');
        const date = latestDateIn(t['Visit Date']);
        const img = String(t.Image_URL || '').trim();
        const hasImg = /^https?:\/\//i.test(img);
        const loc = [t.Place, t.State].filter(Boolean).join(' \u00b7 ');
        const famous = String(t['Famous For'] || '').trim();
        const isLatest = done && trekState.latestKey && name === trekState.latestKey;

        return `
      <article class="trek-card ${done ? 'done' : 'todo'}${isLatest ? ' is-latest' : ''}" data-idx="${i}"
               role="button" tabindex="0" data-aos="fade-up" data-aos-delay="${(i % 5) * 50}">
        <div class="tc-media">
          <div class="tc-fallback">${escHtml(initials(name))}</div>
          ${hasImg ? `<img src="${escHtml(img)}" alt="${escHtml(name)}" loading="lazy" decoding="async"
                        onerror="this.style.display='none';" />` : ''}
          <span class="tc-shade"></span>
          <span class="tc-shine"></span>
          ${done
            ? `<span class="tc-tag">\u2713 Completed${date ? ` \u00b7 ${escHtml(fmtDateShort(date))}` : ''}</span>`
            : `<span class="tc-tag todo">\u25CE Planned</span>`}
          ${isLatest ? `<span class="tc-latest">\u25C6 Latest</span>` : ''}
          <div class="tc-caption">
            <h3>${escHtml(name)}</h3>
            ${loc ? `<div class="tc-loc">${escHtml(loc)}</div>` : ''}
          </div>
        </div>

        <div class="tc-body">
          ${t.Region ? `<span class="region-pill tc-region ${trekRegionClass(t.Region)}">${escHtml(t.Region)}</span>` : ''}
          ${famous ? `<p class="tc-famous">${escHtml(famous)}</p>` : ''}
          <div class="tc-foot">
            <span class="tc-date">${done ? (date ? `\ud83d\udcc5 ${escHtml(fmtDate(date))}` : '\u2713 Completed') : 'Not done yet'}</span>
            <span class="tc-arrow">\u2197</span>
          </div>
        </div>
      </article>`;
      }

      function renderTrekCards(list) {
        const grid = $('#trekGrid');
        if (!grid) return;
        if (!list.length) {
          grid.innerHTML = `<div class="empty-state"><p>No treks match these filters.</p></div>`;
          trekState.rendered = [];
          return;
        }
        grid.innerHTML = list.map((t, i) => trekCard(t, i, truthy(t.Status))).join('');
        trekState.rendered = list;
      }

      /* Trek photo modal - photo + name + status. Prev/Next still browses whatever
         filtered trek list you opened it from. */
      function openTrekModal(t) {
        if (!t) return;
        const modal = $('#actModal');
        if (!modal) return;

        setModalImage(t.Image_URL);

        $('#actModalTitle').textContent = String(t.Trek || 'Unnamed trek');
        $('#actModalStatus').innerHTML = truthy(t.Status)
          ? `<span class="am-status done">\u2713 Completed</span>`
          : `<span class="am-status pending">Planned</span>`;
        $('#actModalMeta').innerHTML = '';
        $('#actModalExtra').innerHTML = '';

        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }

      /* ---------------------------------------------------------------------------
         MODAL NAVIGATION - browse cards within one section without closing
         ---------------------------------------------------------------------------
         Each section (Places, Heritage, Adventures) hands the shared photo modal the
         exact visible list it was clicked from, the clicked index, and the render
         function for that record type. Prev / Next then walk that list (wrapping
         around at the ends) and re-render in place.
         --------------------------------------------------------------------------- */
      let modalNav = { list: [], index: -1, render: null };

      /* Warm the browser cache for the neighbouring images so Prev/Next feels instant.
         Only real http(s) URLs are touched, and each URL is only ever preloaded once. */
      const _preloadedModalImgs = new Set();
      function preloadModalUrl(url) {
        const clean = (url == null ? '' : String(url)).trim();
        if (!/^https?:\/\//i.test(clean) || _preloadedModalImgs.has(clean)) return;
        _preloadedModalImgs.add(clean);
        const img = new Image();
        img.decoding = 'async';
        img.src = clean;
      }
      function preloadAdjacentModal() {
        const n = modalNav.list.length;
        if (n < 2) return;
        const next = modalNav.list[(modalNav.index + 1) % n];
        const prev = modalNav.list[(modalNav.index - 1 + n) % n];
        if (next) preloadModalUrl(next.Image_URL);
        if (prev) preloadModalUrl(prev.Image_URL);
      }

      function openInModal(list, index, render) {
        modalNav.list = Array.isArray(list) ? list : [];
        modalNav.index = index;
        modalNav.render = render;
        const item = modalNav.list[index];
        if (item == null || typeof render !== 'function') return;
        render(item);
        syncModalNav();
        preloadAdjacentModal();
      }

      function modalNavStep(delta) {
        const n = modalNav.list.length;
        if (n < 2 || typeof modalNav.render !== 'function') return;
        modalNav.index = ((modalNav.index + delta) % n + n) % n;
        modalNav.render(modalNav.list[modalNav.index]);
        syncModalNav();
        preloadAdjacentModal();
      }

      function syncModalNav() {
        const n = modalNav.list.length;
        const multi = n > 1;
        const prev = $('#actModalPrev');
        const next = $('#actModalNext');
        const counter = $('#actModalCounter');
        if (prev) prev.hidden = !multi;
        if (next) next.hidden = !multi;
        if (counter) {
          counter.hidden = !multi;
          if (multi) counter.textContent = `${modalNav.index + 1} / ${n}`;
        }
      }

      /* ----- 6h. Map with Leaflet + geocoding cache ----- */
      let mapInstance = null;
      let clusterGroup = null;
      const geocodeCache = new Map();
      let geocodeDidFetch = false; // set true when the last geocode() call made a real network request

      async function geocode(rawQuery) {
        geocodeDidFetch = false;
        // Parentheses in a place field (e.g. "Bari Village (Igatpuri)") don't match
        // any OpenStreetMap entry and cause the whole lookup to fail — flatten them
        // into plain comma-separated parts so the location still resolves.
        const query = String(rawQuery)
          .replace(/\s*\(\s*([^)]*?)\s*\)\s*/g, ', $1, ')
          .replace(/(\s*,\s*)+/g, ', ')
          .replace(/^\s*,\s*|\s*,\s*$/g, '')
          .trim();
        if (geocodeCache.has(query)) return geocodeCache.get(query);
        // Try localStorage cache too (single-session benefit, but harmless if blocked)
        try {
          const stored = JSON.parse(localStorage.getItem('geocache_v1') || '{}');
          if (stored[query]) {
            geocodeCache.set(query, stored[query]);
            return stored[query];
          }
        } catch (e) { }

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        geocodeDidFetch = true; // about to hit the network
        try {
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          const data = await res.json();
          if (data && data[0]) {
            const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
            geocodeCache.set(query, coords);
            try {
              const stored = JSON.parse(localStorage.getItem('geocache_v1') || '{}');
              stored[query] = coords;
              localStorage.setItem('geocache_v1', JSON.stringify(stored));
            } catch (e) { }
            return coords;
          }
        } catch (e) {
          console.warn('Geocoding failed for', query, e);
        }
        geocodeCache.set(query, null);
        return null;
      }

      function makeMarkerIcon(kind) {
        const colors = { place: '#c85d73', monument: '#2c2420', activity: '#5b8bbf', trek: '#3f7a4f' };
        const icons = { place: '📍', monument: '🏛', activity: '⚑', trek: '⛰' };
        return L.divIcon({
          className: 'custom-marker',
          html: `<div class="pin" style="background:${colors[kind]}"><span>${icons[kind]}</span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          popupAnchor: [0, -28],
        });
      }

      async function renderMap(a) {
        if (!mapInstance) {
          mapInstance = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([22.5, 79], 5);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18,
          }).addTo(mapInstance);
        }
        if (clusterGroup) { mapInstance.removeLayer(clusterGroup); }
        clusterGroup = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });

        // Gather geocode targets: visited places + visited monuments + done activities
        const targets = [];
        // One pin per PLACE, however many times it was visited; the popup shows the latest.
        a.raw.visitedPlaces.forEach(p => targets.push({
          kind: 'place', query: `${p.Place}, ${p.State}, ${p.Country}`,
          title: p.Place, sub: `${p.State}, ${p.Country}`,
          memory: (p._memories || [])[0] || '', type: p.Type, date: p._latest,
          trips: p._tripCount,
        }));
        a.raw.visitedMonuments.forEach(m => targets.push({
          kind: 'monument', query: `${m['Monument / Landmark']}, ${m.Place}, ${m.Country}`,
          title: m['Monument / Landmark'], sub: `${m.Place}, ${m.State}`,
          memory: m['Famous For'], type: 'Monument', date: m['Visit Date'],
        }));
        a.raw.doneActivities.forEach(act => {
          if (act.Location) targets.push({
            kind: 'activity', query: `${act.Location}, India`,
            title: act.Activity, sub: act.Location,
            memory: '', type: act.Category, date: act['Date Done'],
          });
        });
        (a.raw.summitedTreks || []).forEach(t => targets.push({
          kind: 'trek',
          query: [t.Trek, t.Place, t.State, t.Country].filter(Boolean).join(', '),
          fallbacks: [
            [t.Trek, t.State, t.Country].filter(Boolean).join(', '),
            [t.Trek, t.Country].filter(Boolean).join(', '),
            t.Trek,
          ].filter(Boolean),
          title: t.Trek, sub: [t.Place, t.State].filter(Boolean).join(', '),
          memory: t['Famous For'], type: 'Trek', date: t['Visit Date'],
        }));

        showBanner('Mapping my destinations…', true);
        const bounds = [];
        // OpenStreetMap's free geocoder asks for max ~1 request/second; spacing the
        // uncached calls keeps it from silently dropping pins (results are cached, so
        // only the very first load waits — reloads are instant).
        const GEO_DELAY = 1000;
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          let coords = await geocode(t.query);
          if (geocodeDidFetch) { await new Promise(r => setTimeout(r, GEO_DELAY)); }
          // If the specific "Trek, Village, State, Country" string didn't resolve,
          // fall back to progressively simpler queries so the pin still appears.
          if (!coords && Array.isArray(t.fallbacks)) {
            for (const fq of t.fallbacks) {
              if (!fq) continue;
              coords = await geocode(fq);
              if (geocodeDidFetch) { await new Promise(r => setTimeout(r, GEO_DELAY)); }
              if (coords) break;
            }
          }
          if (coords) {
            const marker = L.marker([coords.lat, coords.lon], { icon: makeMarkerIcon(t.kind) });
            marker.bindPopup(`
        <div class="popup-card">
          <div class="type">${t.type || t.kind}</div>
          <h4>${t.title}</h4>
          <div class="loc">${t.sub}</div>
          ${t.date ? `<div style="font-size:0.75rem; color: var(--muted); margin-top: 0.3rem;">${fmtDate(t.date instanceof Date ? t.date : parseDate(t.date))}${t.trips > 1 ? ` · ${t.trips} visits` : ''}</div>` : ''}
          ${t.memory ? `<div class="memory">"${t.memory.slice(0, 120)}${t.memory.length > 120 ? '…' : ''}"</div>` : ''}
        </div>
      `);
            clusterGroup.addLayer(marker);
            bounds.push([coords.lat, coords.lon]);
          }
        }
        mapInstance.addLayer(clusterGroup);
        if (bounds.length) mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
        hideBanner();
        showBanner('✓ Map ready');
      }

      /* ============================================================
         7. EVENT BINDINGS
         ============================================================ */
      function bindEvents() {
        // Nav scroll effect - passive (won't block scrolling) and only touches the
        // DOM when the scrolled state actually flips, not on every scroll event.
        const nav = $('#navbar');
        let navScrolled = false;
        window.addEventListener('scroll', () => {
          const scrolled = window.scrollY > 30;
          if (scrolled !== navScrolled) {
            navScrolled = scrolled;
            nav.classList.toggle('scrolled', scrolled);
          }
        }, { passive: true });

        // Keep the modal photo correctly filled if the viewport changes
        window.addEventListener('resize', () => {
          if ($('#actModal').classList.contains('open')) fitModalImage();
        });

        // Mobile nav
        $('#navToggle').addEventListener('click', () => {
          $('#navLinks').classList.toggle('open');
        });
        $$('#navLinks a').forEach(a => a.addEventListener('click', () => {
          $('#navLinks').classList.remove('open');
        }));

        // Modal close
        $('#modalClose').addEventListener('click', () => $('#modal').classList.remove('open'));
        $('#modal').addEventListener('click', (e) => {
          if (e.target.id === 'modal') $('#modal').classList.remove('open');
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            $('#modal').classList.remove('open');
            closeActivityModal();
            return;
          }
          if ($('#actModal').classList.contains('open')) {
            if (e.key === 'ArrowLeft') { e.preventDefault(); modalNavStep(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); modalNavStep(1); }
          }
        });

        // Activity photo modal close
        $('#actModalClose').addEventListener('click', closeActivityModal);
        $('#actModal').addEventListener('click', (e) => {
          if (e.target.id === 'actModal') closeActivityModal();
        });

        // Photo modal prev / next navigation
        $('#actModalPrev').addEventListener('click', (e) => { e.stopPropagation(); modalNavStep(-1); });
        $('#actModalNext').addEventListener('click', (e) => { e.stopPropagation(); modalNavStep(1); });

        // Place filters
        $('#placeSearch').addEventListener('input', (e) => { placesState.search = e.target.value; applyPlaceFilters(); });
        $('#placeTypeFilter').addEventListener('change', (e) => { placesState.type = e.target.value; applyPlaceFilters(); });
        $('#placeStatusFilter').addEventListener('change', (e) => { placesState.tab = e.target.value; applyPlaceFilters(); });

        /* ---------------------------------------------------------------------------
           DELEGATED CARD / ROW INTERACTIONS
           Instead of attaching a listener to every card or row on each render (which
           re-bound everything on every search keystroke, filter, and refresh), each
           container carries a single listener. Handlers read the clicked item's index
           and the list it was rendered from, so behaviour - including Prev/Next within
           the same filtered view - is identical.
           --------------------------------------------------------------------------- */
        const isActivationKey = (e) => e.key === 'Enter' || e.key === ' ';

        // Places - visited grid
        $('#visitedGrid').addEventListener('click', (e) => {
          const card = e.target.closest('.visited-card');
          if (!card) return;
          openInModal(placesState.visitedRendered, parseInt(card.dataset.idx, 10), openPlaceModal);
        });
        // Places - wishlist grid
        $('#wishlistGrid').addEventListener('click', (e) => {
          const card = e.target.closest('.wishlist-card');
          if (!card) return;
          openInModal(placesState.wishlistRendered, parseInt(card.dataset.idx, 10), openPlaceModal);
        });

        // Monuments - visited / wishlist tables (click + keyboard)
        const wireMonBody = (bodySel, getList) => {
          const body = $(bodySel);
          const openFromRow = (row) => openInModal(getList(), parseInt(row.dataset.visIdx, 10), openMonumentModal);
          body.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-vis-idx]');
            if (row) openFromRow(row);
          });
          body.addEventListener('keydown', (e) => {
            if (!isActivationKey(e)) return;
            const row = e.target.closest('tr[data-vis-idx]');
            if (row) { e.preventDefault(); openFromRow(row); }
          });
        };
        wireMonBody('#monVisitedBody', () => monState.rendered.visited);
        wireMonBody('#monWishlistBody', () => monState.rendered.wishlist);

        // Activities grid (click + keyboard)
        const actGrid = $('#activitiesGrid');
        const openActFrom = (card) => openInModal(activitiesRendered, parseInt(card.dataset.visIdx, 10), openActivityModal);
        actGrid.addEventListener('click', (e) => {
          const card = e.target.closest('.activity-card');
          if (card) openActFrom(card);
        });
        actGrid.addEventListener('keydown', (e) => {
          if (!isActivationKey(e)) return;
          const card = e.target.closest('.activity-card');
          if (card) { e.preventDefault(); openActFrom(card); }
        });

        /* ----- Treks -----
           Cards, tabs and region pills are all re-rendered from the sheet, so every
           listener is delegated from a container that never gets replaced. */
        const trekGrid = $('#trekGrid');
        if (trekGrid) {
          const openTrekFrom = (card) => openInModal(trekState.rendered, parseInt(card.dataset.idx, 10), openTrekModal);
          trekGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.trek-card');
            if (card) openTrekFrom(card);
          });
          trekGrid.addEventListener('keydown', (e) => {
            if (!isActivationKey(e)) return;
            const card = e.target.closest('.trek-card');
            if (card) { e.preventDefault(); openTrekFrom(card); }
          });
        }

        // Trek filters
        const trekStatus = $('#trekStatusFilter');
        if (trekStatus) trekStatus.addEventListener('change', (e) => { trekState.tab = e.target.value; applyTrekFilters(); });

        const trekRegion = $('#trekRegionFilter');
        if (trekRegion) trekRegion.addEventListener('change', (e) => { trekState.region = e.target.value; applyTrekFilters(); });

        const trekSearch = $('#trekSearch');
        if (trekSearch) trekSearch.addEventListener('input', (e) => { trekState.search = e.target.value; applyTrekFilters(); });

        // Monuments tab switcher (visited / wishlist)
        $$('.mtab').forEach(btn => {
          btn.addEventListener('click', () => {
            $$('.mtab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const which = btn.dataset.mtab;
            $('#monVisitedBlock').hidden = which !== 'visited';
            $('#monWishlistBlock').hidden = which !== 'wishlist';
          });
        });

        // Monuments region dropdown (applies to both tables)
        const monRegion = $('#monRegionFilter');
        if (monRegion) monRegion.addEventListener('change', (e) => { monState.region = e.target.value; applyMonFilter(); });

        // Contact form - sends via EmailJS
        // Initialize EmailJS if the SDK loaded and a real public key is configured
        if (typeof emailjs !== 'undefined' && EMAILJS_CONFIG.PUBLIC_KEY && !EMAILJS_CONFIG.PUBLIC_KEY.startsWith('YOUR_')) {
          try { emailjs.init({ publicKey: EMAILJS_CONFIG.PUBLIC_KEY }); }
          catch (e) { console.warn('EmailJS init failed:', e); }
        }

        $('#contactForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const submitBtn = $('#contactSubmit');
          const statusEl = $('#formStatus');

          // Gather variables (these names match the EmailJS template variables documented above)
          const formData = {
            from_name: form.from_name.value.trim(),
            destination: form.destination.value.trim() || '-',
            trip_type: form.trip_type.value,
            message: form.message.value.trim(),
            contact_info: form.contact_info.value.trim(),
          };

          // Guard: not yet configured → show a friendly notice (don't pretend it sent)
          const notConfigured =
            !EMAILJS_CONFIG.PUBLIC_KEY || EMAILJS_CONFIG.PUBLIC_KEY.startsWith('YOUR_') ||
            !EMAILJS_CONFIG.SERVICE_ID || EMAILJS_CONFIG.SERVICE_ID.startsWith('YOUR_') ||
            !EMAILJS_CONFIG.TEMPLATE_ID || EMAILJS_CONFIG.TEMPLATE_ID.startsWith('YOUR_');
          if (notConfigured || typeof emailjs === 'undefined') {
            statusEl.className = 'form-status info';
            statusEl.innerHTML = `<strong>Form is in preview mode.</strong> Add your EmailJS credentials in <code>EMAILJS_CONFIG</code> to enable sending.`;
            return;
          }

          // Loading state
          submitBtn.disabled = true;
          submitBtn.classList.add('sending');
          statusEl.className = 'form-status loading';
          statusEl.textContent = 'Sending your postcard…';

          try {
            await emailjs.send(EMAILJS_CONFIG.SERVICE_ID, EMAILJS_CONFIG.TEMPLATE_ID, formData);
            statusEl.className = 'form-status success';
            statusEl.innerHTML = `✓ Postcard sent! Thanks <strong>${formData.from_name}</strong> - I'll be in touch soon.`;
            form.reset();
          } catch (err) {
            console.error('EmailJS send failed:', err);
            statusEl.className = 'form-status error';
            statusEl.innerHTML = `Hmm, couldn't send right now. Try again, or reach out on Instagram / YouTube above.`;
          } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('sending');
          }
        });

        // Year in footer
        $('#year').textContent = new Date().getFullYear();
      }

      /* ============================================================
         8. BOOT
         ============================================================ */
      async function boot() {
        bindEvents();
        AOS.init({ duration: 700, easing: 'ease-out-cubic', once: true, offset: 50 });

        const data = await loadAllData();
        const analytics = computeAnalytics(data);

        // Render all sections in parallel-friendly order
        renderHeroStats(analytics);
        renderKPIs(analytics);
        renderWrapped(analytics);
        renderPlaces(analytics);
        renderMonuments(analytics);
        renderGoals(analytics);
        renderActivities(analytics);
        renderTreks(analytics);
        renderFooterStats(analytics);
        renderMap(analytics);  // async - runs in background

        // Auto-refresh from sheet
        setInterval(async () => {
          const fresh = await loadAllData();
          const next = computeAnalytics(fresh);
          renderHeroStats(next);
          renderKPIs(next);
          renderWrapped(next);
          renderPlaces(next);
          renderMonuments(next);
          renderGoals(next);
          renderActivities(next);
          renderTreks(next);
          renderFooterStats(next);
          renderMap(next);
        }, CONFIG.REFRESH_MS);
      }

      document.addEventListener('DOMContentLoaded', boot);

    })();

