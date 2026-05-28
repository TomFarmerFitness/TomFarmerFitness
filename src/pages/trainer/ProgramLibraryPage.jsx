import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { readSheet, appendToSheet } from '../../utils/sheets';
import config from '../../config';

// ─── Constants ────────────────────────────────────────────────────────────────

const GOAL_FILTERS = ['All', 'Weight Loss', 'Muscle Gain', 'Strength', 'General Fitness'];

const FOCUS_AREAS = [
  'Full Body', 'Upper Body', 'Lower Body', 'Push Day', 'Pull Day',
  'Legs', 'Chest & Triceps', 'Back & Biceps', 'Shoulders', 'Arms', 'Core',
];

const SESSION_DURATIONS = [20, 30, 45, 60, 75, 90];

const TRAINING_TYPES = ['HIIT', 'Strength and Conditioning', 'Hypertrophy', 'Mobility'];

const EQUIPMENT_OPTIONS = [
  'Barbell', 'Dumbbells', 'Cables', 'Machines', 'Kettlebells',
  'Bodyweight', 'Resistance Bands', 'TRX', 'Smith Machine',
];

const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Hip Flexors', 'Full Body',
];

const GOAL_COLORS = {
  'Weight Loss':     { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: '#60a5fa' },
  'Muscle Gain':     { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.4)',  text: '#c084fc' },
  'Strength':        { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',   text: '#f87171' },
  'General Fitness': { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.4)',   text: '#4ade80' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function todayISO() {
  return new Date().toISOString();
}

function countProgramExercises(programId, sessions) {
  return sessions
    .filter(s => s.ProgramID === programId)
    .reduce((total, s) => {
      try { return total + (JSON.parse(s.Exercises || '[]')).length; }
      catch { return total; }
    }, 0);
}

function initDays(count, existing = []) {
  return Array.from({ length: count }, (_, i) => existing[i] || {
    id:        generateId('day'),
    dayOrder:  i + 1,
    dayName:   '',
    focusArea: '',
    exercises: [],
  });
}

// ─── Apps Script helpers (write ops not in sheets.js) ─────────────────────────

async function callProxy(body) {
  const url = config.APPS_SCRIPT_URL;
  if (!url || url.startsWith('YOUR_')) throw new Error('apps_script_not_configured');
  const r = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(body),
    // No Content-Type header — avoids CORS preflight for Apps Script
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.error || 'proxy_error');
  return d;
}

async function upsertSheetRow(tab, idColumn, id, rowData) {
  return callProxy({ action: 'upsertRow', tab, idColumn, id, row: rowData });
}

async function deleteSheetRowsWhere(tab, column, value) {
  return callProxy({ action: 'deleteRowsWhere', tab, column, value }).catch(() => {});
}


// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      {GOAL_FILTERS.map(g => {
        const colors = GOAL_COLORS[g] || {};
        const isActive = active === g;
        return (
          <button key={g} onClick={() => onChange(g)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', border: 'none',
            background: isActive ? (colors.bg || 'rgba(249,115,22,0.15)') : 'rgba(255,255,255,0.05)',
            color:      isActive ? (colors.text || '#f97316') : '#64748b',
            outline:    isActive ? `1px solid ${colors.border || 'rgba(249,115,22,0.4)'}` : '1px solid transparent',
            transition: 'all 0.12s',
          }}>
            {g}
          </button>
        );
      })}
    </div>
  );
}

// ─── GoalTag ─────────────────────────────────────────────────────────────────

function GoalTag({ goal }) {
  const c = GOAL_COLORS[goal] || { bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.3)', text: '#94a3b8' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    }}>{goal || 'General'}</span>
  );
}

// ─── ProgramCard ─────────────────────────────────────────────────────────────

function ProgramCard({ program, exerciseCount, clientCount, onEdit, onDuplicate, onAssign }) {
  return (
    <div style={{
      background: '#1e293b', borderRadius: 14, padding: '20px',
      border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color 0.15s',
      cursor: 'pointer',
    }}
      onClick={onEdit}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', marginBottom: 6, lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {program.Name || 'Untitled Program'}
          </div>
          <GoalTag goal={program.Goal} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { icon: '📅', label: 'Days/week', value: program.DaysPerWeek || '—' },
          { icon: '💪', label: 'Exercises', value: exerciseCount || 0 },
          { icon: '👥', label: 'Clients',   value: clientCount || 0 },
        ].map(({ icon, label, value }) => (
          <div key={label} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px',
            textAlign: 'center', border: '1px solid rgba(255,255,255,0.04)',
          }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>{icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
            <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Description */}
      {program.Description && (
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {program.Description}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          onClick={e => { e.stopPropagation(); onAssign(); }}
          style={{
            flex: 1, padding: '8px', borderRadius: 8, border: 'none',
            background: 'rgba(249,115,22,0.1)', color: '#f97316',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.1)'; }}
        >
          Assign →
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDuplicate(); }}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent', color: '#64748b',
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#94a3b8'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#64748b'; }}
        >
          ⧉ Copy
        </button>
      </div>
    </div>
  );
}


// ─── AssignModal ──────────────────────────────────────────────────────────────
function AssignModal({ program, clients, assignedMap, onClose, onSave }) {
  const already = assignedMap[program.id] || [];
  const [selected, setSelected] = useState(new Set(already));
  const [saving, setSaving] = useState(false);

  const toggle = id => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(program.id, [...selected]); onClose(); }
    catch { setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%', maxWidth:'420px',
        maxHeight:'80vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'16px' }}>Assign Program</div>
            <div style={{ color:'#94a3b8', fontSize:'13px', marginTop:'2px' }}>{program.name}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
        </div>

        <div style={{ padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          color:'#64748b', fontSize:'12px' }}>
          SELECT CLIENTS — {selected.size} selected
        </div>

        <div style={{ overflowY:'auto', flex:1 }}>
          {clients.length === 0 ? (
            <div style={{ padding:'32px', textAlign:'center', color:'#64748b' }}>No clients found</div>
          ) : clients.map(c => {
            const id = c.ClientID;
            const on = selected.has(id);
            return (
              <button key={id} onClick={() => toggle(id)}
                style={{ width:'100%', background:'none', border:'none', padding:'12px 20px',
                  display:'flex', alignItems:'center', gap:'12px', cursor:'pointer',
                  borderBottom:'1px solid rgba(255,255,255,0.05)',
                  transition:'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <div style={{ width:'32px', height:'32px', borderRadius:'50%',
                  background: on ? '#f97316' : 'rgba(255,255,255,0.08)',
                  border: `2px solid ${on ? '#f97316' : 'rgba(255,255,255,0.15)'}`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color: on ? '#fff' : '#64748b', fontSize:'14px', flexShrink:0,
                  transition:'all 0.15s' }}>
                  {on ? '✓' : c.Name?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ textAlign:'left', flex:1 }}>
                  <div style={{ color:'#f1f5f9', fontSize:'14px', fontWeight:500 }}>{c.Name}</div>
                  <div style={{ color:'#64748b', fontSize:'12px' }}>{c.Goal || 'No goal set'}</div>
                </div>
                {already.includes(id) && !on && (
                  <span style={{ color:'#64748b', fontSize:'11px' }}>was assigned</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ padding:'16px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px' }}>
          <button onClick={onClose}
            style={{ flex:1, padding:'12px', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
              color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex:2, padding:'12px', background: saving ? '#7c3f0a' : '#f97316',
              border:'none', borderRadius:'10px', color:'#fff',
              fontSize:'14px', fontWeight:600, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : `Assign to ${selected.size} client${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── GenerateAIModal ──────────────────────────────────────────────────────────
function GenerateAIModal({ onClose, onGenerated }) {
  const [goal, setGoal]           = useState('Muscle Gain');
  const [daysPerWeek, setDays]    = useState(4);
  const [duration, setDuration]   = useState(8);
  const [level, setLevel]         = useState('Intermediate');
  const [equipment, setEquipment] = useState([]);
  const [focus, setFocus]         = useState([]);
  const [notes, setNotes]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  const toggleArr = (arr, setArr, val) =>
    setArr(a => a.includes(val) ? a.filter(x => x !== val) : [...a, val]);

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(config.APPS_SCRIPT_URL, {
        method:'POST', redirect: 'follow',
        body: JSON.stringify({
          action:'generateProgram', goal, daysPerWeek, durationWeeks: duration,
          level, equipment, focusAreas: focus, notes,
        }),
        // No Content-Type — avoids CORS preflight
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed');
      onGenerated(data.program);
      onClose();
    } catch(e) { setError(e.message); setLoading(false); }
  };

  const chipStyle = (active) => ({
    padding:'6px 12px', borderRadius:'20px', fontSize:'12px', cursor:'pointer', border:'none',
    background: active ? '#f97316' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : '#94a3b8', fontWeight: active ? 600 : 400, transition:'all 0.15s',
  });

  const labelStyle = { color:'#64748b', fontSize:'12px', letterSpacing:'0.05em', marginBottom:'8px' };
  const inputStyle = {
    width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'10px 12px', boxSizing:'border-box',
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%', maxWidth:'480px',
        maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'16px' }}>✨ AI Program Generator</div>
            <div style={{ color:'#94a3b8', fontSize:'13px', marginTop:'2px' }}>
              Claude will build a complete program for you
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'20px', display:'flex', flexDirection:'column', gap:'18px' }}>

          <div>
            <div style={labelStyle}>GOAL</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {['Weight Loss','Muscle Gain','Strength','General Fitness'].map(g => (
                <button key={g} style={chipStyle(goal===g)} onClick={() => setGoal(g)}>{g}</button>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
            <div>
              <div style={labelStyle}>DAYS PER WEEK</div>
              <select value={daysPerWeek} onChange={e => setDays(+e.target.value)} style={inputStyle}>
                {[2,3,4,5,6].map(n => <option key={n} value={n}>{n} days</option>)}
              </select>
            </div>
            <div>
              <div style={labelStyle}>DURATION</div>
              <select value={duration} onChange={e => setDuration(+e.target.value)} style={inputStyle}>
                {[4,6,8,10,12,16].map(n => <option key={n} value={n}>{n} weeks</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={labelStyle}>LEVEL</div>
            <div style={{ display:'flex', gap:'6px' }}>
              {['Beginner','Intermediate','Advanced'].map(l => (
                <button key={l} style={chipStyle(level===l)} onClick={() => setLevel(l)}>{l}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>EQUIPMENT</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {EQUIPMENT_OPTIONS.map(e => (
                <button key={e} style={chipStyle(equipment.includes(e))}
                  onClick={() => toggleArr(equipment, setEquipment, e)}>{e}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>FOCUS AREAS</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {FOCUS_AREAS.map(f => (
                <button key={f} style={chipStyle(focus.includes(f))}
                  onClick={() => toggleArr(focus, setFocus, f)}>{f}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>ADDITIONAL NOTES (optional)</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="E.g. client has knee injury, prefers supersets, no barbell…"
              rows={3}
              style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }} />
          </div>

          {error && (
            <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
              borderRadius:'8px', padding:'10px 12px', color:'#fca5a5', fontSize:'13px' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding:'16px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px' }}>
          <button onClick={onClose}
            style={{ flex:1, padding:'12px', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
              color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={handleGenerate} disabled={loading}
            style={{ flex:2, padding:'12px',
              background: loading ? 'linear-gradient(135deg,#7c3f0a,#92400e)' : 'linear-gradient(135deg,#ea580c,#f97316)',
              border:'none', borderRadius:'10px', color:'#fff',
              fontSize:'14px', fontWeight:600, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? '✨ Generating…' : '✨ Generate Program'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── CreateProgramModal — Step 1: Details ────────────────────────────────────
function StepDetails({ data, onChange }) {
  const inputStyle = {
    width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'10px 12px', boxSizing:'border-box',
  };
  const labelStyle = { color:'#64748b', fontSize:'12px', letterSpacing:'0.05em', marginBottom:'6px', display:'block' };
  const chipStyle = (active) => ({
    padding:'7px 14px', borderRadius:'20px', fontSize:'13px', cursor:'pointer', border:'none',
    background: active ? '#f97316' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : '#94a3b8', fontWeight: active ? 600 : 400, transition:'all 0.15s',
  });

  const toggleEquip = val =>
    onChange('equipment', data.equipment.includes(val)
      ? data.equipment.filter(x => x !== val) : [...data.equipment, val]);

  const toggleFocus = val =>
    onChange('focusAreas', data.focusAreas.includes(val)
      ? data.focusAreas.filter(x => x !== val) : [...data.focusAreas, val]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>
      <div>
        <label style={labelStyle}>PROGRAM NAME *</label>
        <input value={data.name} onChange={e => onChange('name', e.target.value)}
          placeholder="e.g. 12-Week Hypertrophy Block"
          style={inputStyle} />
      </div>

      <div>
        <label style={labelStyle}>DESCRIPTION</label>
        <textarea value={data.description} onChange={e => onChange('description', e.target.value)}
          placeholder="What is this program designed to achieve?"
          rows={3} style={{ ...inputStyle, resize:'vertical', fontFamily:'inherit' }} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
        <div>
          <label style={labelStyle}>GOAL</label>
          <select value={data.goal} onChange={e => onChange('goal', e.target.value)} style={inputStyle}>
            {['Weight Loss','Muscle Gain','Strength','General Fitness'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>DAYS PER WEEK</label>
          <select value={data.daysPerWeek} onChange={e => onChange('daysPerWeek', +e.target.value)} style={inputStyle}>
            {[1,2,3,4,5,6,7].map(n => <option key={n} value={n}>{n} day{n!==1?'s':''}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
        <div>
          <label style={labelStyle}>TRAINING TYPE</label>
          <select value={data.trainingType} onChange={e => onChange('trainingType', e.target.value)} style={inputStyle}>
            {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>SESSION DURATION</label>
          <select value={data.sessionDuration} onChange={e => onChange('sessionDuration', +e.target.value)} style={inputStyle}>
            {SESSION_DURATIONS.map(d => <option key={d} value={d}>{d} mins</option>)}
          </select>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
        <div>
          <label style={labelStyle}>DURATION (weeks)</label>
          <input type="number" min={1} max={52} value={data.durationWeeks}
            onChange={e => onChange('durationWeeks', +e.target.value)}
            style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>LEVEL</label>
          <select value={data.level} onChange={e => onChange('level', e.target.value)} style={inputStyle}>
            {['Beginner','Intermediate','Advanced'].map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle}>EQUIPMENT</label>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
          {EQUIPMENT_OPTIONS.map(e => (
            <button key={e} style={chipStyle(data.equipment.includes(e))}
              onClick={() => toggleEquip(e)}>{e}</button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>FOCUS AREAS</label>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
          {FOCUS_AREAS.map(f => (
            <button key={f} style={chipStyle(data.focusAreas.includes(f))}
              onClick={() => toggleFocus(f)}>{f}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CreateProgramModal — Step 2: Build Days ─────────────────────────────────
function StepBuildDays({ days, daysPerWeek, onDaysChange }) {
  const [editingIdx, setEditingIdx] = useState(null);
  const inputStyle = {
    background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'8px 10px',
  };

  // Ensure days array is synced with daysPerWeek
  useEffect(() => {
    if (days.length !== daysPerWeek) {
      onDaysChange(initDays(daysPerWeek, days));
    }
  }, [daysPerWeek]);

  const updateDay = (i, field, val) => {
    const next = [...days];
    next[i] = { ...next[i], [field]: val };
    onDaysChange(next);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px', marginBottom:'4px' }}>
        Name each training day and pick a muscle focus. You'll add exercises in the next step.
      </div>
      {days.map((day, i) => (
        <div key={day.id} style={{ background:'rgba(255,255,255,0.04)',
          border:'1px solid rgba(255,255,255,0.08)', borderRadius:'10px', padding:'14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
            <div style={{ width:'28px', height:'28px', borderRadius:'50%',
              background:'rgba(249,115,22,0.15)', border:'1px solid rgba(249,115,22,0.3)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#f97316', fontSize:'12px', fontWeight:700, flexShrink:0 }}>
              {i + 1}
            </div>
            <input
              value={day.dayName}
              onChange={e => updateDay(i, 'dayName', e.target.value)}
              placeholder={`Day ${i + 1} name (e.g. Push, Legs, Upper)`}
              style={{ ...inputStyle, flex:1 }} />
          </div>
          <div>
            <select value={day.focusArea} onChange={e => updateDay(i, 'focusArea', e.target.value)}
              style={{ ...inputStyle, width:'100%' }}>
              <option value="">— Focus area (optional) —</option>
              {FOCUS_AREAS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── ExerciseRow (drag + reorder + sets/reps/rest + alternatives) ─────────────
function ExerciseRow({ ex, index, total, onMove, onUpdate, onRemove, allExercises }) {
  const [showAlt, setShowAlt] = useState(false);
  const dragRef = useRef(null);

  const inputMini = {
    width:'52px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'6px', color:'#f1f5f9', fontSize:'13px', padding:'5px 6px', textAlign:'center',
  };
  const labelMini = { color:'#64748b', fontSize:'10px', textAlign:'center', display:'block' };

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); onMove(from, index); }}
      style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
        borderRadius:'10px', marginBottom:'8px', overflow:'hidden' }}>
      <div style={{ padding:'10px 12px', display:'flex', alignItems:'center', gap:'10px' }}>
        {/* drag handle */}
        <span style={{ color:'#334155', fontSize:'16px', cursor:'grab', userSelect:'none',
          flexShrink:0, touchAction:'none' }}>⠿</span>
        {/* order badge */}
        <span style={{ width:'22px', height:'22px', borderRadius:'50%', background:'rgba(249,115,22,0.15)',
          color:'#f97316', fontSize:'11px', fontWeight:700, display:'flex', alignItems:'center',
          justifyContent:'center', flexShrink:0 }}>
          {index + 1}
        </span>
        {/* name + muscle */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ color:'#f1f5f9', fontSize:'13px', fontWeight:500,
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ex.name}</div>
          {ex.muscleGroup && <div style={{ color:'#64748b', fontSize:'11px' }}>{ex.muscleGroup}</div>}
        </div>
        {/* sets / reps / rest */}
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexShrink:0 }}>
          <div>
            <span style={labelMini}>Sets</span>
            <input type="number" min={1} max={20} value={ex.sets || 3}
              onChange={e => onUpdate(index, 'sets', e.target.value)}
              style={inputMini} />
          </div>
          <div>
            <span style={labelMini}>Reps</span>
            <input value={ex.reps || '10'} onChange={e => onUpdate(index, 'reps', e.target.value)}
              style={inputMini} placeholder="10" />
          </div>
          <div>
            <span style={labelMini}>Rest</span>
            <input value={ex.rest || '60s'} onChange={e => onUpdate(index, 'rest', e.target.value)}
              style={inputMini} placeholder="60s" />
          </div>
        </div>
        {/* actions */}
        <div style={{ display:'flex', gap:'4px', flexShrink:0 }}>
          <button onClick={() => setShowAlt(v => !v)}
            title="Alternatives"
            style={{ background:'none', border:'none', color: showAlt ? '#f97316' : '#64748b',
              fontSize:'14px', cursor:'pointer', padding:'4px' }}>⇄</button>
          <button onClick={() => onRemove(index)}
            style={{ background:'none', border:'none', color:'#64748b',
              fontSize:'14px', cursor:'pointer', padding:'4px' }}>✕</button>
        </div>
      </div>
      {/* notes row */}
      <div style={{ padding:'0 12px 10px', paddingLeft:'54px' }}>
        <input value={ex.notes || ''} onChange={e => onUpdate(index, 'notes', e.target.value)}
          placeholder="Notes (optional — e.g. full ROM, pause at bottom)"
          style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'none',
            borderTop:'1px solid rgba(255,255,255,0.06)', color:'#94a3b8',
            fontSize:'12px', padding:'6px 0', boxSizing:'border-box', outline:'none' }} />
      </div>
      {/* alternatives panel */}
      {showAlt && (
        <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', padding:'10px 12px',
          background:'rgba(0,0,0,0.2)' }}>
          <div style={{ color:'#64748b', fontSize:'11px', marginBottom:'6px' }}>
            ALTERNATIVE EXERCISES
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            {allExercises
              .filter(e => e.PrimaryMuscle === ex.muscleGroup && e.Name !== ex.name)
              .slice(0, 8)
              .map(e => (
                <button key={e.ExerciseID}
                  onClick={() => { onUpdate(index, 'name', e.Name); onUpdate(index, 'exerciseId', e.ExerciseID); setShowAlt(false); }}
                  style={{ padding:'5px 10px', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'20px',
                    color:'#94a3b8', fontSize:'12px', cursor:'pointer',
                    transition:'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor='#f97316'; e.currentTarget.style.color='#f97316'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.1)'; e.currentTarget.style.color='#94a3b8'; }}>
                  {e.Name}
                </button>
              ))}
            {allExercises.filter(e => e.PrimaryMuscle === ex.muscleGroup && e.Name !== ex.name).length === 0 && (
              <span style={{ color:'#475569', fontSize:'12px' }}>No alternatives in same muscle group</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CreateProgramModal — Step 3: Exercise Builder ───────────────────────────
function StepExercises({ days, onDaysChange, allExercises }) {
  const [activeDay, setActiveDay] = useState(0);
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');

  const day = days[activeDay] || { exercises: [] };
  const exercises = day.exercises || [];

  const filtered = allExercises.filter(e => {
    const matchSearch = !search || e.Name?.toLowerCase().includes(search.toLowerCase());
    const matchMuscle = muscleFilter === 'All' || e.PrimaryMuscle === muscleFilter;
    return matchSearch && matchMuscle;
  });

  const addExercise = (ex) => {
    const newEx = {
      id: generateId('exrow'), exerciseId: ex.ExerciseID,
      name: ex.Name, muscleGroup: ex.PrimaryMuscle || '',
      sets: 3, reps: '10', rest: '60s', notes: '',
    };
    const next = [...days];
    next[activeDay] = { ...day, exercises: [...exercises, newEx] };
    onDaysChange(next);
  };

  const moveExercise = (from, to) => {
    if (from === to) return;
    const exArr = [...exercises];
    const [item] = exArr.splice(from, 1);
    exArr.splice(to, 0, item);
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    onDaysChange(next);
  };

  const updateExercise = (i, field, val) => {
    const exArr = [...exercises];
    exArr[i] = { ...exArr[i], [field]: val };
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    onDaysChange(next);
  };

  const removeExercise = (i) => {
    const exArr = exercises.filter((_, idx) => idx !== i);
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    onDaysChange(next);
  };

  const uniqueMuscles = ['All', ...new Set(allExercises.map(e => e.PrimaryMuscle).filter(Boolean))];

  return (
    <div style={{ display:'flex', gap:'12px', height:'400px' }}>
      {/* Left: search panel */}
      <div style={{ width:'200px', flexShrink:0, display:'flex', flexDirection:'column', gap:'8px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search exercises…"
          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:'8px', color:'#f1f5f9', fontSize:'13px', padding:'8px 10px', width:'100%', boxSizing:'border-box' }} />
        <select value={muscleFilter} onChange={e => setMuscleFilter(e.target.value)}
          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
            borderRadius:'8px', color:'#f1f5f9', fontSize:'12px', padding:'7px 8px', width:'100%' }}>
          {uniqueMuscles.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ overflowY:'auto', flex:1 }}>
          {filtered.length === 0 ? (
            <div style={{ color:'#475569', fontSize:'12px', padding:'8px 0', textAlign:'center' }}>
              No exercises found
            </div>
          ) : filtered.map(ex => (
            <button key={ex.ExerciseID}
              onClick={() => addExercise(ex)}
              style={{ width:'100%', background:'none', border:'none', padding:'7px 4px',
                display:'flex', alignItems:'center', gap:'6px', cursor:'pointer',
                borderBottom:'1px solid rgba(255,255,255,0.05)', textAlign:'left' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(249,115,22,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background='none'}>
              <span style={{ color:'#f97316', fontSize:'14px', flexShrink:0 }}>+</span>
              <div>
                <div style={{ color:'#e2e8f0', fontSize:'12px', lineHeight:1.3 }}>{ex.Name}</div>
                {ex.MuscleGroup && <div style={{ color:'#475569', fontSize:'10px' }}>{ex.MuscleGroup}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: day builder */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px', minWidth:0 }}>
        {/* day tabs */}
        <div style={{ display:'flex', gap:'4px', overflowX:'auto', flexShrink:0,
          paddingBottom:'4px' }}>
          {days.map((d, i) => (
            <button key={d.id} onClick={() => setActiveDay(i)}
              style={{ padding:'5px 10px', borderRadius:'6px', border:'none', cursor:'pointer',
                whiteSpace:'nowrap', fontSize:'12px', fontWeight: activeDay===i ? 600 : 400,
                background: activeDay===i ? '#f97316' : 'rgba(255,255,255,0.08)',
                color: activeDay===i ? '#fff' : '#94a3b8',
                transition:'all 0.15s', flexShrink:0 }}>
              {d.dayName || `Day ${i+1}`}
              {(d.exercises||[]).length > 0 &&
                <span style={{ marginLeft:'4px', opacity:0.7 }}>({d.exercises.length})</span>}
            </button>
          ))}
        </div>

        {/* exercise list */}
        <div style={{ overflowY:'auto', flex:1 }}>
          {exercises.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', height:'80%', gap:'8px', color:'#475569' }}>
              <div style={{ fontSize:'28px' }}>💪</div>
              <div style={{ fontSize:'13px' }}>Search and click exercises on the left to add them here</div>
            </div>
          ) : exercises.map((ex, i) => (
            <ExerciseRow key={ex.id} ex={ex} index={i} total={exercises.length}
              onMove={moveExercise} onUpdate={updateExercise} onRemove={removeExercise}
              allExercises={allExercises} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CreateProgramModal ───────────────────────────────────────────────────────
const STEP_LABELS = ['Details', 'Training Days', 'Exercises'];

const defaultProgramData = () => ({
  name: '', description: '', goal: 'Muscle Gain', daysPerWeek: 4,
  durationWeeks: 8, level: 'Intermediate', equipment: [], focusAreas: [],
  sessionDuration: 60, trainingType: 'Hypertrophy',
});

function CreateProgramModal({ initial, allExercises, onClose, onSave }) {
  const isEdit = !!initial;
  const [step, setStep]     = useState(0);
  const [data, setData]     = useState(initial ? {
    name: initial.name, description: initial.description || '',
    goal: initial.goal, daysPerWeek: initial.daysPerWeek,
    durationWeeks: initial.durationWeeks || 8, level: initial.level || 'Intermediate',
    equipment: initial.equipment || [], focusAreas: initial.focusAreas || [],
    sessionDuration: initial.sessionDuration || 60,
    trainingType: initial.trainingType || 'Hypertrophy',
  } : defaultProgramData());
  const [days, setDays]     = useState(initial?.days || initDays(data.daysPerWeek));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const updateData = (field, val) => setData(d => ({ ...d, [field]: val }));

  const canNext = () => {
    if (step === 0) return data.name.trim().length > 0;
    return true;
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await onSave({ ...data, days, id: initial?.id });
      onClose();
    } catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'12px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%',
        maxWidth: step === 2 ? '680px' : '520px',
        maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden',
        transition:'max-width 0.3s' }}>

        {/* Header */}
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'16px' }}>
              {isEdit ? 'Edit Program' : 'Create Program'}
            </div>
            <div style={{ display:'flex', gap:'6px', marginTop:'8px' }}>
              {STEP_LABELS.map((label, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                  <div style={{ width:'20px', height:'20px', borderRadius:'50%',
                    background: i < step ? '#22c55e' : i === step ? '#f97316' : 'rgba(255,255,255,0.08)',
                    color: i <= step ? '#fff' : '#64748b',
                    fontSize:'10px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span style={{ color: i === step ? '#f97316' : i < step ? '#22c55e' : '#475569',
                    fontSize:'11px', fontWeight: i === step ? 600 : 400 }}>{label}</span>
                  {i < STEP_LABELS.length - 1 && (
                    <span style={{ color:'#334155', margin:'0 2px' }}>›</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: step === 2 ? 'hidden' : 'auto', flex:1, padding:'20px' }}>
          {step === 0 && <StepDetails data={data} onChange={updateData} />}
          {step === 1 && <StepBuildDays days={days} daysPerWeek={data.daysPerWeek}
            onDaysChange={setDays} />}
          {step === 2 && <StepExercises days={days} onDaysChange={setDays}
            allExercises={allExercises} />}
          {error && (
            <div style={{ marginTop:'12px', background:'rgba(239,68,68,0.1)',
              border:'1px solid rgba(239,68,68,0.3)', borderRadius:'8px',
              padding:'10px 12px', color:'#fca5a5', fontSize:'13px' }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px' }}>
          <button onClick={onClose}
            style={{ padding:'11px 16px', background:'rgba(255,255,255,0.06)',
              border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
              color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>
            Cancel
          </button>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ padding:'11px 16px', background:'rgba(255,255,255,0.06)',
                border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
                color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>
              ← Back
            </button>
          )}
          <div style={{ flex:1 }} />
          {step < STEP_LABELS.length - 1 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
              style={{ padding:'11px 22px', background: canNext() ? '#f97316' : '#334155',
                border:'none', borderRadius:'10px', color:'#fff',
                fontSize:'14px', fontWeight:600, cursor: canNext() ? 'pointer' : 'default' }}>
              Next →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving}
              style={{ padding:'11px 22px', background: saving ? '#7c3f0a' : '#f97316',
                border:'none', borderRadius:'10px', color:'#fff',
                fontSize:'14px', fontWeight:600, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? '✓ Save Changes' : '✓ Create Program'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ProgramLibraryPage ──────────────────────────────────────────────────
export default function ProgramLibraryPage() {
  const [programs, setPrograms]       = useState([]);
  const [clients, setClients]         = useState([]);
  const [exercises, setExercises]     = useState([]);
  const [clientPrograms, setCPs]      = useState([]);
  const [goalFilter, setGoalFilter]   = useState('All');
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  // Modal states
  const [createOpen, setCreateOpen]   = useState(false);
  const [editTarget, setEditTarget]   = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [generateOpen, setGenerate]   = useState(false);
  const [aiInitial, setAIInitial]     = useState(null);

  // Build assignedMap: programId → [clientId, ...]
  const assignedMap = useMemo(() => {
    const m = {};
    clientPrograms.forEach(cp => {
      if (!m[cp.ProgramID]) m[cp.ProgramID] = [];
      m[cp.ProgramID].push(cp.ClientID);
    });
    return m;
  }, [clientPrograms]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rawProgs, rawClients, rawExercises, rawCPs] = await Promise.all([
        readSheet('Programs').catch(() => []),
        readSheet('Clients').catch(() => []),
        readSheet('Exercises').catch(() => []),
        readSheet('ClientPrograms').catch(() => []),
      ]);

      // Parse days JSON for each program
      const parsed = rawProgs.map(p => {
        let days = [];
        try { days = p.DaysJSON ? JSON.parse(p.DaysJSON) : []; } catch {}
        return {
          id: p.ProgramID, name: p.Name, description: p.Description || '',
          goal: p.Goal || 'General Fitness', daysPerWeek: +p.DaysPerWeek || 3,
          durationWeeks: +p.DurationWeeks || 8, level: p.Level || 'Intermediate',
          equipment: p.Equipment ? p.Equipment.split(',').map(s=>s.trim()) : [],
          focusAreas: p.FocusAreas ? p.FocusAreas.split(',').map(s=>s.trim()) : [],
          days, createdAt: p.CreatedAt || '',
        };
      });
      setPrograms(parsed);
      setClients(rawClients);
      setExercises(rawExercises);
      setCPs(rawCPs);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = goalFilter === 'All'
    ? programs : programs.filter(p => p.goal === goalFilter);

  // Save program (create or edit)
  const handleSaveProgram = async ({ id, name, description, goal, daysPerWeek,
    durationWeeks, level, equipment, focusAreas, days, sessionDuration, trainingType }) => {
    const programId = id || generateId('prog');
    const rowData = {
      ProgramID: programId, Name: name, Description: description,
      Goal: goal, DaysPerWeek: daysPerWeek, DurationWeeks: durationWeeks,
      Level: level, Equipment: equipment.join(', '), FocusAreas: focusAreas.join(', '),
      SessionDuration: sessionDuration || 60, TrainingType: trainingType || 'Hypertrophy',
      DaysJSON: JSON.stringify(days), CreatedAt: id ? undefined : todayISO(),
    };
    if (id) delete rowData.CreatedAt;
    await upsertSheetRow('Programs', 'ProgramID', programId, rowData);

    // Optimistic update
    const newProg = { id: programId, name, description, goal, daysPerWeek,
      durationWeeks, level, equipment, focusAreas, days, sessionDuration, trainingType };
    setPrograms(prev => id
      ? prev.map(p => p.id === id ? newProg : p)
      : [newProg, ...prev]);
  };

  // Copy program
  const handleCopy = async (prog) => {
    const newId = generateId('prog');
    const copy = { ...prog, id: newId, name: `${prog.name} (copy)` };
    const rowData = {
      ProgramID: newId, Name: copy.name, Description: copy.description,
      Goal: copy.goal, DaysPerWeek: copy.daysPerWeek, DurationWeeks: copy.durationWeeks,
      Level: copy.level, Equipment: copy.equipment.join(', '),
      FocusAreas: copy.focusAreas.join(', '), DaysJSON: JSON.stringify(copy.days),
      CreatedAt: todayISO(),
    };
    await upsertSheetRow('Programs', 'ProgramID', newId, rowData);
    setPrograms(prev => [copy, ...prev]);
  };

  // Assign to clients
  const handleAssign = async (programId, clientIds) => {
    const current = assignedMap[programId] || [];
    // Add new assignments
    for (const cid of clientIds) {
      if (!current.includes(cid)) {
        await appendToSheet('ClientPrograms', {
          ClientProgramID: generateId('cp'), ClientID: cid,
          ProgramID: programId, AssignedAt: todayISO(), Status: 'Active',
        });
      }
    }
    // Remove unassigned
    for (const cid of current) {
      if (!clientIds.includes(cid)) {
        await deleteSheetRowsWhere('ClientPrograms', 'ClientID', cid);
      }
    }
    await fetchData(); // refresh
  };

  // AI generated program — opens in create modal pre-filled
  const handleAIGenerated = (program) => {
    setAIInitial({
      name: program.name || 'AI Generated Program',
      description: program.description || '',
      goal: program.goal || 'General Fitness',
      daysPerWeek: program.daysPerWeek || 3,
      durationWeeks: program.durationWeeks || 8,
      level: program.level || 'Intermediate',
      equipment: program.equipment || [],
      focusAreas: program.focusAreas || [],
      days: program.days || initDays(program.daysPerWeek || 3),
    });
    setCreateOpen(true);
  };

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#f1f5f9',
      fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ position:'fixed', left:'50%', transform:'translateX(-50%)',
        width:'100%', maxWidth:'430px', height:'100dvh', display:'flex',
        flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ padding:'16px 16px 0', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
            <div>
              <div style={{ color:'#f1f5f9', fontWeight:800, fontSize:'20px' }}>Program Library</div>
              <div style={{ color:'#64748b', fontSize:'13px' }}>
                {programs.length} program{programs.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => setGenerate(true)}
                style={{ padding:'8px 12px', background:'rgba(249,115,22,0.15)',
                  border:'1px solid rgba(249,115,22,0.3)', borderRadius:'8px',
                  color:'#f97316', fontSize:'13px', cursor:'pointer', fontWeight:600 }}>
                ✨ AI
              </button>
              <button onClick={() => { setAIInitial(null); setCreateOpen(true); }}
                style={{ padding:'8px 14px', background:'#f97316', border:'none',
                  borderRadius:'8px', color:'#fff', fontSize:'13px', cursor:'pointer', fontWeight:600 }}>
                + Create
              </button>
            </div>
          </div>
          <FilterBar goalFilter={goalFilter} onFilterChange={setGoalFilter} />
        </div>

        {/* Program list */}
        <div style={{ overflowY:'auto', flex:1, padding:'8px 16px 16px' }}>
          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', alignItems:'center',
              height:'200px', color:'#64748b' }}>Loading programs…</div>
          ) : error ? (
            <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
              borderRadius:'10px', padding:'16px', color:'#fca5a5', margin:'16px 0' }}>
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', height:'200px', gap:'12px', color:'#64748b' }}>
              <div style={{ fontSize:'36px' }}>📋</div>
              <div style={{ fontSize:'14px', textAlign:'center' }}>
                {goalFilter !== 'All' ? `No ${goalFilter} programs yet` : 'No programs yet'}
              </div>
              <button onClick={() => { setAIInitial(null); setCreateOpen(true); }}
                style={{ padding:'10px 20px', background:'#f97316', border:'none',
                  borderRadius:'8px', color:'#fff', fontSize:'14px', cursor:'pointer' }}>
                Create your first program
              </button>
            </div>
          ) : filtered.map(prog => (
            <ProgramCard key={prog.id} program={prog}
              clientCount={(assignedMap[prog.id]||[]).length}
              onEdit={() => setEditTarget(prog)}
              onCopy={() => handleCopy(prog)}
              onAssign={() => setAssignTarget(prog)} />
          ))}
        </div>
      </div>

      {/* Modals */}
      {(createOpen || editTarget) && (
        <CreateProgramModal
          initial={editTarget || aiInitial}
          allExercises={exercises}
          onClose={() => { setCreateOpen(false); setEditTarget(null); setAIInitial(null); }}
          onSave={handleSaveProgram} />
      )}
      {assignTarget && (
        <AssignModal program={assignTarget} clients={clients}
          assignedMap={assignedMap}
          onClose={() => setAssignTarget(null)}
          onSave={handleAssign} />
      )}
      {generateOpen && (
        <GenerateAIModal
          onClose={() => setGenerate(false)}
 
          onGenerated={(prog) => { setAIInitial(prog); setGenerate(false); setCreateOpen(true); }} />
      )}
    </div>
  );
}
