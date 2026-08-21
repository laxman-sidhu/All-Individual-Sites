/**
 * Fishpot Stories — Google Apps Script (Web App)
 *
 * Setup:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Replace all code with this file
 * 3. Set SPREADSHEET_ID below (from sheet URL: .../d/COPY_THIS_ID/edit)
 *    OR leave empty if the script project is bound to that spreadsheet
 * 4. Set SHEET_TAB_NAME to the exact tab name (bottom of the sheet)
 * 5. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone
 * 6. Copy the /exec URL into js/config.js → SUBMIT_URL
 */

const CONFIG = {
  /** Leave '' when this script is bound to the spreadsheet (recommended). */
  SPREADSHEET_ID: '',
  /** Must match the tab name exactly (default is often Sheet1). */
  SHEET_TAB_NAME: 'Sheet1',
};

const HEADERS = ['ID', 'Name', 'Title', 'Description', 'Thumbnail Url', 'Full Story', 'Created On'];

function doPost(e) {
  try {
    const body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const payload = JSON.parse(body);

    const sheet = getStoriesSheet();
    ensureHeaderRow(sheet);

    const row = [
      String(payload.id || Date.now()),
      String(payload.name || ''),
      String(payload.title || ''),
      String(payload.description || ''),
      String(payload.thumbnailUrl || ''),
      String(payload.fullStory || ''),
      String(payload.createdOn || new Date().toISOString()),
    ];

    sheet.appendRow(row);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err.message || err) });
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: 'Fishpot Stories submit endpoint is running.' });
}

function getStoriesSheet() {
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'Spreadsheet not found. Bind this script to your sheet (Extensions → Apps Script from the sheet) or set CONFIG.SPREADSHEET_ID.'
    );
  }

  const name = (CONFIG.SHEET_TAB_NAME || '').trim();
  if (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }

  const sheets = ss.getSheets();
  if (sheets.length) return sheets[0];

  throw new Error('No sheets found in this spreadsheet.');
}

function ensureHeaderRow(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(HEADERS);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
