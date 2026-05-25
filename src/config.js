// App Configuration
// These values are injected from environment variables at build time.
// Do NOT commit real secrets here — use the .env file instead.

const config = {
  GOOGLE_SHEETS_API_KEY:        import.meta.env.VITE_GOOGLE_SHEETS_API_KEY        || 'YOUR_GOOGLE_SHEETS_API_KEY',
  GOOGLE_SHEETS_SPREADSHEET_ID: import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID',
  YOUTUBE_API_KEY:              import.meta.env.VITE_YOUTUBE_API_KEY              || 'YOUR_YOUTUBE_API_KEY',
  TRAINER_EMAIL:                import.meta.env.VITE_TRAINER_EMAIL                || 'trainer@example.com',
  TRAINER_PASSWORD_HASH:        import.meta.env.VITE_TRAINER_PASSWORD_HASH        || 'YOUR_TRAINER_PASSWORD_HASH',
  // Apps Script proxy URL for write operations (append rows to Google Sheets).
  // Deploy src/utils/apps-script-proxy.gs as a Google Apps Script Web App,
  // then paste the deployment URL here.
  APPS_SCRIPT_URL:              import.meta.env.VITE_APPS_SCRIPT_URL              || 'YOUR_APPS_SCRIPT_URL',
};

export default config;
