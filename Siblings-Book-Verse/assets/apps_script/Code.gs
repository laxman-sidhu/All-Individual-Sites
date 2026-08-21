// BookVerse — the read and write bridge. Setup is in assets/SETUP.txt.
//
// Deploy > Manage deployments > pencil > New version > Deploy after every edit:
// the site sees the last DEPLOYED version, not the last saved one.
//
// COLUMNS ARE FOUND BY HEADER NAME, NEVER BY POSITION.

// Must match APPS_SCRIPT_TOKEN in js/config.js.
var SECRET = 'this-is-a-long-random-string-for-bookverse';

var READ_SHEET = 'All Read Books';
var READLIST_SHEET = 'Readlist';

// Header text -> field, compared lowercased with whitespace collapsed.
// Add a spelling here if a column is ever renamed.
var COLUMN_ALIASES = {
  title:    ['title', 'book', 'book name', 'name'],
  isbn:     ['isbn', 'isbn13', 'isbn 13', 'isbn-13', 'isbn10', 'isbn 10', 'isbn-10'],
  author:   ['author', 'authors', 'writer', 'written by'],
  genre:    ['genre', 'genres', 'category'],
  cover:    ['thumbnail url', 'thumbnail', 'link', 'cover', 'cover link', 'image', 'poster link', 'cover url', 'url'],
  reader:   ['read by who ?', 'read by who?', 'read by who', 'read by', 'reader', 'who',
             'readlist of who ?', 'readlist of who?', 'readlist of who', 'added by', 'for', 'suggested by'],
  summary:  ['summary', 'description', 'about', 'blurb'],
  book_id:  ['book id', 'bookid', 'book_id', 'id', 'google id', 'olid'],
  year:     ['year', 'published', 'publish year', 'first published'],
  date_read: ['date read', 'read on', 'finished', 'date'],
  versions: ['other versions', 'other version', 'other editions', 'editions'],
  version_count: ['count', 'versions count', 'edition count', 'editions count']
};

// ============================================================================
// ENTRY POINTS
// ============================================================================

// Reading. No token: the same rows are public through the published sheet, and
// one request returns both tabs so a first load pays the cold start once.
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'read';
    if (action === 'ping') return reply(ping());

    return reply({
      ok: true,
      tabs: { read: readTab(READ_SHEET), readlist: readTab(READLIST_SHEET) }
    });
  } catch (error) {
    return reply({ ok: false, error: String(error && error.message || error) });
  }
}

// Writing. Apps Script cannot answer a CORS preflight, so the body arrives as
// text/plain and is parsed here. Changing that header breaks every write.
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(body.token || '') !== SECRET) return reply({ ok: false, error: 'Not authorised.' });

    var payload = body.payload || {};
    var actions = {
      mark_read: markRead,
      remove_read: removeRead,
      add_readlist: addReadlist,
      remove_readlist: removeReadlist,
      add_version: addVersion
    };

    var handler = actions[body.action];
    if (!handler) return reply({ ok: false, error: 'Unknown action: ' + body.action });
    return reply(handler(payload));
  } catch (error) {
    return reply({ ok: false, error: String(error && error.message || error) });
  }
}

function reply(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// SHEET PLUMBING
// ============================================================================

function readTab(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return { header: [], rows: [] };
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { header: [], rows: [] };
  return { header: values[0], rows: values.slice(1) };
}

function normaliseHeader(text) {
  return String(text == null ? '' : text).replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('No tab named "' + name + '" in this workbook.');
  return sheet;
}

// Canonical field -> 1-based column index. The first column naming a field wins.
function columnMap(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < header.length; i++) {
    var normalised = normaliseHeader(header[i]);
    if (!normalised) continue;
    for (var field in COLUMN_ALIASES) {
      if (map[field] !== undefined) continue;
      if (COLUMN_ALIASES[field].indexOf(normalised) !== -1) { map[field] = i + 1; break; }
    }
  }
  return map;
}

function requireColumn(map, field, sheet) {
  if (map[field] === undefined) {
    throw new Error('The "' + sheet.getName() + '" tab has no column for ' + field + '. Expected a header naming it.');
  }
  return map[field];
}

// The same shape js/core/util.js makes: lowercase, unaccented, punctuation-free.
var STRIP = (function () {
  try { return new RegExp('[^\\p{L}\\p{N}\\p{M}\\s]', 'gu'); }
  catch (e) { return /[^A-Za-z0-9\s]/g; }
})();

function normaliseTitle(text) {
  return String(text == null ? '' : text)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(STRIP, ' ').replace(/\s+/g, ' ').trim();
}

function normaliseAuthorText(text) {
  return normaliseTitle(text).replace(/\s+/g, '');
}

// The filing form, and the one every TITLE comparison uses. A leading article
// is not part of a title - "The Metamorphosis" shelves under M - and the sheet
// and the APIs disagree about whether to type it. js/data/identity.js holds the
// same rule and bridge.test.mjs compares the two.
// Deliberately NOT folded into normaliseTitle: normaliseAuthorText is built on
// that one, and stripping a leading article from a name turns A. A. Milne into
// A. Milne.
function filingTitle(text) {
  return normaliseTitle(text).replace(/^(?:the|a|an)\s+/, '');
}

// Both forms convert to 13 before comparison. js/data/identity.js does exactly
// this, and the two must agree or a write lands on a row the site cannot find.
function normaliseIsbn(value) {
  var bare = String(value == null ? '' : value).replace(/[^0-9Xx]/g, '').toUpperCase();
  if (bare.length === 13) return bare;
  if (bare.length !== 10) return '';

  var body = '978' + bare.slice(0, 9);
  var sum = 0;
  for (var i = 0; i < 12; i++) sum += Number(body.charAt(i)) * (i % 2 ? 3 : 1);
  return body + String((10 - (sum % 10)) % 10);
}

// ============================================================================
// FINDING A ROW
// ============================================================================

// Every matching row, not the first, or an old duplicate comes straight back.
function findRows(sheet, map, payload, opts) {
  opts = opts || {};
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var width = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, last - 1, width).getDisplayValues();

  var wantId = String(payload.book_id || '').trim();
  var wantIsbn = normaliseIsbn(payload.isbn);
  var wantTitle = filingTitle(payload.title);
  var wantAuthor = normaliseAuthorText(payload.author);
  var wantReader = String(opts.reader || '').trim().toLowerCase();

  var hits = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var cell = function (field) {
      var at = map[field];
      return at === undefined ? '' : String(row[at - 1] == null ? '' : row[at - 1]).trim();
    };

    var matched = false;
    var rowIsbn = normaliseIsbn(cell('isbn'));
    // An ISBN on both sides settles it outright, and the title is not consulted.
    if (wantIsbn && rowIsbn) {
      matched = wantIsbn === rowIsbn;
    } else if (wantId && cell('book_id') && cell('book_id') === wantId) {
      matched = true;
    } else if (wantTitle && filingTitle(cell('title')) === wantTitle) {
      var rowAuthor = normaliseAuthorText(cell('author'));
      // A blank author on either side says nothing, so it matches either way.
      matched = !wantAuthor || !rowAuthor || rowAuthor === wantAuthor;
    }
    if (!matched) continue;

    if (wantReader && String(cell('reader')).toLowerCase() !== wantReader) continue;
    hits.push(i + 2);
  }
  return hits;
}

function deleteRows(sheet, rows) {
  var sorted = rows.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < sorted.length; i++) sheet.deleteRow(sorted[i]);
  return sorted.length;
}

// Append one row, writing each field into the column its header names.
function appendRow(sheet, map, fields) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var row = new Array(width).fill('');
  for (var field in fields) {
    var at = map[field];
    // A field with no column is skipped rather than shifting everything along.
    if (at !== undefined && at <= width) row[at - 1] = fields[field];
  }
  sheet.appendRow(row);
  return sheet.getLastRow();
}

// ============================================================================
// ACTIONS
// ============================================================================

function ping() {
  var read = getSheet(READ_SHEET);
  var readlist = getSheet(READLIST_SHEET);
  var map = columnMap(read);
  var found = [];
  for (var field in map) found.push(field);
  return {
    ok: true,
    bridge: {
      read_rows: Math.max(read.getLastRow() - 1, 0),
      readlist_rows: Math.max(readlist.getLastRow() - 1, 0),
      columns_found: found,
      secret_is_placeholder: SECRET === 'change-me-to-a-long-random-string'
    }
  };
}

// One call appends every reader's row AND clears the readlist: two can half-fail
// and leave a book in both places.
function markRead(payload) {
  var sheet = getSheet(READ_SHEET);
  var map = columnMap(sheet);
  requireColumn(map, 'title', sheet);

  var readers = payload.readers || [];
  if (!readers.length) return { ok: false, error: 'No reader was given.' };

  var added = [];
  var skipped = [];
  for (var i = 0; i < readers.length; i++) {
    var reader = String(readers[i]).trim();
    if (!reader) continue;

    // The duplicate check exists twice on purpose; this is the half that holds,
    // because a second device or a hand edit only goes through here.
    if (findRows(sheet, map, payload, { reader: reader }).length) { skipped.push(reader); continue; }

    var fields = {
      title: payload.title,
      author: payload.author,
      genre: payload.genre,
      cover: payload.cover,
      reader: reader,
      summary: payload.summary,
      isbn: payload.isbn,
      book_id: payload.book_id,
      year: payload.year,
      versions: payload.versions,
      version_count: payload.version_count,
      date_read: new Date().toISOString().slice(0, 10)
    };
    appendRow(sheet, map, fields);
    added.push(reader);
  }

  var removed = 0;
  try {
    var queue = getSheet(READLIST_SHEET);
    var queueMap = columnMap(queue);
    removed = deleteRows(queue, findRows(queue, queueMap, payload));
  } catch (error) {
    // No readlist tab is not a reason to undo a good write.
  }

  return { ok: true, added: added, skipped: skipped, removed_from_readlist: removed > 0 };
}

// One more printing filed against a book already read. Every row for that book
// gets the line, because each row carries its own copy of the cell.
function addVersion(payload) {
  var sheet = getSheet(READ_SHEET);
  var map = columnMap(sheet);
  requireColumn(map, 'versions', sheet);

  var isbn = normaliseIsbn(payload.edition_isbn);
  var line = String(payload.line || '').trim();
  if (!isbn || !line) return { ok: false, error: 'That edition has no ISBN to file.' };
  if (normaliseIsbn(payload.isbn) === isbn) return { ok: false, error: 'That is the printing already on the shelf.' };

  var rows = findRows(sheet, map, payload);
  if (!rows.length) return { ok: false, error: 'No row matched that book.' };

  var updated = 0;
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    var cell = sheet.getRange(rows[i], map.versions);
    var lines = versionLines(cell.getValue());
    count = lines.length;
    if (listsIsbn(lines, isbn)) continue;

    lines.push(line);
    cell.setValue(lines.join('\n'));
    if (map.version_count !== undefined) sheet.getRange(rows[i], map.version_count).setValue(lines.length);
    count = lines.length;
    updated++;
  }

  if (!updated) return { ok: false, error: 'That edition is already filed under this book.' };
  return { ok: true, updated: updated, count: count };
}

// "None" means the lookup ran and found nothing, so it is not a line.
function versionLines(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text || text.toLowerCase() === 'none') return [];
  var out = [];
  var parts = text.split(/\r?\n/);
  for (var i = 0; i < parts.length; i++) {
    var line = parts[i].trim();
    if (line) out.push(line);
  }
  return out;
}

// Only the ISBN is read off a line; the rest is for a human.
function listsIsbn(lines, isbn) {
  for (var i = 0; i < lines.length; i++) {
    if (normaliseIsbn(lines[i].split(/[\s·|,;]+/)[0]) === isbn) return true;
  }
  return false;
}

function removeRead(payload) {
  var sheet = getSheet(READ_SHEET);
  var map = columnMap(sheet);
  var reader = String(payload.reader || '').trim();
  var rows = findRows(sheet, map, payload, reader ? { reader: reader } : {});
  if (!rows.length) return { ok: false, error: 'No row matched that book.' };
  return { ok: true, removed: deleteRows(sheet, rows) };
}

function addReadlist(payload) {
  var sheet = getSheet(READLIST_SHEET);
  var map = columnMap(sheet);
  requireColumn(map, 'title', sheet);

  if (findRows(sheet, map, payload).length) return { ok: false, error: 'That book is already on the readlist.' };

  var read = getSheet(READ_SHEET);
  if (findRows(read, columnMap(read), payload).length) return { ok: false, error: 'That one has already been read.' };

  appendRow(sheet, map, {
    title: payload.title,
    isbn: payload.isbn,
    author: payload.author,
    genre: payload.genre,
    cover: payload.cover,
    summary: payload.summary,
    reader: payload.reader,
    book_id: payload.book_id,
    year: payload.year,
    versions: payload.versions,
    version_count: payload.version_count
  });
  return { ok: true, row: sheet.getLastRow() };
}

function removeReadlist(payload) {
  var sheet = getSheet(READLIST_SHEET);
  var map = columnMap(sheet);
  var rows = findRows(sheet, map, payload);
  if (!rows.length) return { ok: false, error: 'No row matched that book.' };
  return { ok: true, removed: deleteRows(sheet, rows) };
}

// ============================================================================
// RUN THESE BY HAND
// ============================================================================

// Select this in the toolbar and press Run. It reports and changes nothing.
function testSetup() {
  var report = ping();
  Logger.log('Read rows:      ' + report.bridge.read_rows);
  Logger.log('Readlist rows:  ' + report.bridge.readlist_rows);
  Logger.log('Columns found:  ' + report.bridge.columns_found.join(', '));

  var needed = ['title', 'author', 'genre', 'cover', 'reader', 'summary'];
  if (report.bridge.columns_found.indexOf('isbn') === -1) {
    Logger.log('NOTE: no ISBN column found. Matching will fall back to title + author.');
  }
  for (var i = 0; i < needed.length; i++) {
    if (report.bridge.columns_found.indexOf(needed[i]) === -1) {
      Logger.log('MISSING COLUMN: ' + needed[i] + ' — check the header row.');
    }
  }
  if (report.bridge.secret_is_placeholder) {
    Logger.log('WARNING: SECRET is still the placeholder. Replace it, put the same value in js/config.js, then redeploy.');
  }
  Logger.log('Remember: the site sees the last DEPLOYED version, not the last saved one.');
}

// Removes a second row for a book the same person already has.
function cleanDuplicates() {
  var sheet = getSheet(READ_SHEET);
  var map = columnMap(sheet);
  var last = sheet.getLastRow();
  if (last < 3) { Logger.log('Nothing to clean.'); return; }

  var values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  var seen = {};
  var doomed = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var at = function (field) {
      var col = map[field];
      return col === undefined ? '' : String(row[col - 1] == null ? '' : row[col - 1]).trim();
    };
    var key = filingTitle(at('title')) + '|' + normaliseAuthorText(at('author')) + '|' + at('reader').toLowerCase();
    if (seen[key]) { doomed.push(i + 2); Logger.log('Duplicate: ' + at('title') + ' — ' + at('reader')); }
    else seen[key] = true;
  }

  deleteRows(sheet, doomed);
  Logger.log('Removed ' + doomed.length + ' duplicate row(s). File > Version history undoes this.');
}
