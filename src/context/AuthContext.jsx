import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import config from '../config';

const AuthContext = createContext(null);

const SESSION_KEY  = 'tff_session';
const COOKIE_NAME  = 'tff_sess';
const SESSION_DAYS = 365; // keep clients logged in for a full year

// ── Cookie helpers (backup for when iOS clears localStorage) ─────────────────
function saveSessionCookie(session) {
  try {
    const exp = new Date();
    exp.setFullYear(exp.getFullYear() + 1);
    document.cookie =
      `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(session))}` +
      `; expires=${exp.toUTCString()}; path=/; SameSite=Lax`;
  } catch {}
}

function readSessionCookie() {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]*)'));
    if (m) return JSON.parse(decodeURIComponent(m[1]));
  } catch {}
  return null;
}

function clearSessionCookie() {
  try {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
  } catch {}
}

// SHA-256 hash using native Web Crypto API (no extra packages needed)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function isSessionValid(session) {
  if (!session?.loggedInAt) return false;
  const expiresAt = new Date(session.loggedInAt);
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  if (new Date() >= expiresAt) return false;
  // Enforce subscription expiry for clients
  if (session.userType === 'client' && session.accessUntil) {
    const accessExpiry = new Date(session.accessUntil + 'T23:59:59');
    if (new Date() > accessExpiry) return false;
  }
  return true;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on app load
  // Strategy: try localStorage first; if iOS cleared it, fall back to cookie.
  useEffect(() => {
    try {
      let session = null;

      // 1. Try localStorage
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        try { session = JSON.parse(raw); } catch {}
      }

      // 2. Fall back to cookie (more resilient on iOS)
      if (!session) session = readSessionCookie();

      if (session && isSessionValid(session)) {
        // Refresh timestamp — extends the window from last app open
        const refreshed = { ...session, loggedInAt: new Date().toISOString() };
        localStorage.setItem(SESSION_KEY, JSON.stringify(refreshed));
        saveSessionCookie(refreshed);
        setUser(refreshed);
      } else {
        localStorage.removeItem(SESSION_KEY);
        clearSessionCookie();
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
      clearSessionCookie();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const trimmedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    // ── 1. Check trainer credentials ──────────────────────────────────────
    const trainerEmail = (config.TRAINER_EMAIL || '').toLowerCase();
    const trainerHash = config.TRAINER_PASSWORD_HASH || '';

    if (trimmedEmail === trainerEmail && passwordHash === trainerHash) {
      const session = {
        userType: 'trainer',
        clientID: null,
        name: 'Tom Farmer',
        email: config.TRAINER_EMAIL,
        loggedInAt: new Date().toISOString(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      saveSessionCookie(session);
      setUser(session);
      return { success: true, userType: 'trainer' };
    }

    // ── 2. Check client credentials via Google Sheets ─────────────────────
    const apiKey = config.GOOGLE_SHEETS_API_KEY;
    const sheetId = config.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!apiKey || apiKey.startsWith('YOUR_') || !sheetId || sheetId.startsWith('YOUR_')) {
      return {
        success: false,
        error: 'Google Sheets is not configured yet. Please add your API key and Spreadsheet ID to the .env file.',
      };
    }

    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Clients?key=${apiKey}`;
      const response = await axios.get(url);
      const rows = response.data.values || [];

      if (rows.length < 2) {
        return { success: false, error: 'Invalid email or password.' };
      }

      const headers = rows[0];
      const idx = {
        clientID:     headers.indexOf('ClientID'),
        name:         headers.indexOf('Name'),
        email:        headers.indexOf('Email'),
        passwordHash: headers.indexOf('PasswordHash'),
        status:       headers.indexOf('Status'),
        accessUntil:  headers.indexOf('AccessUntil'),
      };

      const match = rows.slice(1).find(row => {
        const rowEmail  = (row[idx.email] || '').toLowerCase();
        const rowHash   = row[idx.passwordHash] || '';
        const rowStatus = (row[idx.status] || '').toLowerCase();
        return rowEmail === trimmedEmail && rowHash === passwordHash && rowStatus === 'active';
      });

      if (match) {
        // Check subscription expiry before allowing login
        const rowAccessUntil = idx.accessUntil >= 0 ? (match[idx.accessUntil] || '').trim() : '';
        if (rowAccessUntil) {
          const expiry = new Date(rowAccessUntil + 'T23:59:59');
          if (new Date() > expiry) {
            return { success: false, error: 'Your access has expired. Please contact your trainer to renew.' };
          }
        }
        const session = {
          userType: 'client',
          clientID: match[idx.clientID] || null,
          name: match[idx.name] || 'Client',
          email: match[idx.email],
          accessUntil: rowAccessUntil || null,
          loggedInAt: new Date().toISOString(),
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        saveSessionCookie(session);
        setUser(session);
        return { success: true, userType: 'client' };
      }
    } catch (err) {
      console.error('Sheets API error:', err);
      return {
        success: false,
        error: 'Could not verify credentials. Please check your connection and try again.',
      };
    }

    return { success: false, error: 'Invalid email or password.' };
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    clearSessionCookie();
    setUser(null);
  };

  const value = {
    user,
    userType: user?.userType ?? null,
    isAuthenticated: !!user,
    login,
    logout,
    loading,
  };

  // Don't render children until session restore is complete
  if (loading) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
