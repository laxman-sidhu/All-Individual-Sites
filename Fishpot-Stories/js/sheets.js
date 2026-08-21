/**
 * Google Sheets CSV fetch and parse utilities.
 */

const SHEET_COLUMNS = {
    id: 'ID',
    name: 'Name',
    title: 'Title',
    description: 'Description',
    thumbnailUrl: 'Thumbnail Url',
    fullStory: 'Full Story',
    createdOn: 'Created On',
};

/**
 * Parse CSV text into a 2D array of strings (handles quoted fields, commas, newlines).
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (next === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
            continue;
        }

        if (char === ',') {
            row.push(field);
            field = '';
            continue;
        }

        if (char === '\r' && next === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            i++;
            continue;
        }

        if (char === '\n' || char === '\r') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            continue;
        }

        field += char;
    }

    row.push(field);
    if (row.length > 1 || row[0] !== '' || rows.length === 0) {
        rows.push(row);
    }

    return rows;
}

/**
 * Build a map of normalized header name -> column index.
 * @param {string[]} headers
 */
function buildHeaderIndex(headers) {
    const index = {};
    headers.forEach((header, i) => {
        const key = (header || '').trim().toLowerCase();
        if (key) index[key] = i;
    });
    return index;
}

/**
 * Get cell value by expected column label.
 * @param {string[]} row
 * @param {Record<string, number>} headerIndex
 * @param {string} columnLabel
 */
function getCell(row, headerIndex, columnLabel) {
    const idx = headerIndex[columnLabel.trim().toLowerCase()];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
}

/**
 * Map a CSV row to a story object.
 * @param {string[]} row
 * @param {Record<string, number>} headerIndex
 */
function rowToStory(row, headerIndex) {
    const id = getCell(row, headerIndex, SHEET_COLUMNS.id);
    if (!id) return null;

    return {
        id,
        name: getCell(row, headerIndex, SHEET_COLUMNS.name),
        title: getCell(row, headerIndex, SHEET_COLUMNS.title),
        description: getCell(row, headerIndex, SHEET_COLUMNS.description),
        thumbnailUrl: getCell(row, headerIndex, SHEET_COLUMNS.thumbnailUrl),
        fullStory: getCell(row, headerIndex, SHEET_COLUMNS.fullStory),
        createdOn: getCell(row, headerIndex, SHEET_COLUMNS.createdOn),
    };
}

/**
 * Sort stories newest first (by Created On, then by numeric ID).
 * @param {object[]} stories
 */
function sortStoriesNewestFirst(stories) {
    return [...stories].sort((a, b) => {
        const dateA = Date.parse(a.createdOn);
        const dateB = Date.parse(b.createdOn);
        if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
            return dateB - dateA;
        }
        const idA = Number(a.id);
        const idB = Number(b.id);
        if (!Number.isNaN(idA) && !Number.isNaN(idB)) {
            return idB - idA;
        }
        return String(b.id).localeCompare(String(a.id));
    });
}

/**
 * Fetch all stories from the published Google Sheet CSV.
 * @returns {Promise<object[]>}
 */
async function fetchStoriesFromSheet() {
    const response = await fetch(APP_CONFIG.SHEETS_CSV_URL);
    if (!response.ok) {
        throw new Error('Failed to load stories from Google Sheets');
    }

    const text = await response.text();
    const rows = parseCSV(text);

    if (!rows.length) {
        return [];
    }

    const headerIndex = buildHeaderIndex(rows[0]);
    const stories = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.some((cell) => (cell || '').trim())) continue;
        const story = rowToStory(row, headerIndex);
        if (story) stories.push(story);
    }

    return sortStoriesNewestFirst(stories);
}

/**
 * Find a story by ID.
 * @param {string} storyId
 * @returns {Promise<object|null>}
 */
async function fetchStoryById(storyId) {
    const stories = await fetchStoriesFromSheet();
    const normalized = String(storyId).trim();
    return stories.find((s) => String(s.id) === normalized) || null;
}

/**
 * Submit a new story via Google Apps Script Web App.
 * @param {object} payload
 */
async function submitStoryToSheet(payload) {
    if (!APP_CONFIG.SUBMIT_URL || APP_CONFIG.SUBMIT_URL.includes('YOUR_APPS_SCRIPT')) {
        throw new Error(
            'Story submission is not configured. Set SUBMIT_URL in js/config.js to your deployed Apps Script URL.'
        );
    }

    const response = await fetch(APP_CONFIG.SUBMIT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
    });

    let data = {};
    try {
        const text = await response.text();
        data = text ? JSON.parse(text) : {};
    } catch {
        /* response may be non-JSON */
    }

    if (!response.ok || data.success === false) {
        const serverError = data.error || data.message || '';
        if (/sheet.*not found/i.test(serverError)) {
            throw new Error(
                `Sheet tab "${APP_CONFIG.SHEET_TAB_NAME || 'Sheet1'}" not found in Google Sheets. ` +
                    'Open google-apps-script/Code.gs, set SHEET_TAB_NAME to your tab name, redeploy the web app, and update SUBMIT_URL in js/config.js if the URL changed.'
            );
        }
        throw new Error(serverError || 'Unable to publish story. Please try again later.');
    }

    return data;
}
