import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { readSheet, appendToSheet, upsertRow, invalidateCache } from '../../utils/sheets';
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

function initDays(daysPerWeek, existing = []) {
  return Array.from({ length: 7 }, (_, i) => {
    const isRest = i >= daysPerWeek;
    if (existing[i]) return { ...existing[i], isRestDay: isRest };
    return {
      id:        generateId('day'),
      dayOrder:  i + 1,
      dayName:   isRest ? 'Rest Day' : '',
      focusArea: '',
      exercises: [],
      isRestDay: isRest,
    };
  });
}

function initPhase(order, daysPerWeek, existing = null) {
  return existing || {
    id:        generateId('phase'),
    name:      `Phase ${order}`,
    order,
    weekCount: 4,
    days:      initDays(daysPerWeek),
  };
}

function initPhases(count, daysPerWeek, existing = []) {
  return Array.from({ length: count }, (_, i) =>
    initPhase(i + 1, daysPerWeek, existing[i] || null)
  );
}

// Compute total weeks from phases array
function totalProgramWeeks(phases) {
  return (phases || []).reduce((s, p) => s + (p.weekCount || 4), 0);
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
  return callProxy({ action: 'deleteRowsWhere', tab, column, value });
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

function ProgramCard({ program, exerciseCount, clientCount, onEdit, onDuplicate, onAssign, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
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
            {program.name || 'Untitled Program'}
          </div>
          <GoalTag goal={program.goal} />
          {program.createdAt && (
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>
              Created {new Date(program.createdAt + 'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { icon: '📅', label: 'Days/week', value: program.daysPerWeek || '—' },
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
      {program.description && (
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {program.description}
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
        {confirmDel ? (
          <div style={{ display:'flex', gap:4, alignItems:'center' }} onClick={e=>e.stopPropagation()}>
            <span style={{ fontSize:11, color:'#ef4444' }}>Delete?</span>
            <button onClick={e=>{e.stopPropagation();onDelete();}} style={{
              padding:'5px 8px', borderRadius:6, border:'none',
              background:'#ef4444', color:'#fff', fontSize:12, cursor:'pointer', fontWeight:600 }}>Yes</button>
            <button onClick={e=>{e.stopPropagation();setConfirmDel(false);}} style={{
              padding:'5px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)',
              background:'transparent', color:'#94a3b8', fontSize:12, cursor:'pointer' }}>No</button>
          </div>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDel(true); }}
            style={{
              padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)',
              background: 'transparent', color: '#ef4444',
              fontSize: 13, cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            title="Delete program"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}


// ─── AssignModal ──────────────────────────────────────────────────────────────
function AssignModal({ program, clients, assignedMap, onClose, onSave }) {
  const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const already = assignedMap[program.id] || [];
  const [selected,     setSelected]     = useState(new Set(already));
  const [trainingDays, setTrainingDays] = useState(new Set(['Mon','Tue','Wed','Thu','Fri']));
  const [saving,       setSaving]       = useState(false);

  const toggle = id => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleDay = d => setTrainingDays(s => {
    const n = new Set(s);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(program.id, [...selected], [...trainingDays]); onClose(); }
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

        {/* Training days picker */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ color:'#64748b', fontSize:'11px', textTransform:'uppercase',
            letterSpacing:'0.5px', marginBottom:'8px' }}>Training Days</div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {DAY_LABELS.map(d => {
              const on = trainingDays.has(d);
              return (
                <button key={d} onClick={() => toggleDay(d)} style={{
                  padding:'5px 10px', borderRadius:'8px', fontSize:'12px', fontWeight:600,
                  cursor:'pointer', border:'none',
                  background: on ? '#f97316' : 'rgba(255,255,255,0.06)',
                  color: on ? '#fff' : '#64748b',
                  transition:'all 0.12s',
                }}>{d}</button>
              );
            })}
          </div>
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
  const [goal, setGoal]                   = useState('Muscle Gain');
  const [daysPerWeek, setDays]            = useState(4);
  const [duration, setDuration]           = useState(8);
  const [sessionDuration, setSession]     = useState(60);
  const [trainingType, setTrainingType]   = useState('Hypertrophy');
  const [level, setLevel]                 = useState('Intermediate');
  const [equipment, setEquipment]         = useState([]);
  const [focus, setFocus]                 = useState([]);
  const [notes, setNotes]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');
  const [clientGoals,       setClientGoals]       = useState('');
  const [clientLimitations, setClientLimitations] = useState('');
  const [clientFocusAreas,  setClientFocusAreas]  = useState('');
  const [clientNotes,       setClientNotes]       = useState('');
  const [suggesting,        setSuggesting]        = useState(false);

  const toggleArr = (arr, setArr, val) =>
    setArr(a => a.includes(val) ? a.filter(x => x !== val) : [...a, val]);

  const handleSuggest = async () => {
    const desc = [clientGoals, clientLimitations, clientFocusAreas, clientNotes].filter(Boolean).join(' | ');
    if (!desc.trim()) return;
    setSuggesting(true); setError('');
    try {
      const res = await fetch(config.APPS_SCRIPT_URL, {
        method:'POST', redirect:'follow',
        body: JSON.stringify({ action:'suggestSettings', description: desc }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Suggestion failed');
      const s = data.settings;
      if (s.goal)            setGoal(s.goal);
      if (s.daysPerWeek)     setDays(+s.daysPerWeek);
      if (s.durationWeeks)   setDuration(+s.durationWeeks);
      if (s.sessionDuration) setSession(+s.sessionDuration);
      if (s.trainingType)    setTrainingType(s.trainingType);
      if (s.level)           setLevel(s.level);
      if (s.equipment?.length)   setEquipment(s.equipment);
      if (s.focusAreas?.length)  setFocus(s.focusAreas);
    } catch(e) { setError('Could not suggest settings: ' + e.message); }
    finally { setSuggesting(false); }
  };

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(config.APPS_SCRIPT_URL, {
        method:'POST', redirect: 'follow',
        body: JSON.stringify({
          action:'generateProgram', goal, daysPerWeek, durationWeeks: duration,
          sessionDuration, trainingType,
          level, equipment, focusAreas: focus, notes,
          clientGoals, clientLimitations, clientFocusAreas, clientNotes,
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


          {/* ── Client Profile ── */}
          <div style={{ background:'rgba(249,115,22,0.05)', border:'1px solid rgba(249,115,22,0.15)',
            borderRadius:'12px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ color:'#f97316', fontWeight:700, fontSize:'13px' }}>👤 Client Profile</div>
              <button onClick={handleSuggest} disabled={suggesting ||
                (!clientGoals && !clientLimitations && !clientFocusAreas && !clientNotes)}
                style={{
                  padding:'6px 12px', borderRadius:'8px', fontSize:'12px', fontWeight:600,
                  cursor: suggesting ? 'default' : 'pointer', border:'none',
                  background: suggesting ? 'rgba(249,115,22,0.2)' : '#f97316',
                  color: suggesting ? '#f97316' : '#fff', transition:'all 0.15s',
                }}>
                {suggesting ? '⏳ Suggesting…' : '✨ Suggest Settings'}
              </button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              {[
                { label:'CLIENT GOALS', val:clientGoals, set:setClientGoals,
                  placeholder:'e.g. Build muscle, lose fat, improve fitness for sport…' },
                { label:'INJURIES / LIMITATIONS', val:clientLimitations, set:setClientLimitations,
                  placeholder:"e.g. Bad lower back, knee surgery, can't overhead press..." },
                { label:'EMPHASIS AREAS', val:clientFocusAreas, set:setClientFocusAreas,
                  placeholder:'e.g. Glutes, shoulders, arms — areas to prioritise with more sets' },
                { label:'ADDITIONAL NOTES', val:clientNotes, set:setClientNotes,
                  placeholder:'e.g. Trains at home, prefers compound movements, time-poor…' },
              ].map(({ label, val, set, placeholder }) => (
                <div key={label}>
                  <div style={{ color:'#94a3b8', fontSize:'10px', letterSpacing:'0.05em',
                    marginBottom:'5px', textTransform:'uppercase' }}>{label}</div>
                  <textarea value={val} onChange={e => set(e.target.value)}
                    placeholder={placeholder} rows={2}
                    style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,0.05)',
                      border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                      color:'#f1f5f9', fontSize:'12px', padding:'8px 10px',
                      resize:'vertical', fontFamily:'inherit', outline:'none' }} />
                </div>
              ))}
            </div>
            <div style={{ color:'#64748b', fontSize:'11px' }}>
              Fill in the client details above and click <strong style={{color:'#f97316'}}>✨ Suggest Settings</strong> to auto-fill the program settings below, then adjust as needed.
            </div>
          </div>

          <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', margin:'0 -20px', padding:'0 20px' }} />

          <div>
            <div style={labelStyle}>GOAL</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {['Weight Loss','Muscle Gain','Strength','General Fitness'].map(g => (
                <button key={g} style={chipStyle(goal===g)} onClick={() => setGoal(g)}>{g}</button>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px' }}>
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
            <div>
              <div style={labelStyle}>SESSION</div>
              <select value={sessionDuration} onChange={e => setSession(+e.target.value)} style={inputStyle}>
                {[20,30,45,60,75,90].map(n => <option key={n} value={n}>{n} mins</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={labelStyle}>TRAINING TYPE</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {TRAINING_TYPES.map(t => (
                <button key={t} style={chipStyle(trainingType===t)} onClick={() => setTrainingType(t)}>{t}</button>
              ))}
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
        <div>
          <label style={labelStyle}>NUMBER OF PHASES</label>
          <select value={data.numPhases || 3} onChange={e => onChange('numPhases', +e.target.value)} style={inputStyle}>
            {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} phase{n!==1?'s':''}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>LEVEL</label>
          <select value={data.level} onChange={e => onChange('level', e.target.value)} style={inputStyle}>
            {['Beginner','Intermediate','Advanced'].map(l => <option key={l} value={l}>{l}</option>)}
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

      <div>
        <label style={labelStyle}>DURATION (weeks)</label>
        <input type="number" min={1} max={52} value={data.durationWeeks}
          onChange={e => onChange('durationWeeks', +e.target.value)}
          style={{ ...inputStyle, width:'50%' }} />
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

    </div>
  );
}

// ─── CreateProgramModal — Step 2: Define Phases ──────────────────────────────
function StepDefinePhases({ phases, daysPerWeek, onPhasesChange }) {
  const inputStyle = {
    background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'8px 10px', width:'100%', boxSizing:'border-box',
  };

  const addPhase = () => {
    onPhasesChange([...phases, initPhase(phases.length + 1, daysPerWeek)]);
  };

  const removePhase = (i) => {
    if (phases.length <= 1) return;
    onPhasesChange(phases.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, order: idx + 1 })));
  };

  const updatePhase = (i, field, val) => {
    const next = [...phases];
    next[i] = { ...next[i], [field]: val };
    onPhasesChange(next);
  };

  const totalWeeks = totalProgramWeeks(phases);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px' }}>
        Break your program into phases (e.g. Foundation → Build → Peak). Each phase repeats the same day structure for its week count, with weights auto-progressing each week.
      </div>

      {phases.map((phase, i) => (
        <div key={phase.id} style={{ background:'rgba(255,255,255,0.04)',
          border:'1px solid rgba(249,115,22,0.2)', borderRadius:'12px', padding:'14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
            <div style={{ width:'28px', height:'28px', borderRadius:'50%',
              background:'rgba(249,115,22,0.2)', border:'1px solid rgba(249,115,22,0.4)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#f97316', fontSize:'12px', fontWeight:700, flexShrink:0 }}>
              {i + 1}
            </div>
            <input
              value={phase.name}
              onChange={e => updatePhase(i, 'name', e.target.value)}
              placeholder={`Phase ${i + 1} name (e.g. Foundation, Build, Peak)`}
              style={{ ...inputStyle }} />
            {phases.length > 1 && (
              <button onClick={() => removePhase(i)}
                style={{ background:'none', border:'none', color:'#64748b', fontSize:'18px',
                  cursor:'pointer', padding:'0 4px', flexShrink:0 }}>✕</button>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <span style={{ color:'#64748b', fontSize:'13px', flexShrink:0 }}>Duration:</span>
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
              {[2,3,4,6,8,12].map(w => (
                <button key={w} onClick={() => updatePhase(i, 'weekCount', w)}
                  style={{ padding:'5px 12px', borderRadius:'20px', border:'none',
                    fontSize:'12px', cursor:'pointer', fontWeight: phase.weekCount === w ? 600 : 400,
                    background: phase.weekCount === w ? '#f97316' : 'rgba(255,255,255,0.08)',
                    color: phase.weekCount === w ? '#fff' : '#94a3b8', transition:'all 0.15s' }}>
                  {w}w
                </button>
              ))}
            </div>
            <span style={{ color:'#475569', fontSize:'12px' }}>({phase.weekCount} weeks)</span>
          </div>
        </div>
      ))}

      <button onClick={addPhase}
        style={{ padding:'11px', background:'rgba(249,115,22,0.08)',
          border:'1px dashed rgba(249,115,22,0.3)', borderRadius:'10px',
          color:'#f97316', fontSize:'14px', cursor:'pointer', fontWeight:500 }}>
        + Add Phase
      </button>

      <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:'10px', padding:'12px',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ color:'#64748b', fontSize:'13px' }}>{phases.length} phase{phases.length !== 1 ? 's' : ''} · {daysPerWeek} days/week</span>
        <span style={{ color:'#f97316', fontSize:'13px', fontWeight:600 }}>{totalWeeks} weeks total</span>
      </div>
    </div>
  );
}

// ─── CreateProgramModal — Step 3: Build Day Templates per Phase ───────────────
function StepBuildDays({ phases, daysPerWeek, onPhasesChange }) {
  const [activePhase, setActivePhase] = useState(0);
  const inputStyle = {
    background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'8px 10px',
  };

  // Sync days count when daysPerWeek changes
  useEffect(() => {
    const updated = phases.map(phase => ({
      ...phase,
      days: phase.days.length !== daysPerWeek ? initDays(daysPerWeek, phase.days) : phase.days,
    }));
    onPhasesChange(updated);
  }, [daysPerWeek]);

  const updateDay = (phaseIdx, dayIdx, field, val) => {
    const next = phases.map((p, pi) => pi !== phaseIdx ? p : {
      ...p,
      days: p.days.map((d, di) => di !== dayIdx ? d : { ...d, [field]: val }),
    });
    onPhasesChange(next);
  };

  const phase = phases[activePhase] || phases[0];
  const days = phase?.days || [];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px' }}>
        Name each training day for each phase. You can use different day splits per phase.
      </div>

      {/* Phase tabs */}
      {phases.length > 1 && (
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
          {phases.map((p, i) => (
            <button key={p.id} onClick={() => setActivePhase(i)}
              style={{ padding:'6px 14px', borderRadius:'8px', border:'none', cursor:'pointer',
                fontSize:'13px', fontWeight: activePhase === i ? 600 : 400,
                background: activePhase === i ? '#f97316' : 'rgba(255,255,255,0.08)',
                color: activePhase === i ? '#fff' : '#94a3b8', transition:'all 0.15s' }}>
              {p.name || `Phase ${i+1}`}
            </button>
          ))}
        </div>
      )}

      {days.map((day, i) => (
        <div key={day.id} style={{
          background: day.isRestDay ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
          border: day.isRestDay ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(255,255,255,0.08)',
          borderRadius:'10px', padding:'14px', opacity: day.isRestDay ? 0.55 : 1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ width:'28px', height:'28px', borderRadius:'50%',
              background: day.isRestDay ? 'rgba(100,116,139,0.15)' : 'rgba(249,115,22,0.15)',
              border: day.isRestDay ? '1px solid rgba(100,116,139,0.3)' : '1px solid rgba(249,115,22,0.3)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color: day.isRestDay ? '#475569' : '#f97316',
              fontSize: day.isRestDay ? '14px' : '12px', fontWeight:700, flexShrink:0 }}>
              {day.isRestDay ? '🌙' : (i + 1)}
            </div>
            {day.isRestDay ? (
              <div style={{ flex:1, padding:'8px 10px', borderRadius:'8px',
                background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.04)',
                color:'#334155', fontSize:'14px' }}>
                Rest Day
              </div>
            ) : (
              <input
                value={day.dayName}
                onChange={e => updateDay(activePhase, i, 'dayName', e.target.value)}
                placeholder={`Day ${i + 1} name (e.g. Push, Legs, Upper)`}
                style={{ ...inputStyle, flex:1 }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── ExerciseRow (drag + reorder + sets/reps/rest + alternatives) ─────────────
function ExerciseRow({ ex, index, total, onMove, onUpdate, onRemove, allExercises, onCreateSuperset, onRemoveFromSuperset, supersetLabel, supersetColor, isLastInSuperset }) {
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
      style={{ background:'rgba(255,255,255,0.04)',
        border: ex.supersetId ? `1px solid ${supersetColor}44` : '1px solid rgba(255,255,255,0.08)',
        borderLeft: ex.supersetId ? `3px solid ${supersetColor}` : '1px solid rgba(255,255,255,0.08)',
        borderRadius:'10px', marginBottom: isLastInSuperset ? '10px' : '2px', overflow:'hidden' }}>
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
          <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
            <div title={ex.name} style={{ color:'#f1f5f9', fontSize:'13px', fontWeight:500,
              wordBreak:'break-word', lineHeight:1.3 }}>{ex.name}</div>
            {ex.supersetId && (
              <span style={{ fontSize:'9px', fontWeight:700, padding:'1px 5px', borderRadius:'3px', flexShrink:0,
                background: `${supersetColor}25`, color: supersetColor, letterSpacing:'0.05em' }}>
                SS {supersetLabel}
              </span>
            )}
          </div>
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
          <div>
            <span style={labelMini}>+kg/wk</span>
            <input type="number" min={0} max={20} step={0.5} value={ex.weightIncrement ?? 2.5}
              onChange={e => onUpdate(index, 'weightIncrement', parseFloat(e.target.value) || 2.5)}
              style={{ ...inputMini, width:'48px' }} />
          </div>
        </div>
        {/* actions */}
        <div style={{ display:'flex', gap:'4px', flexShrink:0 }}>
          <button onClick={() => setShowAlt(v => !v)}
            title="Alternatives"
            style={{ background:'none', border:'none', color: showAlt ? '#f97316' : '#64748b',
              fontSize:'14px', cursor:'pointer', padding:'4px' }}>⇄</button>
          <button
            onClick={() => ex.supersetId ? onRemoveFromSuperset(index) : onCreateSuperset(index)}
            title={ex.supersetId ? `Unlink from Superset ${supersetLabel}` : (index < total - 1 ? 'Link with next exercise (superset)' : 'No exercise below to link')}
            disabled={!ex.supersetId && index >= total - 1}
            style={{ background:'none', border:'none', padding:'4px', fontSize:'14px',
              cursor: (ex.supersetId || index < total - 1) ? 'pointer' : 'default',
              color: ex.supersetId ? supersetColor : index < total - 1 ? '#475569' : '#1e293b',
              opacity: (!ex.supersetId && index >= total - 1) ? 0.3 : 1,
            }}>🔗</button>
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

// ─── CreateProgramModal — Step 4: Exercise Builder (phase-aware) ─────────────

const TRACKED_MUSCLES = [
  { key: 'Chest',      label: 'Chest'  },
  { key: 'Back',       label: 'Back'   },
  { key: 'Shoulders',  label: 'Delts'  },
  { key: 'Biceps',     label: 'Bis'    },
  { key: 'Triceps',    label: 'Tris'   },
  { key: 'Quads',      label: 'Quads'  },
  { key: 'Hamstrings', label: 'Hams'   },
  { key: 'Glutes',     label: 'Glutes' },
  { key: 'Calves',     label: 'Calves' },
  { key: 'Core',       label: 'Core'   },
];

function StepExercises({ phases, onPhasesChange, allExercises }) {
  const [activePhase,  setActivePhase]  = useState(0);
  const [activeDay,    setActiveDay]    = useState(0);
  const [search,       setSearch]       = useState('');
  const [muscleFilter, setMuscleFilter] = useState('All');
  const [lastDeleted,  setLastDeleted]  = useState(null);
  const undoTimerRef = useRef(null);

  const phase     = phases[activePhase] || phases[0];
  const days      = phase?.days || [];
  const day       = days[activeDay] || { exercises: [] };
  const exercises = day.exercises || [];

  // Weekly sets per muscle for current phase (all training days combined)
  const weeklySets = useMemo(() => {
    const counts = {};
    (phase?.days || []).forEach(d => {
      if (d.isRestDay) return;
      (d.exercises || []).forEach(ex => {
        const m = ex.muscleGroup || '';
        if (m) counts[m] = (counts[m] || 0) + (parseInt(ex.sets) || 0);
      });
    });
    return counts;
  }, [phase]);

  const filtered = allExercises.filter(e => {
    const matchSearch = !search || e.Name?.toLowerCase().includes(search.toLowerCase());
    const matchMuscle = muscleFilter === 'All' || e.PrimaryMuscle === muscleFilter;
    return matchSearch && matchMuscle;
  });

  const updatePhasesDays = (newDays) => {
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : { ...p, days: newDays }));
  };

  const addExercise = (ex) => {
    if (day.isRestDay) return;
    const newEx = {
      id: generateId('exrow'), exerciseId: ex.ExerciseID,
      name: ex.Name, muscleGroup: ex.PrimaryMuscle || '',
      sets: 3, reps: '8-10', rest: '60s', weightIncrement: 2.5, notes: '',
      supersetId: null,
    };
    const next = [...days];
    next[activeDay] = { ...day, exercises: [...exercises, newEx] };
    updatePhasesDays(next);
  };

  const moveExercise = (from, to) => {
    if (from === to) return;
    const exArr = [...exercises];
    const [item] = exArr.splice(from, 1);
    exArr.splice(to, 0, item);
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(next);
  };

  const updateExercise = (i, field, val) => {
    const exArr = [...exercises];
    exArr[i] = { ...exArr[i], [field]: val };
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(next);
  };

  const removeExercise = (i) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeleted({ ex: exercises[i], idx: i });
    undoTimerRef.current = setTimeout(() => setLastDeleted(null), 6000);
    const exArr = exercises.filter((_, idx) => idx !== i);
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(next);
  };

  const undoRemove = () => {
    if (!lastDeleted) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const exArr = [...exercises];
    exArr.splice(lastDeleted.idx, 0, lastDeleted.ex);
    const next = [...days];
    next[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(next);
    setLastDeleted(null);
  };

  // ── Superset helpers ──────────────────────────────────────────────────────
  const SUPERSET_COLORS = ['#f97316','#60a5fa','#4ade80','#a78bfa','#f87171','#fbbf24'];
  const getSupersetIdx = (ssId, exs) => {
    const ids = [];
    exs.forEach(e => { if (e.supersetId && !ids.includes(e.supersetId)) ids.push(e.supersetId); });
    return ids.indexOf(ssId);
  };
  const getSupersetLabel = (ssId) => {
    const i = getSupersetIdx(ssId, exercises);
    return i >= 0 ? 'ABCDEFGHIJ'[i] ?? String(i+1) : '?';
  };
  const getSupersetColor = (ssId) => {
    const i = getSupersetIdx(ssId, exercises);
    return SUPERSET_COLORS[i % SUPERSET_COLORS.length];
  };
  // After any superset change: clear rest on every non-last superset member,
  // leave rest on the last member (that's the between-round rest).
  const applyRestRules = (exArr) => exArr.map((ex, i) => {
    if (!ex.supersetId) return ex;
    const isLast = i === exArr.length - 1 || exArr[i + 1]?.supersetId !== ex.supersetId;
    return isLast ? ex : { ...ex, rest: '—' };
  });

  const createSuperset = (idx) => {
    if (idx >= exercises.length - 1) return;
    const curr = exercises[idx];
    const next2 = exercises[idx + 1];
    let exArr;
    // If next is already in a superset, join current to it
    if (next2.supersetId && !curr.supersetId) {
      exArr = exercises.map((e, i) => i === idx ? { ...e, supersetId: next2.supersetId } : e);
    // If current is already in a superset, add next to it
    } else if (curr.supersetId && !next2.supersetId) {
      exArr = exercises.map((e, i) => i === idx + 1 ? { ...e, supersetId: curr.supersetId } : e);
    } else {
      // Both standalone (or different supersets): create new group
      const ssId = `ss-${Date.now()}`;
      exArr = exercises.map((e, i) => (i === idx || i === idx + 1) ? { ...e, supersetId: ssId } : e);
    }
    exArr = applyRestRules(exArr);
    const nxt = [...days]; nxt[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(nxt);
  };

  const removeFromSuperset = (idx) => {
    const ssId = exercises[idx]?.supersetId; if (!ssId) return;
    const members = exercises.filter(e => e.supersetId === ssId);
    let exArr = exercises.map((e, i) => {
      if (i === idx) return { ...e, supersetId: null };
      if (e.supersetId === ssId && members.length === 2) return { ...e, supersetId: null };
      return e;
    });
    // Re-apply rest rules so the new last member keeps its rest correct
    exArr = applyRestRules(exArr);
    const nxt = [...days]; nxt[activeDay] = { ...day, exercises: exArr };
    updatePhasesDays(nxt);
  };

  const uniqueMuscles = ['All', ...new Set(allExercises.map(e => e.PrimaryMuscle).filter(Boolean))];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px', height:'440px' }}>

      {/* ── Weekly sets tracker ── */}
      <div style={{ flexShrink:0, background:'rgba(0,0,0,0.2)', borderRadius:'8px',
        padding:'6px 10px', display:'flex', gap:'5px', overflowX:'auto', alignItems:'center' }}>
        <div style={{ fontSize:'9px', color:'#334155', flexShrink:0, marginRight:'2px',
          lineHeight:1.4, textTransform:'uppercase', letterSpacing:'0.3px' }}>
          Sets/wk<br/>(10–15)
        </div>
        {TRACKED_MUSCLES.map(({ key, label }) => {
          const sets = weeklySets[key] || 0;
          const bg    = sets === 0 ? 'rgba(255,255,255,0.04)' : sets < 10 ? 'rgba(251,191,36,0.15)' : sets <= 15 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
          const color = sets === 0 ? '#475569' : sets < 10 ? '#fbbf24' : sets <= 15 ? '#4ade80' : '#f87171';
          const bdr   = sets === 0 ? 'rgba(255,255,255,0.06)' : sets < 10 ? 'rgba(251,191,36,0.3)' : sets <= 15 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
          return (
            <div key={key} style={{ flexShrink:0, minWidth:'48px', textAlign:'center',
              background:bg, border:`1px solid ${bdr}`, borderRadius:'6px', padding:'4px 5px' }}>
              <div style={{ fontSize:'13px', fontWeight:700, color, lineHeight:1 }}>{sets}</div>
              <div style={{ fontSize:'9px', color:'#64748b', marginTop:'2px', textTransform:'uppercase',
                letterSpacing:'0.3px' }}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Main two-column layout ── */}
      <div style={{ display:'flex', gap:'12px', flex:1, minHeight:0 }}>
        {/* Left: exercise search */}
        <div style={{ width:'200px', flexShrink:0, display:'flex', flexDirection:'column', gap:'8px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search exercises…"
            style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:'8px', color:'#f1f5f9', fontSize:'13px', padding:'8px 10px',
              width:'100%', boxSizing:'border-box' }} />
          <select value={muscleFilter} onChange={e => setMuscleFilter(e.target.value)}
            style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:'8px', color:'#f1f5f9', fontSize:'12px', padding:'7px 8px', width:'100%' }}>
            {uniqueMuscles.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={{ overflowY:'auto', flex:1 }}>
            {filtered.length === 0 ? (
              <div style={{ color:'#475569', fontSize:'12px', padding:'8px 0', textAlign:'center' }}>No exercises found</div>
            ) : filtered.map(ex => (
              <button key={ex.ExerciseID} onClick={() => addExercise(ex)}
                style={{ width:'100%', background:'none', border:'none', padding:'7px 4px',
                  display:'flex', alignItems:'center', gap:'6px', cursor: day.isRestDay ? 'default' : 'pointer',
                  borderBottom:'1px solid rgba(255,255,255,0.05)', textAlign:'left',
                  opacity: day.isRestDay ? 0.35 : 1 }}
                onMouseEnter={e => { if (!day.isRestDay) e.currentTarget.style.background='rgba(249,115,22,0.08)'; }}
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
          {phases.length > 1 && (
            <div style={{ display:'flex', gap:'4px', overflowX:'auto', flexShrink:0, paddingBottom:'2px' }}>
              {phases.map((p, i) => (
                <button key={p.id} onClick={() => { setActivePhase(i); setActiveDay(0); }}
                  style={{ padding:'4px 10px', borderRadius:'6px', border:'none', cursor:'pointer',
                    whiteSpace:'nowrap', fontSize:'11px', fontWeight: activePhase===i ? 600 : 400,
                    background: activePhase===i ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.06)',
                    color: activePhase===i ? '#f97316' : '#64748b', transition:'all 0.15s', flexShrink:0 }}>
                  {p.name || `Phase ${i+1}`}
                </button>
              ))}
            </div>
          )}
          <div style={{ display:'flex', gap:'4px', overflowX:'auto', flexShrink:0, paddingBottom:'4px' }}>
            {days.map((d, i) => (
              <button key={d.id} onClick={() => setActiveDay(i)}
                style={{ padding:'5px 10px', borderRadius:'6px', border:'none', cursor:'pointer',
                  whiteSpace:'nowrap', fontSize:'12px', fontWeight: activeDay===i ? 600 : 400,
                  background: d.isRestDay
                    ? (activeDay===i ? 'rgba(100,116,139,0.25)' : 'rgba(255,255,255,0.03)')
                    : (activeDay===i ? '#f97316' : 'rgba(255,255,255,0.08)'),
                  color: d.isRestDay
                    ? (activeDay===i ? '#64748b' : '#334155')
                    : (activeDay===i ? '#fff' : '#94a3b8'),
                  transition:'all 0.15s', flexShrink:0 }}>
                {d.isRestDay ? '🌙' : (d.dayName || `Day ${i+1}`)}
                {!d.isRestDay && (d.exercises||[]).length > 0 &&
                  <span style={{ marginLeft:'4px', opacity:0.7 }}>({d.exercises.length})</span>}
              </button>
            ))}
          </div>

          {day.isRestDay ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', gap:'8px' }}>
              <div style={{ fontSize:'32px' }}>🌙</div>
              <div style={{ fontSize:'14px', color:'#64748b', fontWeight:500 }}>Rest Day</div>
              <div style={{ fontSize:'12px', color:'#475569' }}>No exercises — recovery only</div>
            </div>
          ) : (
            <>
              {lastDeleted && (
                <div style={{ flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between',
                  background:'rgba(249,115,22,0.1)', border:'1px solid rgba(249,115,22,0.25)',
                  borderRadius:'8px', padding:'7px 12px' }}>
                  <span style={{ color:'#94a3b8', fontSize:'12px' }}>
                    Deleted <strong style={{color:'#f1f5f9'}}>{lastDeleted.ex.name}</strong>
                  </span>
                  <button onClick={undoRemove}
                    style={{ background:'#f97316', border:'none', borderRadius:'6px',
                      color:'#fff', fontSize:'12px', fontWeight:600, cursor:'pointer', padding:'4px 10px' }}>
                    ↩ Undo
                  </button>
                </div>
              )}
              <div style={{ overflowY:'auto', flex:1 }}>
                {exercises.length === 0 ? (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', height:'80%', gap:'8px', color:'#475569' }}>
                    <div style={{ fontSize:'28px' }}>💪</div>
                    <div style={{ fontSize:'13px' }}>Search and click exercises on the left to add them here</div>
                  </div>
                ) : (() => {
                  const seenSS = new Set();
                  return exercises.map((ex, i) => {
                    const ssLabel = ex.supersetId ? getSupersetLabel(ex.supersetId) : null;
                    const ssColor = ex.supersetId ? getSupersetColor(ex.supersetId) : null;
                    const isFirst = ex.supersetId && !seenSS.has(ex.supersetId);
                    if (ex.supersetId) seenSS.add(ex.supersetId);
                    const isLast = ex.supersetId &&
                      (i === exercises.length - 1 || exercises[i+1]?.supersetId !== ex.supersetId);
                    return (
                      <React.Fragment key={ex.id}>
                        {isFirst && (
                          <div style={{ display:'flex', alignItems:'center', gap:'6px',
                            padding:'5px 10px 3px', marginTop:'6px',
                            borderLeft:`3px solid ${ssColor}`, background:`${ssColor}10`,
                            borderRadius:'0 6px 0 0' }}>
                            <span style={{ fontSize:'10px', fontWeight:700, color: ssColor,
                              letterSpacing:'0.06em', textTransform:'uppercase' }}>
                              ⚡ Superset {ssLabel}
                            </span>
                            <span style={{ fontSize:'10px', color:'#475569' }}>
                              — do all exercises back-to-back, then rest
                            </span>
                          </div>
                        )}
                        <ExerciseRow ex={ex} index={i} total={exercises.length}
                          onMove={moveExercise} onUpdate={updateExercise} onRemove={removeExercise}
                          onCreateSuperset={createSuperset} onRemoveFromSuperset={removeFromSuperset}
                          supersetLabel={ssLabel} supersetColor={ssColor} isLastInSuperset={isLast}
                          allExercises={allExercises} />
                      </React.Fragment>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CreateProgramModal ───────────────────────────────────────────────────────
const STEP_LABELS = ['Details', 'Phases', 'Day Names', 'Exercises'];

const defaultProgramData = () => ({
  name: '', description: '', goal: 'Muscle Gain', daysPerWeek: 4,
  numPhases: 3,
  level: 'Intermediate', equipment: [], focusAreas: [],
  sessionDuration: 60, trainingType: 'Hypertrophy',
});

function parsePhasesFromProgram(prog) {
  if (prog?.phasesJSON || prog?.PhasesJSON) {
    try { return JSON.parse(prog.PhasesJSON || prog.phasesJSON); } catch {}
  }
  // Backward compat: wrap DaysJSON in a single phase
  const days = prog?.days || [];
  return [{ id: generateId('phase'), name: 'Phase 1', order: 1, weekCount: prog?.durationWeeks || 4, days }];
}

function CreateProgramModal({ initial, allExercises, onClose, onSave }) {
  const isEdit = !!initial;
  const [step, setStep]       = useState(0);
  const [data, setData]       = useState(initial ? {
    name: initial.name, description: initial.description || '',
    goal: initial.goal, daysPerWeek: initial.daysPerWeek,
    level: initial.level || 'Intermediate',
    equipment: initial.equipment || [], focusAreas: initial.focusAreas || [],
    sessionDuration: initial.sessionDuration || 60,
    trainingType: initial.trainingType || 'Hypertrophy',
  } : defaultProgramData());
  const [phases, setPhases]   = useState(() =>
    initial ? parsePhasesFromProgram(initial) : initPhases(3, 4)
  );
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const updateData = (field, val) => {
    setData(d => ({ ...d, [field]: val }));
    if (field === 'daysPerWeek') {
      setPhases(ps => ps.map(p => ({ ...p, days: initDays(val, p.days) })));
    }
    if (field === 'numPhases') {
      setPhases(ps => initPhases(val, ps[0]?.days?.filter(d => !d.isRestDay).length || 4, ps));
    }
  };

  const canNext = () => {
    if (step === 0) return data.name.trim().length > 0;
    return true;
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const durationWeeks = totalProgramWeeks(phases);
      // DaysJSON = first phase days (backward compat for TrainingPage until it reads PhasesJSON)
      const days = phases[0]?.days || [];
      await onSave({ ...data, days, phases, durationWeeks, id: initial?.id });
      onClose();
    } catch(e) { setError(e.message); setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'12px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%',
        maxWidth: step === 3 ? '720px' : '520px',
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
        <div style={{ overflowY: step === 3 ? 'hidden' : 'auto', flex:1, padding:'20px' }}>
          {step === 0 && <StepDetails data={data} onChange={updateData} />}
          {step === 1 && <StepDefinePhases phases={phases} daysPerWeek={data.daysPerWeek}
            onPhasesChange={setPhases} />}
          {step === 2 && <StepBuildDays phases={phases} daysPerWeek={data.daysPerWeek}
            onPhasesChange={setPhases} />}
          {step === 3 && <StepExercises phases={phases} onPhasesChange={setPhases}
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
  const [goalFilter, setGoalFilter]   = useState('All');
  const [searchQuery,  setSearchQuery]  = useState('');
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
    clients.forEach(c => {
      if (c.ProgramID) {
        if (!m[c.ProgramID]) m[c.ProgramID] = [];
        m[c.ProgramID].push(c.ClientID);
      }
    });
    return m;
  }, [clients]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rawProgs, rawClients, rawExercises] = await Promise.all([
        readSheet('Programs').catch(() => []),
        readSheet('Clients').catch(() => []),
        readSheet('Exercises').catch(() => []),
      ]);

      // Parse days/phases JSON for each program
      const parsed = rawProgs.map(p => {
        let days = [];
        let phases = null;
        try { days = p.DaysJSON ? JSON.parse(p.DaysJSON) : []; } catch {}
        try { phases = p.PhasesJSON ? JSON.parse(p.PhasesJSON) : null; } catch {}
        return {
          id: p.ProgramID, name: p.Name, description: p.Description || '',
          goal: p.Goal || 'General Fitness', daysPerWeek: +p.DaysPerWeek || 3,
          durationWeeks: +p.DurationWeeks || 8, level: p.Level || 'Intermediate',
          equipment: p.Equipment ? p.Equipment.split(',').map(s=>s.trim()) : [],
          focusAreas: p.FocusAreas ? p.FocusAreas.split(',').map(s=>s.trim()) : [],
          days, phases, createdAt: p.CreatedAt || '',
          sessionDuration: +p.SessionDuration || 60,
          trainingType: p.TrainingType || 'Hypertrophy',
        };
      });
      setPrograms(parsed);
      setClients(rawClients);
      setExercises(rawExercises);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = programs.filter(p => {
    const matchGoal = goalFilter === 'All' || p.goal === goalFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch = !q
      || (p.name || '').toLowerCase().includes(q)
      || (p.goal || '').toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q);
    return matchGoal && matchSearch;
  });

  // Save program (create or edit)
  const handleSaveProgram = async ({ id, name, description, goal, daysPerWeek,
    durationWeeks, level, equipment, focusAreas, days, phases, sessionDuration, trainingType }) => {
    const programId = id || generateId('prog');
    const rowData = {
      ProgramID: programId, Name: name, Description: description,
      Goal: goal, DaysPerWeek: daysPerWeek, DurationWeeks: durationWeeks,
      Level: level, Equipment: equipment.join(', '), FocusAreas: focusAreas.join(', '),
      SessionDuration: sessionDuration || 60, TrainingType: trainingType || 'Hypertrophy',
      DaysJSON: JSON.stringify(days),
      PhasesJSON: JSON.stringify(phases || [{ id: generateId('phase'), name: 'Phase 1', order: 1, weekCount: durationWeeks, days }]),
      CreatedAt: id ? undefined : todayISO(),
    };
    if (id) delete rowData.CreatedAt;
    await upsertSheetRow('Programs', 'ProgramID', programId, rowData);

    // Optimistic update
    const newProg = { id: programId, name, description, goal, daysPerWeek,
      durationWeeks, level, equipment, focusAreas, days, phases, sessionDuration, trainingType };
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
      PhasesJSON: copy.phases ? JSON.stringify(copy.phases) : undefined,
      CreatedAt: todayISO(),
    };
    await upsertSheetRow('Programs', 'ProgramID', newId, rowData);
    setPrograms(prev => [copy, ...prev]);
  };

  // Assign to clients — store ProgramID + TrainingDays directly on the Client row
  const handleAssign = async (programId, clientIds, trainingDays) => {
    const daysStr = (trainingDays || []).join(',');
    // Assign selected clients — upsertRow from sheets.js invalidates cache automatically
    for (const cid of clientIds) {
      await upsertRow('Clients', 'ClientID', cid, { ProgramID: programId, TrainingDays: daysStr });
    }
    // Clear program from unselected clients that previously had this program
    const previouslyAssigned = clients.filter(
      c => c.ProgramID === programId && !clientIds.includes(c.ClientID)
    );
    for (const c of previouslyAssigned) {
      await upsertRow('Clients', 'ClientID', c.ClientID, { ProgramID: '', TrainingDays: '' });
    }
    invalidateCache('Clients');
    await fetchData(); // refresh
  };

  const handleDeleteProgram = async (progId) => {
    // Optimistic update immediately
    setPrograms(prev => prev.filter(p => p.id !== progId));
    try {
      invalidateCache('Programs');
      invalidateCache('ClientPrograms');
      await deleteSheetRowsWhere('Programs', 'ProgramID', progId);
      await deleteSheetRowsWhere('ClientPrograms', 'ProgramID', progId);
    } catch (e) {
      console.error('Delete failed:', e);
      alert('Could not delete program: ' + (e?.message || String(e)));
      await fetchData(); // revert by reloading
    }
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
    <>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
        <div>
          <h1 style={{ color:'#f1f5f9', fontWeight:800, fontSize:'22px', margin:0 }}>Program Library</h1>
          <div style={{ color:'#64748b', fontSize:'13px', marginTop:'4px' }}>
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

      {/* Search */}
      <input
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search programs…"
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '9px 14px', borderRadius: '10px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#f1f5f9', fontSize: '14px', outline: 'none',
          marginBottom: '10px',
        }}
      />
      <FilterBar active={goalFilter} onChange={setGoalFilter} />

      {/* Program list */}
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
            {searchQuery ? `No programs matching "${searchQuery}"` : goalFilter !== 'All' ? `No ${goalFilter} programs yet` : 'No programs yet'}
          </div>
          <button onClick={() => { setAIInitial(null); setCreateOpen(true); }}
            style={{ padding:'10px 20px', background:'#f97316', border:'none',
              borderRadius:'8px', color:'#fff', fontSize:'14px', cursor:'pointer' }}>
            Create your first program
          </button>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:'20px' }}>
          {filtered.map(prog => (
            <ProgramCard key={prog.id} program={prog}
              clientCount={(assignedMap[prog.id]||[]).length}
              onDelete={() => handleDeleteProgram(prog.id)}
              onEdit={() => setEditTarget(prog)}
              onDuplicate={() => handleCopy(prog)}
              onAssign={() => setAssignTarget(prog)} />
          ))}
        </div>
      )}

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
    </>
  );
}
