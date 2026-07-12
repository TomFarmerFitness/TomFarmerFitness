import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { readSheet, appendToSheet, upsertRow, invalidateCache } from '../../utils/sheets';
import config from '../../config';
import { CreateProgramModal, parsePhasesFromProgram, generateId, totalProgramWeeks } from '../../components/trainer/CreateProgramModal';

// ─── Page-level constants ─────────────────────────────────────────────────────

const GOAL_FILTERS = ['All', 'Weight Loss', 'Muscle Gain', 'Strength', 'General Fitness'];

const GOAL_COLORS = {
  'Weight Loss':     { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.4)',  text: '#60a5fa' },
  'Muscle Gain':     { bg: 'rgba(168,85,247,0.15)',  border: 'rgba(168,85,247,0.4)',  text: '#c084fc' },
  'Strength':        { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',   text: '#f87171' },
  'General Fitness': { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.4)',   text: '#4ade80' },
};

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
