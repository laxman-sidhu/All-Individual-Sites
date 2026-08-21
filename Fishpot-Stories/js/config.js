/**
 * Site configuration — update SUBMIT_URL after deploying Google Apps Script.
 */
const APP_CONFIG = {
    SHEETS_CSV_URL:
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQyB1z92-Uko6hitzgoj0k8Whe-iWTxLjt0468_2vAXlJQ-bxmBvQwrNPLRtDk5fuBxJwffuLUAbbE1/pub?output=csv',
    /** Google Apps Script Web App URL (ends with /exec) */
    SUBMIT_URL: 'https://script.google.com/macros/s/AKfycbzg3dwdc1nBE3rBf1iZYAT9egi-iNsez_wpr5-iEb3GCOvdzQmr_uArKj5WjdH2OBf-/exec',
    /**
     * Must match your Google Sheet tab name exactly (see tabs at the bottom).
     * If publish fails with "Sheet not found", update google-apps-script/Code.gs and redeploy.
     */
    SHEET_TAB_NAME: 'Sheet1',
    MAX_FULL_STORY_LENGTH: 50000,
};
