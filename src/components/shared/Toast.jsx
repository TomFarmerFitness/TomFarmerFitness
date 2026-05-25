/**
 * Toast.jsx — lightweight toast notification system
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved!');
 *   toast.error('Could not save — check your connection and try again');
 *   toast.info('Your macros have been updated');
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastCtx = createContext(null);

const ICONS = {
  success: '✓',
  error:   '⚠',
  info:    '●',
};
const COLORS = {
  success: { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.35)',  text: '#4ade80' },
  error:   { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.35)',  text: '#f87171' },
  info:    { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.35)', text: '#fb923c' },
};

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts(t => t.map(x => x.id === id ? { ...x, exiting: true } : x));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 320);
  }, []);

  const show = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_id;
    setToasts(t => [...t, { id, message, type, exiting: false }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const toast = {
    success: (msg, dur) => show(msg, 'success', dur),
    error:   (msg, dur) => show(msg, 'error',   dur ?? 6000),
    info:    (msg, dur) => show(msg, 'info',     dur),
    dismiss,
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}

      {/* Toast container */}
      <div style={{
        position: 'fixed', top: '66px', left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: '398px',
        zIndex: 9999, padding: '0 16px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const c = COLORS[t.type] || COLORS.info;
          return (
            <div key={t.id} style={{
              background: c.bg, border: `1px solid ${c.border}`,
              borderRadius: '12px', padding: '12px 14px',
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              pointerEvents: 'all',
              opacity: t.exiting ? 0 : 1,
              transform: t.exiting ? 'translateY(-6px) scale(0.97)' : 'translateY(0) scale(1)',
              transition: 'opacity 0.28s ease, transform 0.28s ease',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            }}>
              <span style={{ color: c.text, fontSize: '15px', fontWeight: '700', flexShrink: 0, lineHeight: 1.4 }}>
                {ICONS[t.type]}
              </span>
              <span style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.5, flex: 1 }}>
                {t.message}
              </span>
              <button onClick={() => dismiss(t.id)} style={{
                background: 'none', border: 'none', color: '#64748b',
                fontSize: '16px', cursor: 'pointer', padding: '0 2px',
                lineHeight: 1, flexShrink: 0, touchAction: 'manipulation',
              }}>×</button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
