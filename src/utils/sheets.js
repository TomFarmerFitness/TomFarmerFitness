import axios from 'axios';
import config from '../config';

const BASE_URL  = 'https://sheets.googleapis.com/v4/spreadsheets';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Cache helpers ────────────────────────────────────────────────────────────
function cacheKey(tab) { return `tff_sheet_${tab}`; }

function readCache(tab) {
  try {
    const raw = localStorage.getItem(cacheKey(tab));
    if (!raw) return { fresh: null, stale: null };
    const { data, ts } = JSON.parse(raw);
    const fresh = (Date.now() - ts) < CACHE_TTL ? data : null;
    return { fresh, stale: data };
  } catch { return { fresh: null, stale: null }; }
}

function writeCache(tab, data) {
  try {
    localStorage.setItem(cacheKey(tab), JSON.stringify({ data, ts: Date.now() }));
    localStorage.removeItem('tff_data_stale');
  } catch {}
}

function markStale() {
  try { localStorage.setItem('tff_data_stale', '1'); } catch {}
}

/** Returns true if the last data load fell back to stale cache. */
export function isDataStale() {
  try { return !!localStorage.getItem('tff_data_stale'); } catch { return false; }
}

/** Call after a successful live fetch to clear the stale flag. */
export function clearStaleFlag() {
  try { localStorage.removeItem('tff_data_stale'); } catch {}
}

// ─── Parse Sheets response rows ───────────────────────────────────────────────
function parseRows(rawValues) {
  const rows = rawValues || [];
  if (rows.length < 1) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
}

/**
 * Read a sheet tab.  Returns fresh data when available; otherwise
 * serves cached data (up to CACHE_TTL old).  On network failure,
 * falls back to any cached data (however old) and sets the stale flag.
 */
export async function readSheet(tabName) {
  const key = config.GOOGLE_SHEETS_API_KEY;
  const id  = config.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!key || key.startsWith('YOUR_') || !id || id.startsWith('YOUR_')) {
    throw new Error(
      'Google Sheets is not configured. Add VITE_GOOGLE_SHEETS_API_KEY and ' +
      'VITE_GOOGLE_SHEETS_SPREADSHEET_ID to your .env file.'
    );
  }

  // Return fresh cache if still valid
  const { fresh, stale } = readCache(tabName);
  if (fresh) return fresh;

  try {
    const url = `${BASE_URL}/${id}/values/${encodeURIComponent(tabName)}?key=${key}`;
    const res  = await axios.get(url);
    const data = parseRows(res.data.values);
    writeCache(tabName, data);
    return data;
  } catch (err) {
    // Network / API failure — serve stale cache if available
    if (stale) {
      markStale();
      return stale;
    }
    throw err; // no cache at all — propagate
  }
}

/** Invalidate the cache for a tab so the next readSheet() fetches fresh data. */
export function invalidateCache(tabName) {
  try { localStorage.removeItem(cacheKey(tabName)); } catch {}
}

// ─── Apps Script POST helper ──────────────────────────────────────────────────
// Uses fetch without Content-Type to avoid CORS preflight (Apps Script limitation).
// Apps Script receives the JSON body in e.postData.contents regardless.
async function scriptPost(payload) {
  const url = config.APPS_SCRIPT_URL;
  if (!url || url.startsWith('YOUR_')) {
    throw new Error(
      'Apps Script URL is not configured. Deploy the proxy web app and add ' +
      'VITE_APPS_SCRIPT_URL to your .env file.'
    );
  }
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(payload),
    // No Content-Type header — avoids CORS preflight for cross-origin requests
  });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(data?.error || 'Apps Script returned an error.');
  return data;
}

// ─── Write helpers ────────────────────────────────────────────────────────────
export async function appendToSheet(tabName, rowData) {
  const data = await scriptPost({ action: 'append', tab: tabName, row: rowData });
  invalidateCache(tabName); // bust cache on write
  return data;
}

export async function lookupFood(query) {
  const data = await scriptPost({ action: 'lookupFood', query });
  return data.results || [];
}

export async function upsertRow(tabName, idColumn, id, rowData) {
  const data = await scriptPost({ action: 'upsertRow', tab: tabName, idColumn, id, row: rowData });
  invalidateCache(tabName);
  return data;
}
