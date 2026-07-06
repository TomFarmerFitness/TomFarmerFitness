import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Dot,
} from 'recharts';
import { readSheet, appendToSheet } from '../../utils/sheets';
import { useAuth } from '../../context/AuthContext';
import config from '../../config';

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtShort(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function fmtMonthYear(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

function daysSince(isoStr) {
  if (!isoStr) return Infinity;
  const d = new Date(isoStr + 'T12:00:00');
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// Compress an image File to a base64 JPEG string (max 1200px wide, quality 0.82)
function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        // Strip the data:image/jpeg;base64, prefix
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Upload photo via Apps Script proxy → Google Drive
async function uploadPhotoToDrive({ base64, mimeType, fileName, clientId, clientName, photoType, date, note }) {
  const url = config.APPS_SCRIPT_URL;
  if (!url || url.startsWith('YOUR_')) throw new Error('apps_script_not_configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadPhoto',
      clientId, clientName, photoType, date, note,
      fileName, mimeType, base64,
    }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'upload_failed');
  return data; // { fileId, viewUrl, thumbnailUrl }
}

// ─── Reminder Card ────────────────────────────────────────────────────────────

function ReminderCard({ daysSinceLastLog }) {
  const days = Math.round(daysSinceLastLog);
  return (
    <div style={{
      margin: '0 16px 12px',
      background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(239,68,68,0.08))',
      border: '1px solid rgba(245,158,11,0.3)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontSize: 26 }}>⚖️</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fbbf24' }}>
          Time to log your weight
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
          {days === Infinity
            ? "You haven't logged your weight yet — tap Log Weight to start."
            : `It's been ${days} day${days !== 1 ? 's' : ''} since your last weigh-in.`}
        </div>
      </div>
    </div>
  );
}

// ─── Custom Tooltip for recharts ──────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface, #111)',
      border: '1px solid var(--border, #2a2a2a)',
      borderRadius: 8, padding: '8px 12px',
      fontSize: 13,
    }}>
      <div style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>{fmtDate(pt.date)}</div>
      <div style={{ color: '#22c55e', fontWeight: 700 }}>{pt.weight} kg</div>
      {pt.bodyFat && <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{pt.bodyFat}% body fat</div>}
    </div>
  );
}

// ─── WeightChart ─────────────────────────────────────────────────────────────

function WeightChart({ entries, targetWeight, height = 200 }) {
  if (entries.length === 0) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-tertiary)', fontSize: 14,
      }}>
        Log your first weight to see the chart
      </div>
    );
  }

  const data = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      date:    e.date,
      label:   fmtShort(e.date),
      weight:  parseFloat(e.weight),
      bodyFat: e.bodyFat ? parseFloat(e.bodyFat) : null,
    }))
    .filter(d => !isNaN(d.weight));

  // Y-axis domain with 2kg padding either side
  const weights = data.map(d => d.weight);
  if (targetWeight) weights.push(parseFloat(targetWeight));
  const minW = Math.floor(Math.min(...weights) - 2);
  const maxW = Math.ceil(Math.max(...weights) + 2);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--text-tertiary, #666)' }}
          tickLine={false} axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minW, maxW]}
          tick={{ fontSize: 10, fill: 'var(--text-tertiary, #666)' }}
          tickLine={false} axisLine={false}
          tickFormatter={v => `${v}`}
        />
        <Tooltip content={<CustomTooltip />} />
        {targetWeight && (
          <ReferenceLine
            y={parseFloat(targetWeight)}
            stroke="#f59e0b"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{ value: `Goal ${targetWeight}kg`, fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
          />
        )}
        <Line
          type="monotone"
          dataKey="weight"
          stroke="#22c55e"
          strokeWidth={2.5}
          dot={data.length <= 20 ? <Dot r={3} fill="#22c55e" strokeWidth={0} /> : false}
          activeDot={{ r: 5, fill: '#22c55e', strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── WeightStatsCards ─────────────────────────────────────────────────────────

function WeightStatsCards({ entries, targetWeight, startWeight }) {
  const sorted  = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted.length > 0 ? parseFloat(sorted[sorted.length - 1].weight) : null;
  const start   = startWeight ? parseFloat(startWeight) : (sorted.length > 0 ? parseFloat(sorted[0].weight) : null);
  const target  = targetWeight ? parseFloat(targetWeight) : null;

  const change    = (current != null && start != null) ? +(current - start).toFixed(1) : null;
  const remaining = (current != null && target != null) ? +(current - target).toFixed(1) : null;

  const stat = (label, value, sub, color) => (
    <div key={label} style={{
      background: 'var(--surface-secondary, #1a1a1a)',
      borderRadius: 12, padding: '12px 14px',
      border: '1px solid var(--border, #2a2a2a)',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)' }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const changeColor = change == null ? undefined : change < 0 ? '#22c55e' : change > 0 ? '#ef4444' : 'var(--text-primary)';
  const changePrefix = change != null && change > 0 ? '+' : '';

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 16px 12px' }}>
      {stat('Start',   start   != null ? `${start} kg`   : null)}
      {stat('Current', current != null ? `${current} kg` : null)}
      {stat('Change',
        change != null ? `${changePrefix}${change} kg` : null,
        change != null ? (change < 0 ? '↓ lost' : change > 0 ? '↑ gained' : '=') : null,
        changeColor)}
      {stat('Goal',    target  != null ? `${target} kg`  : null,  null, '#f59e0b')}
      {stat('To Go',
        remaining != null ? `${Math.abs(remaining)} kg` : null,
        remaining != null && remaining <= 0 ? '🎯 Goal reached!' : remaining != null ? `${remaining > 0 ? 'to lose' : 'to gain'}` : null,
        remaining != null && remaining <= 0 ? '#22c55e' : undefined)}
    </div>
  );
}

// ─── WeightHistoryTable ───────────────────────────────────────────────────────

function WeightHistoryTable({ entries, onEdit, onDelete }) {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
        No weight entries yet.
      </div>
    );
  }

  return (
    <div>
      {sorted.map((entry, i) => {
        // Previous entry (next in sorted array = older)
        const prev = sorted[i + 1];
        const change = prev ? +(parseFloat(entry.weight) - parseFloat(prev.weight)).toFixed(1) : null;
        const changeColor = change == null ? undefined : change < 0 ? '#22c55e' : change > 0 ? '#ef4444' : 'var(--text-tertiary)';

        return (
          <div key={entry.metricId} style={{
            display: 'flex', alignItems: 'center',
            padding: '11px 0',
            borderBottom: '1px solid var(--border, #1e1e1e)',
            gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                {parseFloat(entry.weight)} kg
                {entry.bodyFat && (
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 6 }}>
                    · {entry.bodyFat}% BF
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {fmtDate(entry.date)}
                {entry.notes && <span style={{ marginLeft: 6, color: 'var(--text-tertiary)' }}>· {entry.notes}</span>}
              </div>
            </div>

            {change != null && (
              <div style={{ fontSize: 13, fontWeight: 600, color: changeColor, minWidth: 48, textAlign: 'right' }}>
                {change > 0 ? '+' : ''}{change} kg
              </div>
            )}

            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button onClick={() => onEdit(entry)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', fontSize: 15, padding: '4px 6px', borderRadius: 6,
              }}>✏️</button>
              <button onClick={() => onDelete(entry)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-tertiary)', fontSize: 15, padding: '4px 6px', borderRadius: 6,
              }}>🗑️</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── Bottom sheet animation helpers ──────────────────────────────────────────

function useSlideIn() {
  const overlayRef = useRef(null);
  const sheetRef   = useRef(null);
  useEffect(() => {
    const overlay = overlayRef.current;
    const sheet   = sheetRef.current;
    if (!overlay || !sheet) return;
    overlay.style.opacity = '0';
    sheet.style.transform = 'translateY(100%)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.25s';
      sheet.style.transition   = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
      overlay.style.opacity    = '1';
      sheet.style.transform    = 'translateY(0)';
    }));
  }, []);
  function close(cb) {
    const overlay = overlayRef.current;
    const sheet   = sheetRef.current;
    if (overlay) { overlay.style.transition = 'opacity 0.2s'; overlay.style.opacity = '0'; }
    if (sheet)   { sheet.style.transition   = 'transform 0.25s'; sheet.style.transform = 'translateY(100%)'; }
    setTimeout(cb, 250);
  }
  return { overlayRef, sheetRef, close };
}

// ─── LogWeightModal ───────────────────────────────────────────────────────────

function LogWeightModal({ existingEntry, onSave, onClose }) {
  const { overlayRef, sheetRef, close } = useSlideIn();
  const isEdit = !!existingEntry;

  const [weight,  setWeight]  = useState(existingEntry?.weight  || '');
  const [bodyFat, setBodyFat] = useState(existingEntry?.bodyFat || '');
  const [notes,   setNotes]   = useState(existingEntry?.notes   || '');
  const [date,    setDate]    = useState(existingEntry?.date     || todayISO());
  const [saving,  setSaving]  = useState(false);

  async function handleSave() {
    if (!weight || isNaN(parseFloat(weight))) return;
    setSaving(true);
    try {
      await onSave({ weight: parseFloat(weight).toFixed(1), bodyFat, notes, date });
      close(onClose);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-secondary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: 10, padding: '12px 14px',
    color: 'var(--text-primary)', fontSize: 15, outline: 'none',
  };

  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) close(onClose); }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div ref={sheetRef} style={{
        width: '100%', maxWidth: 430, background: 'var(--surface, #111)',
        borderRadius: '20px 20px 0 0',
        padding: '0 16px calc(20px + env(safe-area-inset-bottom))',
        maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border, #333)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {isEdit ? 'Edit Weight Entry' : 'Log Weight'}
          </h2>
          <button onClick={() => close(onClose)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 22 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Weight (kg) *</label>
            <input type="number" step="0.1" min="30" max="300" placeholder="e.g. 82.5"
              style={inputStyle} value={weight} onChange={e => setWeight(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Body Fat % <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></label>
            <input type="number" step="0.1" min="3" max="60" placeholder="e.g. 18.5"
              style={inputStyle} value={bodyFat} onChange={e => setBodyFat(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Date</label>
            <input type="date" max={todayISO()} style={inputStyle} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Notes <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></label>
            <input type="text" placeholder="e.g. After gym, dehydrated…"
              style={inputStyle} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <button onClick={handleSave} disabled={!weight || saving} style={{
            marginTop: 4, padding: '14px', borderRadius: 12, border: 'none',
            background: (!weight || saving) ? '#2a2a2a' : '#22c55e',
            color: (!weight || saving) ? 'var(--text-tertiary)' : '#000',
            fontSize: 15, fontWeight: 700, cursor: (!weight || saving) ? 'default' : 'pointer',
          }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Log Weight'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PhotoUploadModal ─────────────────────────────────────────────────────────

const PHOTO_TYPES = ['Front', 'Side', 'Back'];

function PhotoUploadModal({ clientId, clientName, onSave, onClose }) {
  const { overlayRef, sheetRef, close } = useSlideIn();
  const fileRef = useRef(null);

  const [photoType, setPhotoType] = useState('Front');
  const [date,      setDate]      = useState(todayISO());
  const [note,      setNote]      = useState('');
  const [preview,   setPreview]   = useState(null);
  const [file,      setFile]      = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError('');
    const reader = new FileReader();
    reader.onload = ev => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const base64 = await compressImageToBase64(file);
      const fileName = `${clientId}_${photoType}_${date}.jpg`;
      await onSave({ base64, mimeType: 'image/jpeg', fileName, photoType, date, note });
      close(onClose);
    } catch (e) {
      setError(e.message === 'apps_script_not_configured'
        ? 'Apps Script not configured yet — set up VITE_APPS_SCRIPT_URL to enable photo uploads.'
        : `Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface-secondary, #1a1a1a)',
    border: '1px solid var(--border, #333)',
    borderRadius: 10, padding: '12px 14px',
    color: 'var(--text-primary)', fontSize: 15, outline: 'none',
  };

  return (
    <div ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) close(onClose); }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div ref={sheetRef} style={{
        width: '100%', maxWidth: 430, background: 'var(--surface, #111)',
        borderRadius: '20px 20px 0 0',
        padding: '0 16px calc(20px + env(safe-area-inset-bottom))',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border, #333)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Upload Progress Photo</h2>
          <button onClick={() => close(onClose)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 22 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Photo type pills */}
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Photo type</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {PHOTO_TYPES.map(t => (
                <button key={t} onClick={() => setPhotoType(t)} style={{
                  flex: 1, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontSize: 14, fontWeight: 500,
                  background: photoType === t ? '#22c55e' : 'var(--surface-secondary, #1a1a1a)',
                  color: photoType === t ? '#000' : 'var(--text-secondary)',
                }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Photo picker */}
          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }} onChange={handleFileChange} />
            {preview ? (
              <div style={{ position: 'relative' }}>
                <img src={preview} alt="preview" style={{
                  width: '100%', maxHeight: 260, objectFit: 'cover',
                  borderRadius: 12, display: 'block',
                }} />
                <button onClick={() => { setPreview(null); setFile(null); fileRef.current.value = ''; }}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%',
                    color: '#fff', width: 28, height: 28, cursor: 'pointer', fontSize: 16, lineHeight: 1,
                  }}>×</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current.click()} style={{
                width: '100%', padding: '40px 0', borderRadius: 12,
                border: '2px dashed var(--border, #333)',
                background: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 36 }}>📷</span>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Tap to take or choose photo</span>
              </button>
            )}
          </div>

          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Date</label>
            <input type="date" max={todayISO()} style={inputStyle} value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Note <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></label>
            <input type="text" placeholder="e.g. 10 weeks in" style={inputStyle} value={note} onChange={e => setNote(e.target.value)} />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#fca5a5' }}>
              {error}
            </div>
          )}

          <button onClick={handleUpload} disabled={!file || uploading} style={{
            padding: '14px', borderRadius: 12, border: 'none',
            background: (!file || uploading) ? '#2a2a2a' : '#22c55e',
            color: (!file || uploading) ? 'var(--text-tertiary)' : '#000',
            fontSize: 15, fontWeight: 700, cursor: (!file || uploading) ? 'default' : 'pointer',
          }}>
            {uploading ? 'Uploading…' : 'Upload Photo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PhotoViewer (full-size lightbox) ────────────────────────────────────────

function PhotoViewer({ photo, onClose }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.2s';
      el.style.opacity    = '1';
    }));
  }, []);
  function close() {
    const el = overlayRef.current;
    if (el) { el.style.transition = 'opacity 0.15s'; el.style.opacity = '0'; }
    setTimeout(onClose, 150);
  }

  return (
    <div ref={overlayRef} onClick={close} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <button onClick={close} style={{
        position: 'absolute', top: 16, right: 16,
        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
        width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 20, lineHeight: 1,
      }}>×</button>
      <img src={photo.driveViewURL} alt={photo.photoType}
        style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: 8 }}
        onClick={e => e.stopPropagation()}
      />
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
          {photo.photoType} · {fmtDate(photo.date)}
        </div>
        {photo.note && <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{photo.note}</div>}
      </div>
    </div>
  );
}

// ─── CompareModal ─────────────────────────────────────────────────────────────

function CompareModal({ photos, onClose }) {
  const [leftId,  setLeftId]  = useState(photos[photos.length - 1]?.photoId || '');
  const [rightId, setRightId] = useState(photos[0]?.photoId || '');

  const left  = photos.find(p => p.photoId === leftId);
  const right = photos.find(p => p.photoId === rightId);

  const selectStyle = {
    background: 'var(--surface-secondary, #1a1a1a)', border: '1px solid var(--border, #333)',
    borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 13,
    width: '100%', outline: 'none',
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.95)',
      display: 'flex', flexDirection: 'column',
      padding: 'env(safe-area-inset-top) 0 env(safe-area-inset-bottom)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}
        onClick={e => e.stopPropagation()}>
        <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>Compare Photos</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 22 }}>×</button>
      </div>

      {/* Selectors */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 12px 10px' }}
        onClick={e => e.stopPropagation()}>
        <select style={selectStyle} value={leftId} onChange={e => setLeftId(e.target.value)}>
          {photos.map(p => (
            <option key={p.photoId} value={p.photoId}>{p.photoType} · {fmtShort(p.date)}</option>
          ))}
        </select>
        <select style={selectStyle} value={rightId} onChange={e => setRightId(e.target.value)}>
          {photos.map(p => (
            <option key={p.photoId} value={p.photoId}>{p.photoType} · {fmtShort(p.date)}</option>
          ))}
        </select>
      </div>

      {/* Side-by-side images */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1, padding: '0 4px' }}
        onClick={e => e.stopPropagation()}>
        {[left, right].map((photo, i) => (
          <div key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
            {photo ? (
              <>
                <img src={photo.driveViewURL} alt={photo.photoType}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                  padding: '20px 8px 8px',
                  fontSize: 12, color: '#fff', textAlign: 'center',
                }}>
                  {photo.photoType} · {fmtShort(photo.date)}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569', fontSize: 13 }}>
                Select a photo
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PhotoGallery ──────────────────────────────────────────────────────────────

function PhotoGallery({ photos, onViewPhoto, compareMode, selectedForCompare, onToggleCompare }) {
  // Group by month
  const grouped = {};
  photos.forEach(p => {
    const month = fmtMonthYear(p.date);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(p);
  });

  const months = Object.keys(grouped).sort((a, b) => {
    const dateA = new Date(grouped[a][0].date + 'T12:00:00');
    const dateB = new Date(grouped[b][0].date + 'T12:00:00');
    return dateB - dateA;
  });

  if (photos.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No progress photos yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Tap Upload Photo to add your first check-in photo.</div>
      </div>
    );
  }

  return (
    <div>
      {months.map(month => (
        <div key={month} style={{ marginBottom: 20 }}>
          <div style={{ padding: '8px 16px 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {month}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3,
            padding: '0 16px',
          }}>
            {grouped[month].map(photo => {
              const isSelected = selectedForCompare?.includes(photo.photoId);
              return (
                <div key={photo.photoId} style={{ position: 'relative', aspectRatio: '3/4', overflow: 'hidden', borderRadius: 8, cursor: 'pointer' }}
                  onClick={() => compareMode ? onToggleCompare(photo.photoId) : onViewPhoto(photo)}>
                  <img
                    src={photo.driveThumbURL || photo.driveViewURL}
                    alt={photo.photoType}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    loading="lazy"
                  />
                  {/* Type label */}
                  <div style={{
                    position: 'absolute', top: 5, left: 5,
                    background: 'rgba(0,0,0,0.55)', borderRadius: 6,
                    padding: '2px 6px', fontSize: 10, color: '#fff', fontWeight: 600,
                  }}>{photo.photoType}</div>
                  {/* Compare selection overlay */}
                  {compareMode && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      background: isSelected ? 'rgba(34,197,94,0.25)' : 'rgba(0,0,0,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s',
                    }}>
                      {isSelected && (
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: '#22c55e', border: '2px solid #fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, color: '#000',
                        }}>✓</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── ProgressPage (main) ──────────────────────────────────────────────────────

export default function ProgressPage() {
  const { user } = useAuth();

  const [activeTab,       setActiveTab]       = useState('weight');  // 'weight' | 'photos'
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [clientData,      setClientData]      = useState(null);
  const [weightEntries,   setWeightEntries]   = useState([]);
  const [photos,          setPhotos]          = useState([]);

  // Modals
  const [showLogWeight,   setShowLogWeight]   = useState(false);
  const [editingEntry,    setEditingEntry]    = useState(null);
  const [viewingPhoto,    setViewingPhoto]    = useState(null);
  const [compareMode,     setCompareMode]     = useState(false);
  const [compareSelected, setCompareSelected] = useState([]);
  const [showCompare,     setShowCompare]     = useState(false);
  const [showUploadPhoto, setShowUploadPhoto] = useState(false);

  // ── Fetch data ─────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!user?.clientID) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const [clients, bodyMetrics, progressPhotos] = await Promise.all([
        readSheet('Clients'),
        readSheet('BodyMetrics').catch(() => []),      // graceful if tab missing
        readSheet('ProgressPhotos').catch(() => []),   // graceful if tab missing
      ]);

      const client = clients.find(c => c.ClientID === user.clientID);
      setClientData(client || null);

      const myMetrics = bodyMetrics
        .filter(r => r.ClientID === user.clientID)
        .map(r => ({
          metricId: r.MetricID || '',
          date:     (r.Date    || '').slice(0, 10),
          weight:   r.Weight   || '',
          bodyFat:  r.BodyFat  || '',
          notes:    r.Notes    || '',
          loggedAt: r.LoggedAt || '',
        }))
        .filter(r => r.date && r.weight);

      setWeightEntries(myMetrics);

      const myPhotos = progressPhotos
        .filter(r => r.ClientID === user.clientID)
        .map(r => ({
          photoId:       r.PhotoID      || '',
          date:          (r.Date        || '').slice(0, 10),
          photoType:     r.PhotoType    || 'Front',
          note:          r.Note         || '',
          driveFileId:   r.DriveFileID  || '',
          driveViewURL:  r.DriveViewURL || '',
          driveThumbURL: r.DriveThumbURL || '',
          uploadedAt:    r.UploadedAt   || '',
        }))
        .filter(r => r.date && r.driveViewURL);

      setPhotos(myPhotos);
    } catch (e) {
      console.error('ProgressPage fetch error:', e);
      setError('Could not load progress data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Weight: save (new or edit) ─────────────────────────────────────────────

  async function handleSaveWeight({ weight, bodyFat, notes, date }) {
    if (editingEntry) {
      // Edit: write updated row — optimistic update only (trainer can fix in sheet if needed)
      // For now we update local state. A full delete+re-append could be done via Apps Script.
      setWeightEntries(prev => prev.map(e =>
        e.metricId === editingEntry.metricId
          ? { ...e, weight, bodyFat, notes, date }
          : e
      ));
      setEditingEntry(null);
      return;
    }

    // New entry
    const metricId = `BM-${Date.now()}`;
    const row = {
      MetricID:  metricId,
      ClientID:  user.clientID,
      Date:      date,
      Weight:    weight,
      BodyFat:   bodyFat || '',
      Notes:     notes   || '',
      LoggedAt:  new Date().toISOString(),
    };

    // Optimistic update
    setWeightEntries(prev => [...prev, {
      metricId, date, weight, bodyFat, notes, loggedAt: row.LoggedAt,
    }]);

    try {
      await appendToSheet('BodyMetrics', row);
    } catch (e) {
      console.error('Failed to save weight:', e);
      setWeightEntries(prev => prev.filter(e => e.metricId !== metricId));
    }
  }

  // ── Weight: delete ─────────────────────────────────────────────────────────

  function handleDeleteWeight(entry) {
    if (!window.confirm(`Delete weight entry for ${fmtDate(entry.date)} (${entry.weight} kg)?`)) return;
    setWeightEntries(prev => prev.filter(e => e.metricId !== entry.metricId));
    // Note: also call Apps Script deleteRow action if implemented
    appendToSheet && fetch(config.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteRow', tab: 'BodyMetrics', idColumn: 'MetricID', id: entry.metricId }),
    }).catch(() => {}); // best-effort
  }

  // ── Photos: upload ─────────────────────────────────────────────────────────

  async function handleUploadPhoto({ base64, mimeType, fileName, photoType, date, note }) {
    const photoId = `PP-${Date.now()}`;

    // Upload to Drive via Apps Script
    const result = await uploadPhotoToDrive({
      base64, mimeType, fileName, clientId: user.clientID,
      clientName: clientData?.Name || user.clientID,
      photoType, date, note,
    });

    const row = {
      PhotoID:       photoId,
      ClientID:      user.clientID,
      ClientName:    clientData?.Name || '',
      PhotoType:     photoType,
      Date:          date,
      Note:          note || '',
      DriveFileID:   result.fileId,
      DriveViewURL:  result.viewUrl,
      DriveThumbURL: result.thumbnailUrl,
      UploadedAt:    new Date().toISOString(),
    };

    // Save to ProgressPhotos sheet
    await appendToSheet('ProgressPhotos', row);

    // Notify trainer: create a Flagged AIQuestion
    const questionId = `AQ-PP-${Date.now()}`;
    appendToSheet('AIQuestions', {
      QuestionID:  questionId,
      ClientID:    user.clientID,
      ClientName:  clientData?.Name || user.clientID,
      Question:    `📸 New progress photo uploaded: ${photoType} — ${fmtDate(date)}${note ? ` (${note})` : ''}`,
      Answer:      '',
      Status:      'Flagged',
      AskedAt:     new Date().toISOString(),
      AnsweredAt:  '',
    }).catch(() => {});

    // Update local state
    setPhotos(prev => [...prev, {
      photoId,
      date, photoType, note,
      driveFileId:   result.fileId,
      driveViewURL:  result.viewUrl,
      driveThumbURL: result.thumbnailUrl,
      uploadedAt:    new Date().toISOString(),
    }]);
  }

  // ── Compare mode helpers ───────────────────────────────────────────────────

  function toggleCompareSelect(photoId) {
    setCompareSelected(prev => {
      if (prev.includes(photoId)) return prev.filter(id => id !== photoId);
      if (prev.length >= 2) return [prev[1], photoId]; // replace oldest selection
      return [...prev, photoId];
    });
  }

  function startCompare() {
    if (compareSelected.length === 2) setShowCompare(true);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const sorted        = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
  const latestEntry   = sorted[sorted.length - 1];
  const lastLogDate   = latestEntry?.date;
  const sinceLastLog  = lastLogDate ? daysSince(lastLogDate) : Infinity;
  const showReminder  = sinceLastLog >= 3;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading progress…</div>
        </div>
      </div>
    );
  }

  const cardStyle = {
    background: 'var(--surface, #111)',
    borderRadius: 14,
    border: '1px solid var(--border, #2a2a2a)',
  };

  return (
    <div style={{ paddingBottom: 24 }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', margin: '0 16px 8px', gap: 6 }}>
        {[['weight','⚖️ Weight'],['photos','📷 Photos']].map(([val, label]) => (
          <button key={val} onClick={() => setActiveTab(val)} style={{
            flex: 1, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
            background: activeTab === val ? '#22c55e' : 'var(--surface, #111)',
            color: activeTab === val ? '#000' : 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {error && (
        <div style={{ margin: '0 16px 10px', padding: '10px 14px', borderRadius: 10, background: '#1a1a1a', border: '1px solid #333', fontSize: 13, color: '#fbbf24' }}>
          {error}
        </div>
      )}

      {/* ══════════════════ WEIGHT TAB ══════════════════ */}
      {activeTab === 'weight' && (
        <>
          {/* Reminder */}
          {showReminder && <ReminderCard daysSinceLastLog={sinceLastLog} />}

          {/* Log Weight button */}
          <div style={{ padding: '0 16px 12px' }}>
            <button onClick={() => { setEditingEntry(null); setShowLogWeight(true); }} style={{
              width: '100%', padding: '14px', borderRadius: 14, border: 'none',
              background: '#22c55e', color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>
              + Log Weight
            </button>
          </div>

          {/* Chart card */}
          <div style={{ ...cardStyle, margin: '0 16px 12px', padding: '14px 14px 10px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Weight over time
            </div>
            <WeightChart
              entries={weightEntries}
              targetWeight={clientData?.TargetWeight || null}
              height={200}
            />
          </div>

          {/* Stats cards */}
          <WeightStatsCards
            entries={weightEntries}
            targetWeight={clientData?.TargetWeight || null}
            startWeight={clientData?.StartWeight   || null}
          />

          {/* History table */}
          <div style={{ ...cardStyle, margin: '0 16px 0', padding: '14px 14px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              Weight History
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8 }}>
                {weightEntries.length} {weightEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <WeightHistoryTable
              entries={weightEntries}
              onEdit={entry => { setEditingEntry(entry); setShowLogWeight(true); }}
              onDelete={handleDeleteWeight}
            />
          </div>
        </>
      )}

      {/* ══════════════════ PHOTOS TAB ══════════════════ */}
      {activeTab === 'photos' && (
        <>
          {/* Upload + Compare buttons */}
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
            <button onClick={() => setShowUploadPhoto(true)} style={{
              flex: 1, padding: '13px', borderRadius: 12, border: 'none',
              background: '#22c55e', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>
              📷 Upload Photo
            </button>
            {photos.length >= 2 && (
              <button onClick={() => { setCompareMode(c => !c); setCompareSelected([]); }} style={{
                padding: '13px 16px', borderRadius: 12, border: `1px solid ${compareMode ? '#22c55e' : 'var(--border, #333)'}`,
                background: compareMode ? 'rgba(34,197,94,0.12)' : 'var(--surface, #111)',
                color: compareMode ? '#22c55e' : 'var(--text-secondary)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
                ⚡ Compare
              </button>
            )}
          </div>

          {/* Compare banner */}
          {compareMode && (
            <div style={{
              margin: '0 16px 10px', padding: '11px 14px', borderRadius: 12,
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 13, color: '#22c55e' }}>
                {compareSelected.length === 0 ? 'Tap two photos to compare' :
                 compareSelected.length === 1 ? 'Tap one more photo' :
                 'Ready to compare'}
              </span>
              {compareSelected.length === 2 && (
                <button onClick={startCompare} style={{
                  background: '#22c55e', border: 'none', borderRadius: 8,
                  padding: '6px 12px', color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>Compare →</button>
              )}
            </div>
          )}

          {/* Gallery */}
          <PhotoGallery
            photos={photos}
            onViewPhoto={setViewingPhoto}
            compareMode={compareMode}
            selectedForCompare={compareSelected}
            onToggleCompare={toggleCompareSelect}
          />
        </>
      )}

      {/* ══════════════════ MODALS ══════════════════ */}

      {showLogWeight && (
        <LogWeightModal
          existingEntry={editingEntry}
          onSave={handleSaveWeight}
          onClose={() => { setShowLogWeight(false); setEditingEntry(null); }}
        />
      )}

      {showUploadPhoto && (
        <PhotoUploadModal
          clientId={user.clientID}
          clientName={clientData?.Name || user.clientID}
          onSave={handleUploadPhoto}
          onClose={() => setShowUploadPhoto(false)}
        />
      )}

      {viewingPhoto && (
        <PhotoViewer photo={viewingPhoto} onClose={() => setViewingPhoto(null)} />
      )}

      {showCompare && (
        <CompareModal
          photos={photos.filter(p => compareSelected.includes(p.photoId))}
          onClose={() => { setShowCompare(false); setCompareMode(false); setCompareSelected([]); }}
        />
      )}
    </div>
  );
}
