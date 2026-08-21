// BookVerse — fills an "Other Versions" column from Open Library.
//
// Paste this into Extensions > Apps Script as a NEW file (File > + > Script,
// name it OtherVersions). Leave Code.gs alone; the two do not touch.
//
// To run it: pick fillOtherVersions in the toolbar dropdown and press Run.
//
// There is no arithmetic from one ISBN to another. Editions are grouped under a
// WORK, so each book is resolved to its work first and the work's editions are
// listed. Rows with no ISBN fall back to a title and author search.

// --- settings ---------------------------------------------------------------

var SHEETS_TO_FILL = ['All Read Books', 'Readlist'];
var VERSIONS_HEADER = 'Other Versions';
var COUNT_HEADER = 'Count';

// Written when a book has no other editions. An empty cell reads as "not looked
// at yet"; this says the lookup ran and the answer was none.
var NONE_TEXT = 'None';

// Editions per book. 0 means every one Open Library has, which is the point:
// the more ISBNs a book is known by, the more likely a shelf recognises a
// printing somebody is actually holding.
var MAX_VERSIONS = 0;

// A hard stop, not a preference. Nothing has this many real editions, and it
// keeps a bad work id from paging forever.
var EDITION_CEILING = 1000;

// A Google Sheets cell holds 50,000 characters. Truncating at 45,000 leaves
// room and never silently loses the end of a line.
var CELL_LIMIT = 45000;

// Hundreds of lines with wrap on makes a row hundreds of lines tall and the
// sheet unusable. Clipped, the cell shows one line and the whole value is still
// there — in the formula bar, in the CSV, and to the site. Set true to wrap.
var WRAP_VERSIONS = false;

// Rows already filled are skipped. Set true to rebuild every row from scratch.
var FORCE_REFILL = false;

// Apps Script stops a script at 6 minutes. This leaves room to schedule the
// continuation before that happens.
var TIME_BUDGET_MS = 4.5 * 60 * 1000;

// Open Library asks for a contactable agent and a gentle pace. Both are polite
// and both keep this from being throttled halfway through a long run.
var USER_AGENT = 'BookVerse/1.0 (personal reading log; contact: laxman19.sawant@gmail.com)';
var PAUSE_MS = 350;

// --- the run ----------------------------------------------------------------

// Resumable without remembering anything: a filled row is skipped on sight, so
// a continuation can start from the top and cost nothing to reach where it was.
function fillOtherVersions() {
  var started = Date.now();
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var done = 0;
  var filled = 0;

  for (var s = 0; s < SHEETS_TO_FILL.length; s++) {
    var sheet = book.getSheetByName(SHEETS_TO_FILL[s]);
    if (!sheet) continue;

    var plan = prepare_(sheet);
    if (!plan) continue;

    for (var row = 2; row <= plan.lastRow; row++) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        scheduleContinuation_();
        Logger.log('Paused on "' + SHEETS_TO_FILL[s] + '" at row ' + row + '. Carrying on in about a minute.');
        return;
      }

      var existing = String(sheet.getRange(row, plan.versionsCol).getValue() || '').trim();
      if (existing && !FORCE_REFILL) continue;

      var title = String(sheet.getRange(row, plan.titleCol).getValue() || '').trim();
      if (!title) continue;

      var isbn = plan.isbnCol ? String(sheet.getRange(row, plan.isbnCol).getValue() || '').trim() : '';
      var author = plan.authorCol ? String(sheet.getRange(row, plan.authorCol).getValue() || '').trim() : '';

      var text = versionsFor_(title, author, isbn);
      var count = text ? text.split('\n').length : 0;
      if (!count) text = NONE_TEXT;

      // Both cells together, then one flush. flush() is what makes this
      // visible: without it Apps Script batches every write to the end and a
      // long run looks like nothing is happening.
      sheet.getRange(row, plan.versionsCol).setValue(text);
      sheet.getRange(row, plan.countCol).setValue(count);
      SpreadsheetApp.flush();

      done++;
      if (count) filled++;
      Logger.log(row + '  ' + title + '  ->  ' + count + ' editions');

      Utilities.sleep(PAUSE_MS);
    }
  }

  clearContinuation_();
  Logger.log('Finished. ' + done + ' rows looked up, ' + filled + ' of them had other editions.');
}

// Everything for one book, one edition per line, or '' when there are none.
function versionsFor_(title, author, isbn) {
  var workKey = workKeyFor_(title, author, isbn);
  if (!workKey) return '';

  var entries = editionsOf_(workKey);
  if (!entries.length) return '';

  // Both forms of this row's own ISBN, so its own printing is never listed as
  // an alternative to itself.
  var mine = {};
  var thirteen = toIsbn13_(isbn);
  var ten = toIsbn10_(isbn);
  if (thirteen) mine[thirteen] = true;
  if (ten) mine[ten] = true;

  var seen = {};
  var lines = [];

  for (var i = 0; i < entries.length; i++) {
    if (MAX_VERSIONS && lines.length >= MAX_VERSIONS) break;
    var edition = entries[i];
    var id = firstOf_(edition.isbn_13) || firstOf_(edition.isbn_10);
    if (!id) continue;

    var key = toIsbn13_(id) || id;
    if (mine[key] || mine[id] || seen[key]) continue;
    seen[key] = true;

    lines.push(formatLine_(key, edition));
  }

  var text = lines.join('\n');
  if (text.length <= CELL_LIMIT) return text;

  // Whole lines only, so nothing is left half-written.
  var kept = [];
  var used = 0;
  for (var k = 0; k < lines.length; k++) {
    if (used + lines[k].length + 1 > CELL_LIMIT) break;
    used += lines[k].length + 1;
    kept.push(lines[k]);
  }
  Logger.log('Trimmed to ' + kept.length + ' of ' + lines.length + ' lines to fit the cell.');
  return kept.join('\n');
}

// ISBN first and always, so anything reading this cell can find it without
// having to understand the rest of the line.
function formatLine_(isbn, edition) {
  var bits = [isbn];
  var language = languageName_(firstOf_(edition.languages));
  var publisher = firstOf_(edition.publishers);
  var year = yearOf_(edition.publish_date);

  if (language) bits.push(language);
  if (publisher) bits.push(String(publisher).trim());
  if (year) bits.push(String(year));

  return bits.join(' · ');
}

// --- Open Library -----------------------------------------------------------

// One work is asked for once, even when four rows are four copies of one book.
var WORK_CACHE = {};
var EDITION_CACHE = {};

function workKeyFor_(title, author, isbn) {
  var cacheKey = toIsbn13_(isbn) || (title + '|' + author).toLowerCase();
  if (WORK_CACHE[cacheKey] !== undefined) return WORK_CACHE[cacheKey];

  var key = '';

  // The edition record is the direct route and names its own work.
  var forms = [toIsbn13_(isbn), toIsbn10_(isbn)];
  for (var i = 0; i < forms.length && !key; i++) {
    if (!forms[i]) continue;
    var record = fetchJson_('https://openlibrary.org/isbn/' + forms[i] + '.json');
    var works = record && record.works;
    if (works && works.length && works[0].key) key = works[0].key;
  }

  // No ISBN in the sheet, or no edition record for it. Title and author is the
  // only thing left, and it is why the Author column is read at all.
  if (!key && title) {
    var query = 'https://openlibrary.org/search.json?limit=1&fields=key'
      + '&title=' + encodeURIComponent(title)
      + (author ? '&author=' + encodeURIComponent(author) : '');
    var found = fetchJson_(query);
    if (found && found.docs && found.docs.length) key = found.docs[0].key || '';
  }

  WORK_CACHE[cacheKey] = key;
  return key;
}

// Paged. editions.json answers 100 at a time however large a limit is asked
// for, so a work with 300 printings needs three calls, not one.
function editionsOf_(workKey) {
  if (EDITION_CACHE[workKey]) return EDITION_CACHE[workKey];

  var path = workKey.indexOf('/') === 0 ? workKey : '/works/' + workKey;
  var entries = [];
  var offset = 0;

  while (entries.length < EDITION_CEILING) {
    var payload = fetchJson_('https://openlibrary.org' + path + '/editions.json?limit=100&offset=' + offset);
    var batch = (payload && payload.entries) || [];
    if (!batch.length) break;

    entries = entries.concat(batch);

    // size is the true total. Stop on it rather than on a short page, which a
    // slow shard can return early.
    var total = payload && Number(payload.size);
    if (total && entries.length >= total) break;
    if (batch.length < 100) break;

    offset += batch.length;
    Utilities.sleep(PAUSE_MS);
  }

  // Newest first, so the printings someone might actually be holding come up
  // before a 1954 hardback nobody can buy.
  entries.sort(function (a, b) { return (yearOf_(b.publish_date) || 0) - (yearOf_(a.publish_date) || 0); });

  EDITION_CACHE[workKey] = entries;
  return entries;
}

// A 404 is an answer, not a failure: plenty of ISBNs have no edition record.
function fetchJson_(url) {
  try {
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
    });
    if (response.getResponseCode() !== 200) return null;
    return JSON.parse(response.getContentText());
  } catch (error) {
    return null;
  }
}

// --- the sheet --------------------------------------------------------------

// Columns are found by HEADER NAME, never by position, and the new one is added
// on the end when it is missing. Same rule as Code.gs, for the same reason.
function prepare_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var width = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0];

  var titleCol = 0, isbnCol = 0, authorCol = 0, versionsCol = 0, countCol = 0;

  for (var c = 0; c < headers.length; c++) {
    var name = normaliseHeader_(headers[c]);
    if (!titleCol && name === 'title') titleCol = c + 1;
    if (!isbnCol && (name === 'isbn' || name === 'isbn13' || name === 'isbn 13')) isbnCol = c + 1;
    if (!authorCol && (name === 'author' || name === 'authors')) authorCol = c + 1;
    if (!versionsCol && name === normaliseHeader_(VERSIONS_HEADER)) versionsCol = c + 1;
    if (!countCol && name === normaliseHeader_(COUNT_HEADER)) countCol = c + 1;
  }

  if (!titleCol) throw new Error('No "Title" column on "' + sheet.getName() + '".');

  // Added in order, so Count lands immediately after Other Versions when
  // neither exists yet.
  if (!versionsCol) {
    versionsCol = ++width;
    sheet.getRange(1, versionsCol).setValue(VERSIONS_HEADER);
  }
  if (!countCol) {
    countCol = ++width;
    sheet.getRange(1, countCol).setValue(COUNT_HEADER);
  }

  var rows = Math.max(lastRow - 1, 1);

  sheet.getRange(2, versionsCol, rows, 1)
    .setWrap(WRAP_VERSIONS)
    .setVerticalAlignment('top');

  // A count beside a forty-line cell belongs at the top of it, not the middle.
  sheet.getRange(2, countCol, rows, 1).setVerticalAlignment('top').setHorizontalAlignment('center');

  return {
    lastRow: lastRow, titleCol: titleCol, isbnCol: isbnCol, authorCol: authorCol,
    versionsCol: versionsCol, countCol: countCol
  };
}

// --- continuation -----------------------------------------------------------

function scheduleContinuation_() {
  clearContinuation_();
  ScriptApp.newTrigger('fillOtherVersions').timeBased().after(60 * 1000).create();
}

function clearContinuation_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'fillOtherVersions') ScriptApp.deleteTrigger(triggers[i]);
  }
}

// --- small helpers ----------------------------------------------------------

function normaliseHeader_(text) {
  return String(text == null ? '' : text).replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function firstOf_(list) {
  if (!list || !list.length) return '';
  var value = list[0];
  if (value && typeof value === 'object') return value.key || value.name || '';
  return value;
}

function yearOf_(value) {
  var match = String(value == null ? '' : value).match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
}

// Both forms convert to 13 before anything is compared, exactly as
// js/data/identity.js and Code.gs do. The three must agree.
function toIsbn13_(value) {
  var bare = String(value == null ? '' : value).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (bare.length === 13) return bare;
  if (bare.length !== 10) return '';

  var body = '978' + bare.substring(0, 9);
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += Number(body.charAt(i)) * (i % 2 ? 3 : 1);
  return body + String((10 - (sum % 10)) % 10);
}

function toIsbn10_(value) {
  var bare = String(value == null ? '' : value).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (bare.length === 10) return bare;
  if (bare.length !== 13 || bare.substring(0, 3) !== '978') return '';

  var body = bare.substring(3, 12);
  var sum = 0;
  for (var i = 0; i < 9; i++) sum += Number(body.charAt(i)) * (10 - i);
  var check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

var LANGUAGE_NAMES = {
  eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German',
  deu: 'German', ita: 'Italian', por: 'Portuguese', dut: 'Dutch', nld: 'Dutch',
  rus: 'Russian', jpn: 'Japanese', chi: 'Chinese', zho: 'Chinese', ara: 'Arabic',
  hin: 'Hindi', mar: 'Marathi', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu',
  guj: 'Gujarati', kan: 'Kannada', mal: 'Malayalam', pan: 'Punjabi', urd: 'Urdu',
  san: 'Sanskrit', heb: 'Hebrew', kor: 'Korean', swe: 'Swedish', nor: 'Norwegian',
  dan: 'Danish', fin: 'Finnish', pol: 'Polish', tur: 'Turkish', gre: 'Greek',
  ell: 'Greek', cze: 'Czech', ces: 'Czech', hun: 'Hungarian', ukr: 'Ukrainian',
  vie: 'Vietnamese', tha: 'Thai', ind: 'Indonesian', per: 'Persian', fas: 'Persian',
  lat: 'Latin', cat: 'Catalan', ron: 'Romanian', rum: 'Romanian', srp: 'Serbian',
  hrv: 'Croatian', bul: 'Bulgarian', slo: 'Slovak', slk: 'Slovak', slv: 'Slovenian'
};

function languageName_(key) {
  var code = String(key == null ? '' : key).replace('/languages/', '').trim().toLowerCase();
  if (!code) return '';
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}
