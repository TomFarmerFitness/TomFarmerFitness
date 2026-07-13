import React, { useState, useEffect, useRef, useMemo } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────
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
const WD_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ─── Utilities ────────────────────────────────────────────────────────────────
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function countProgramExercises(programId, sessions) {
  return sessions.filter(s => s.ProgramID === programId)
    .reduce((total, s) => {
      try { return total + JSON.parse(s.Exercises || '[]').length; } catch { return total; }
    }, 0);
}
function initWeekSchedules(weekCount, existing = []) {
  return Array.from({ length: weekCount }, (_, i) =>
    (existing[i] && existing[i].length === 7) ? existing[i] : Array(7).fill(null)
  );
}
function initPhase(order, daysPerWeek, existing = null) {
  return existing || {
    id:               generateId('phase'),
    name:             `Phase ${order}`,
    order,
    weekCount:        4,
    sessionTemplates: [],
    weekSchedules:    initWeekSchedules(4),
    days:             [],
  };
}
function initPhases(count, daysPerWeek, existing = []) {
  return Array.from({ length: count }, (_, i) =>
    initPhase(i + 1, daysPerWeek, existing[i] || null)
  );
}
function totalProgramWeeks(phases) {
  return (phases || []).reduce((s, p) => s + (p.weekCount || 4), 0);
}

// Migrate a phase from legacy format (days[]) to new format (sessionTemplates + weekSchedules)
function migratePhaseLegacy(phase) {
  if (phase.sessionTemplates && phase.weekSchedules) return phase;
  const trainingDays = (phase.days || []).filter(d => !d.isRestDay);
  const sessMap = {};
  trainingDays.forEach(day => {
    const name = day.dayName || day.weekDay || `Session ${day.dayOrder}`;
    if (!sessMap[name]) {
      sessMap[name] = { id: generateId('sess'), name, exercises: day.exercises || [] };
    }
  });
  const sessionTemplates = Object.values(sessMap);
  const allDays = phase.days || [];
  const firstWeekSched = Array.from({ length: 7 }, (_, i) => {
    const day = allDays[i];
    if (!day || day.isRestDay) return null;
    const name = day.dayName || day.weekDay || `Session ${day.dayOrder}`;
    return sessMap[name]?.id || null;
  });
  const weekSchedules = Array.from({ length: phase.weekCount || 4 }, () => [...firstWeekSched]);
  return { ...phase, sessionTemplates, weekSchedules };
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const INPUT_STYLE = {
  background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
  borderRadius:'8px', color:'#f1f5f9', fontSize:'14px', padding:'10px 12px', boxSizing:'border-box',
};
const LABEL_STYLE = { color:'#64748b', fontSize:'12px', letterSpacing:'0.05em', marginBottom:'6px', display:'block' };
const phaseTabs = (phases, active, setActive) => (
  phases.length > 1 && (
    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginBottom:'16px' }}>
      {phases.map((p, i) => (
        <button key={p.id} onClick={() => setActive(i)}
          style={{ padding:'6px 14px', borderRadius:'8px', border:'none', cursor:'pointer',
            fontSize:'13px', fontWeight: active === i ? 600 : 400,
            background: active === i ? '#f97316' : 'rgba(255,255,255,0.08)',
            color: active === i ? '#fff' : '#94a3b8', transition:'all 0.15s' }}>
          {p.name || `Phase ${i+1}`}
        </button>
      ))}
    </div>
  )
);

// ─── Step 1: Details ──────────────────────────────────────────────────────────
function StepDetails({ data, onChange }) {
  const chipStyle = (active) => ({
    padding:'7px 14px', borderRadius:'20px', fontSize:'13px', cursor:'pointer', border:'none',
    background: active ? '#f97316' : 'rgba(255,255,255,0.08)',
    color: active ? '#fff' : '#94a3b8', fontWeight: active ? 600 : 400, transition:'all 0.15s',
  });
  const toggleEquip = val =>
    onChange('equipment', data.equipment.includes(val)
      ? data.equipment.filter(x => x !== val) : [...data.equipment, val]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>
      <div>
        <label style={LABEL_STYLE}>PROGRAM NAME *</label>
        <input value={data.name} onChange={e => onChange('name', e.target.value)}
          placeholder="e.g. 12-Week Hypertrophy Block" style={{ ...INPUT_STYLE, width:'100%' }} />
      </div>
      <div>
        <label style={LABEL_STYLE}>DESCRIPTION</label>
        <textarea value={data.description} onChange={e => onChange('description', e.target.value)}
          placeholder="What is this program designed to achieve?"
          rows={3} style={{ ...INPUT_STYLE, width:'100%', resize:'vertical', fontFamily:'inherit' }} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
        <div>
          <label style={LABEL_STYLE}>GOAL</label>
          <select value={data.goal} onChange={e => onChange('goal', e.target.value)} style={{ ...INPUT_STYLE, width:'100%' }}>
            {['Weight Loss','Muscle Gain','Strength','General Fitness'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={LABEL_STYLE}>LEVEL</label>
          <select value={data.level} onChange={e => onChange('level', e.target.value)} style={{ ...INPUT_STYLE, width:'100%' }}>
            {['Beginner','Intermediate','Advanced'].map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL_STYLE}>TRAINING TYPE</label>
          <select value={data.trainingType} onChange={e => onChange('trainingType', e.target.value)} style={{ ...INPUT_STYLE, width:'100%' }}>
            {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL_STYLE}>SESSION DURATION</label>
          <select value={data.sessionDuration} onChange={e => onChange('sessionDuration', +e.target.value)} style={{ ...INPUT_STYLE, width:'100%' }}>
            {SESSION_DURATIONS.map(d => <option key={d} value={d}>{d} mins</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={LABEL_STYLE}>EQUIPMENT</label>
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

// ─── Step 2: Define Phases ────────────────────────────────────────────────────
function StepDefinePhases({ phases, onPhasesChange }) {
  const addPhase = () => {
    onPhasesChange([...phases, initPhase(phases.length + 1, 3)]);
  };
  const removePhase = (i) => {
    if (phases.length <= 1) return;
    onPhasesChange(phases.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, order: idx + 1 })));
  };
  const updatePhase = (i, field, val) => {
    const next = [...phases];
    let updated = { ...next[i], [field]: val };
    if (field === 'weekCount') {
      updated.weekSchedules = initWeekSchedules(val, updated.weekSchedules || []);
    }
    next[i] = updated;
    onPhasesChange(next);
  };
  const totalWeeks = totalProgramWeeks(phases);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px' }}>
        Break your program into phases (e.g. Foundation → Build → Peak). You will define sessions and the weekly schedule for each phase in the next steps.
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
            <input value={phase.name} onChange={e => updatePhase(i, 'name', e.target.value)}
              placeholder={`Phase ${i + 1} name (e.g. Foundation, Build, Peak)`}
              style={{ ...INPUT_STYLE, flex:1 }} />
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
        <span style={{ color:'#64748b', fontSize:'13px' }}>{phases.length} phase{phases.length !== 1 ? 's' : ''}</span>
        <span style={{ color:'#f97316', fontSize:'13px', fontWeight:600 }}>{totalWeeks} weeks total</span>
      </div>
    </div>
  );
}

// ─── Step 3: Sessions per Phase ───────────────────────────────────────────────
function StepSessions({ phases, onPhasesChange }) {
  const [activePhase, setActivePhase] = useState(0);
  const [newName, setNewName] = useState('');
  const inputRef = useRef(null);

  const phase = phases[activePhase] || phases[0];
  const sessions = phase?.sessionTemplates || [];

  const addSession = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const sess = { id: generateId('sess'), name: trimmed, exercises: [] };
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p, sessionTemplates: [...(p.sessionTemplates || []), sess]
    }));
    setNewName('');
    inputRef.current?.focus();
  };

  const removeSession = (sessId) => {
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      sessionTemplates: (p.sessionTemplates || []).filter(s => s.id !== sessId),
      weekSchedules: (p.weekSchedules || []).map(week =>
        week.map(sid => sid === sessId ? null : sid)
      ),
    }));
  };

  const renameSession = (sessId, val) => {
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      sessionTemplates: (p.sessionTemplates || []).map(s =>
        s.id === sessId ? { ...s, name: val } : s
      ),
    }));
  };

  const QUICK_NAMES = ['Push A', 'Pull A', 'Legs A', 'Upper Body', 'Lower Body', 'Full Body', 'Cardio', 'Deload'];
  const usedNames = sessions.map(s => s.name);
  const suggestions = QUICK_NAMES.filter(n => !usedNames.includes(n));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px' }}>
        Define the workout types for each phase. You will assign them to specific days of the week in the next step.
      </div>

      {phaseTabs(phases, activePhase, (i) => { setActivePhase(i); setNewName(''); })}

      <div>
        <div style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'12px' }}>
          Sessions in {phase?.name || `Phase ${activePhase + 1}`}
        </div>

        {sessions.length === 0 ? (
          <div style={{ background:'rgba(249,115,22,0.04)', border:'1px dashed rgba(249,115,22,0.2)',
            borderRadius:'10px', padding:'20px', textAlign:'center', color:'#475569', fontSize:'13px', marginBottom:'12px' }}>
            No sessions yet — add your first workout session below
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'12px' }}>
            {sessions.map((sess, idx) => (
              <div key={sess.id} style={{ display:'flex', alignItems:'center', gap:'10px',
                background:'rgba(249,115,22,0.08)', border:'1px solid rgba(249,115,22,0.25)',
                borderRadius:'10px', padding:'10px 14px' }}>
                <div style={{ width:'26px', height:'26px', borderRadius:'50%',
                  background:'rgba(249,115,22,0.2)', display:'flex', alignItems:'center', justifyContent:'center',
                  color:'#f97316', fontSize:'12px', fontWeight:700, flexShrink:0 }}>
                  {idx + 1}
                </div>
                <input value={sess.name} onChange={e => renameSession(sess.id, e.target.value)}
                  style={{ flex:1, background:'transparent', border:'none', outline:'none',
                    color:'#f1f5f9', fontSize:'14px', fontWeight:600 }} />
                <button onClick={() => removeSession(sess.id)}
                  style={{ background:'none', border:'none', color:'#64748b',
                    fontSize:'16px', cursor:'pointer', padding:'2px 6px', lineHeight:1,
                    borderRadius:'4px' }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add session input */}
        <div style={{ display:'flex', gap:'8px' }}>
          <input
            ref={inputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSession()}
            placeholder="Session name (e.g. Push A, Legs B, Upper Body)"
            style={{ ...INPUT_STYLE, flex:1 }}
          />
          <button onClick={addSession}
            style={{ padding:'10px 18px', background: newName.trim() ? '#f97316' : 'rgba(249,115,22,0.2)',
              border:'none', borderRadius:'8px', color:'#fff',
              fontSize:'14px', fontWeight:600, cursor: newName.trim() ? 'pointer' : 'default',
              whiteSpace:'nowrap', transition:'all 0.15s' }}>
            + Add
          </button>
        </div>

        {/* Quick-add suggestions */}
        {suggestions.length > 0 && (
          <div style={{ marginTop:'10px' }}>
            <div style={{ color:'#475569', fontSize:'11px', marginBottom:'6px' }}>Quick add:</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {suggestions.slice(0, 6).map(name => (
                <button key={name}
                  onClick={() => {
                    const sess = { id: generateId('sess'), name, exercises: [] };
                    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
                      ...p, sessionTemplates: [...(p.sessionTemplates || []), sess]
                    }));
                  }}
                  style={{ padding:'5px 12px', borderRadius:'20px', border:'1px solid rgba(249,115,22,0.3)',
                    background:'rgba(249,115,22,0.06)', color:'#f97316',
                    fontSize:'12px', cursor:'pointer', transition:'all 0.15s' }}>
                  + {name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Weekly Schedule per Week ─────────────────────────────────────────
function StepSchedule({ phases, onPhasesChange }) {
  const [activePhase, setActivePhase] = useState(0);
  const [activeWeek, setActiveWeek] = useState(0);

  const phase = phases[activePhase] || phases[0];
  const sessions = phase?.sessionTemplates || [];
  const weekCount = phase?.weekCount || 4;
  const weekSchedules = phase?.weekSchedules || [];
  const weekSchedule = weekSchedules[activeWeek] || Array(7).fill(null);

  const assignSession = (dayIdx, sessionId) => {
    const newSched = [...weekSchedule];
    newSched[dayIdx] = sessionId || null;
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      weekSchedules: (p.weekSchedules || []).map((w, wi) =>
        wi !== activeWeek ? w : newSched
      ),
    }));
  };

  const copyFromPrevious = () => {
    if (activeWeek === 0) return;
    const prevSched = weekSchedules[activeWeek - 1] || Array(7).fill(null);
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      weekSchedules: (p.weekSchedules || []).map((w, wi) =>
        wi !== activeWeek ? w : [...prevSched]
      ),
    }));
  };

  const applyToAllWeeks = () => {
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      weekSchedules: Array.from({ length: weekCount }, () => [...weekSchedule]),
    }));
  };

  const trainingCount = weekSchedule.filter(sid => !!sid).length;
  const getSessionName = (sid) => sessions.find(s => s.id === sid)?.name || '';

  // Select style needs background for dark theme
  const selectStyle = {
    background:'#1e293b', border:'1px solid rgba(255,255,255,0.12)',
    borderRadius:'8px', color:'#f1f5f9', fontSize:'13px',
    padding:'8px 10px', flex:1, cursor:'pointer',
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ color:'#94a3b8', fontSize:'13px' }}>
        For each week, choose which sessions the client does on each day. You can set different schedules per week (e.g. deload weeks).
      </div>

      {phaseTabs(phases, activePhase, (i) => { setActivePhase(i); setActiveWeek(0); })}

      {/* Week selector */}
      <div>
        <div style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'8px' }}>
          Week
        </div>
        <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', alignItems:'center' }}>
          {Array.from({ length: weekCount }, (_, i) => {
            const sched = weekSchedules[i] || Array(7).fill(null);
            const hasContent = sched.some(sid => !!sid);
            return (
              <button key={i} onClick={() => setActiveWeek(i)}
                style={{ padding:'6px 14px', borderRadius:'8px', border:'none', cursor:'pointer',
                  fontSize:'13px', fontWeight: activeWeek === i ? 700 : 400, position:'relative',
                  background: activeWeek === i ? '#f97316' : hasContent ? 'rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.06)',
                  color: activeWeek === i ? '#fff' : hasContent ? '#f97316' : '#64748b',
                  transition:'all 0.15s' }}>
                Week {i + 1}
                {hasContent && activeWeek !== i && (
                  <span style={{ marginLeft:'4px', fontSize:'10px', opacity:0.7 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* No sessions warning */}
      {sessions.length === 0 && (
        <div style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.25)',
          borderRadius:'8px', padding:'10px 14px', color:'#fbbf24', fontSize:'13px' }}>
          ⚠️ No sessions defined for {phase?.name || `Phase ${activePhase+1}`} yet. Go back to Step 3 and add sessions first.
        </div>
      )}

      {/* Day assignments */}
      <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
        {WD_NAMES.map((dayName, dayIdx) => {
          const sid = weekSchedule[dayIdx] || '';
          const isTraining = !!sid;
          return (
            <div key={dayName} style={{
              display:'flex', alignItems:'center', gap:'12px',
              background: isTraining ? 'rgba(249,115,22,0.06)' : 'rgba(255,255,255,0.02)',
              border: isTraining ? '1px solid rgba(249,115,22,0.2)' : '1px solid rgba(255,255,255,0.05)',
              borderRadius:'10px', padding:'10px 14px' }}>
              <div style={{ width:'36px', fontWeight:700, fontSize:'13px', flexShrink:0,
                color: isTraining ? '#f97316' : '#334155' }}>
                {dayName}
              </div>
              <select
                value={sid}
                onChange={e => assignSession(dayIdx, e.target.value || null)}
                style={{ ...selectStyle, borderColor: isTraining ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.12)' }}>
                <option value="">🌙 Rest</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>💪 {s.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {/* Actions + summary */}
      <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
        {activeWeek > 0 && (
          <button onClick={copyFromPrevious}
            style={{ padding:'7px 14px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.1)',
              background:'rgba(255,255,255,0.05)', color:'#94a3b8',
              fontSize:'12px', cursor:'pointer' }}>
            Copy from Week {activeWeek}
          </button>
        )}
        <button onClick={applyToAllWeeks}
          style={{ padding:'7px 14px', borderRadius:'8px', border:'1px solid rgba(249,115,22,0.3)',
            background:'rgba(249,115,22,0.08)', color:'#f97316',
            fontSize:'12px', cursor:'pointer' }}>
          Apply to all {weekCount} weeks
        </button>
        <div style={{ marginLeft:'auto', color:'#64748b', fontSize:'13px' }}>
          <span style={{ color: trainingCount > 0 ? '#f97316' : '#475569', fontWeight:600 }}>
            {trainingCount} training
          </span>
          {' · '}
          {7 - trainingCount} rest
        </div>
      </div>
    </div>
  );
}

// ─── ExerciseRow (drag + reorder + sets/reps/rest + alternatives) ─────────────
function ExerciseRow({ ex, index, total, onMove, onUpdate, onRemove, allExercises, onCreateSuperset, onRemoveFromSuperset, supersetLabel, supersetColor, isLastInSuperset }) {
  const [showAlt, setShowAlt] = useState(false);

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
        <span style={{ color:'#334155', fontSize:'16px', cursor:'grab', userSelect:'none', flexShrink:0 }}>⠿</span>
        <span style={{ width:'22px', height:'22px', borderRadius:'50%', background:'rgba(249,115,22,0.15)',
          color:'#f97316', fontSize:'11px', fontWeight:700, display:'flex', alignItems:'center',
          justifyContent:'center', flexShrink:0 }}>
          {index + 1}
        </span>
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
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexShrink:0 }}>
          <div><span style={labelMini}>Sets</span>
            <input type="number" min={1} max={20} value={ex.sets || 3}
              onChange={e => onUpdate(index, 'sets', e.target.value)} style={inputMini} /></div>
          <div><span style={labelMini}>Reps</span>
            <input value={ex.reps || '10'} onChange={e => onUpdate(index, 'reps', e.target.value)}
              style={inputMini} placeholder="10" /></div>
          <div><span style={labelMini}>Rest</span>
            <input value={ex.rest || '60s'} onChange={e => onUpdate(index, 'rest', e.target.value)}
              style={inputMini} placeholder="60s" /></div>
          <div><span style={labelMini}>+kg/wk</span>
            <input type="number" min={0} max={20} step={0.5} value={ex.weightIncrement ?? 2.5}
              onChange={e => onUpdate(index, 'weightIncrement', parseFloat(e.target.value) || 2.5)}
              style={{ ...inputMini, width:'48px' }} /></div>
        </div>
        <div style={{ display:'flex', gap:'4px', flexShrink:0 }}>
          <button onClick={() => setShowAlt(v => !v)} title="Alternatives"
            style={{ background:'none', border:'none', color: showAlt ? '#f97316' : '#64748b',
              fontSize:'14px', cursor:'pointer', padding:'4px' }}>⇄</button>
          <button
            onClick={() => ex.supersetId ? onRemoveFromSuperset(index) : onCreateSuperset(index)}
            title={ex.supersetId ? `Unlink superset ${supersetLabel}` : (index < total - 1 ? 'Link with next (superset)' : '')}
            disabled={!ex.supersetId && index >= total - 1}
            style={{ background:'none', border:'none', padding:'4px', fontSize:'14px',
              cursor: (ex.supersetId || index < total - 1) ? 'pointer' : 'default',
              color: ex.supersetId ? supersetColor : index < total - 1 ? '#475569' : '#1e293b',
              opacity: (!ex.supersetId && index >= total - 1) ? 0.3 : 1 }}>🔗</button>
          <button onClick={() => onRemove(index)}
            style={{ background:'none', border:'none', color:'#64748b', fontSize:'14px', cursor:'pointer', padding:'4px' }}>✕</button>
        </div>
      </div>
      <div style={{ padding:'0 12px 10px', paddingLeft:'54px' }}>
        <input value={ex.notes || ''} onChange={e => onUpdate(index, 'notes', e.target.value)}
          placeholder="Notes (optional — e.g. full ROM, pause at bottom)"
          style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:'none',
            borderTop:'1px solid rgba(255,255,255,0.06)', color:'#94a3b8',
            fontSize:'12px', padding:'6px 0', boxSizing:'border-box', outline:'none' }} />
      </div>
      {showAlt && (
        <div style={{ borderTop:'1px solid rgba(255,255,255,0.08)', padding:'10px 12px', background:'rgba(0,0,0,0.2)' }}>
          <div style={{ color:'#64748b', fontSize:'11px', marginBottom:'6px' }}>ALTERNATIVE EXERCISES</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
            {allExercises
              .filter(e => e.PrimaryMuscle === ex.muscleGroup && e.Name !== ex.name)
              .slice(0, 8)
              .map(e => (
                <button key={e.ExerciseID}
                  onClick={() => { onUpdate(index, 'name', e.Name); onUpdate(index, 'exerciseId', e.ExerciseID); setShowAlt(false); }}
                  style={{ padding:'5px 10px', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'20px',
                    color:'#94a3b8', fontSize:'12px', cursor:'pointer' }}
                  onMouseEnter={e2 => { e2.currentTarget.style.borderColor='#f97316'; e2.currentTarget.style.color='#f97316'; }}
                  onMouseLeave={e2 => { e2.currentTarget.style.borderColor='rgba(255,255,255,0.1)'; e2.currentTarget.style.color='#94a3b8'; }}>
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

// ─── Step 5: Exercises per Session ────────────────────────────────────────────
const TRACKED_MUSCLES = [
  { key:'Chest', label:'Chest' }, { key:'Back', label:'Back' }, { key:'Shoulders', label:'Delts' },
  { key:'Biceps', label:'Bis' }, { key:'Triceps', label:'Tris' }, { key:'Quads', label:'Quads' },
  { key:'Hamstrings', label:'Hams' }, { key:'Glutes', label:'Glutes' },
  { key:'Calves', label:'Calves' }, { key:'Core', label:'Core' },
];

function StepExercises({ phases, onPhasesChange, allExercises }) {
  const [activePhase,   setActivePhase]   = useState(0);
  const [activeSession, setActiveSession] = useState(0);
  const [search,        setSearch]        = useState('');
  const [muscleFilter,  setMuscleFilter]  = useState('All');
  const [lastDeleted,   setLastDeleted]   = useState(null);
  const undoTimerRef = useRef(null);

  const phase    = phases[activePhase] || phases[0];
  const sessions = phase?.sessionTemplates || [];
  const session  = sessions[activeSession] || null;
  const exercises = session?.exercises || [];

  // Clamp activeSession when switching phases
  useEffect(() => {
    const max = ((phases[activePhase]?.sessionTemplates) || []).length - 1;
    if (activeSession > max && max >= 0) setActiveSession(0);
  }, [activePhase]);

  // Weekly sets tracker: aggregate from first week's schedule
  const weeklySets = useMemo(() => {
    const counts = {};
    const firstWeek = phase?.weekSchedules?.[0] || [];
    firstWeek.forEach(sessionId => {
      if (!sessionId) return;
      const sess = (phase?.sessionTemplates || []).find(s => s.id === sessionId);
      (sess?.exercises || []).forEach(ex => {
        const m = ex.muscleGroup || '';
        if (m) counts[m] = (counts[m] || 0) + (parseInt(ex.sets) || 0);
      });
    });
    return counts;
  }, [phase]);

  const filtered = allExercises.filter(e => {
    const matchSearch = !search || (e.Name || '').toLowerCase().includes(search.toLowerCase());
    const matchMuscle = muscleFilter === 'All' || e.PrimaryMuscle === muscleFilter;
    return matchSearch && matchMuscle;
  });

  const updateSessionExercises = (newExercises) => {
    onPhasesChange(phases.map((p, pi) => pi !== activePhase ? p : {
      ...p,
      sessionTemplates: (p.sessionTemplates || []).map((s, si) =>
        si !== activeSession ? s : { ...s, exercises: newExercises }
      ),
    }));
  };

  const addExercise = (ex) => {
    if (!session) return;
    const newEx = {
      id: generateId('exrow'), exerciseId: ex.ExerciseID,
      name: ex.Name, muscleGroup: ex.PrimaryMuscle || '',
      sets: 3, reps: '8-10', rest: '60s', weightIncrement: 2.5, notes: '', supersetId: null,
    };
    updateSessionExercises([...exercises, newEx]);
  };

  const moveExercise = (from, to) => {
    if (from === to) return;
    const arr = [...exercises];
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    updateSessionExercises(arr);
  };

  const updateExercise = (i, field, val) => {
    const arr = [...exercises];
    arr[i] = { ...arr[i], [field]: val };
    updateSessionExercises(arr);
  };

  const removeExercise = (i) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDeleted({ ex: exercises[i], idx: i });
    undoTimerRef.current = setTimeout(() => setLastDeleted(null), 6000);
    updateSessionExercises(exercises.filter((_, idx) => idx !== i));
  };

  const undoRemove = () => {
    if (!lastDeleted) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const arr = [...exercises];
    arr.splice(lastDeleted.idx, 0, lastDeleted.ex);
    updateSessionExercises(arr);
    setLastDeleted(null);
  };

  // Superset helpers
  const SUPERSET_COLORS = ['#f97316','#60a5fa','#4ade80','#a78bfa','#f87171','#fbbf24'];
  const getSupersetIdx = (ssId, exs) => {
    const ids = []; exs.forEach(e => { if (e.supersetId && !ids.includes(e.supersetId)) ids.push(e.supersetId); });
    return ids.indexOf(ssId);
  };
  const getSupersetLabel = (ssId) => { const i = getSupersetIdx(ssId, exercises); return i >= 0 ? 'ABCDEFGHIJ'[i] ?? String(i+1) : '?'; };
  const getSupersetColor = (ssId) => { const i = getSupersetIdx(ssId, exercises); return SUPERSET_COLORS[i % SUPERSET_COLORS.length]; };
  const applyRestRules = (exArr) => exArr.map((ex, i) => {
    if (!ex.supersetId) return ex;
    const isLast = i === exArr.length - 1 || exArr[i+1]?.supersetId !== ex.supersetId;
    return isLast ? ex : { ...ex, rest: '—' };
  });
  const createSuperset = (idx) => {
    if (idx >= exercises.length - 1) return;
    const curr = exercises[idx]; const nxt2 = exercises[idx+1];
    let arr;
    if (nxt2.supersetId && !curr.supersetId) arr = exercises.map((e, i) => i === idx ? { ...e, supersetId: nxt2.supersetId } : e);
    else if (curr.supersetId && !nxt2.supersetId) arr = exercises.map((e, i) => i === idx+1 ? { ...e, supersetId: curr.supersetId } : e);
    else { const ssId = `ss-${Date.now()}`; arr = exercises.map((e, i) => (i === idx || i === idx+1) ? { ...e, supersetId: ssId } : e); }
    updateSessionExercises(applyRestRules(arr));
  };
  const removeFromSuperset = (idx) => {
    const ssId = exercises[idx]?.supersetId; if (!ssId) return;
    const members = exercises.filter(e => e.supersetId === ssId);
    let arr = exercises.map((e, i) => {
      if (i === idx) return { ...e, supersetId: null };
      if (e.supersetId === ssId && members.length === 2) return { ...e, supersetId: null };
      return e;
    });
    updateSessionExercises(applyRestRules(arr));
  };

  const uniqueMuscles = ['All', ...new Set(allExercises.map(e => e.PrimaryMuscle).filter(Boolean))];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'8px', height:'460px' }}>

      {/* Weekly sets tracker */}
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
              <div style={{ fontSize:'9px', color:'#64748b', marginTop:'2px', textTransform:'uppercase', letterSpacing:'0.3px' }}>{label}</div>
            </div>
          );
        })}
      </div>

      {/* Phase tabs (compact) */}
      {phases.length > 1 && (
        <div style={{ flexShrink:0, display:'flex', gap:'4px', overflowX:'auto' }}>
          {phases.map((p, i) => (
            <button key={p.id} onClick={() => { setActivePhase(i); setActiveSession(0); }}
              style={{ padding:'4px 10px', borderRadius:'6px', border:'none', cursor:'pointer',
                whiteSpace:'nowrap', fontSize:'11px', fontWeight: activePhase===i ? 600 : 400,
                background: activePhase===i ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.06)',
                color: activePhase===i ? '#f97316' : '#64748b', transition:'all 0.15s', flexShrink:0 }}>
              {p.name || `Phase ${i+1}`}
            </button>
          ))}
        </div>
      )}

      {/* Main two-column layout */}
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
                  display:'flex', alignItems:'center', gap:'6px',
                  cursor: session ? 'pointer' : 'default',
                  borderBottom:'1px solid rgba(255,255,255,0.05)', textAlign:'left',
                  opacity: session ? 1 : 0.35 }}
                onMouseEnter={e => { if (session) e.currentTarget.style.background='rgba(249,115,22,0.08)'; }}
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

        {/* Right: session tabs + exercise builder */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:'8px', minWidth:0 }}>
          {/* Session tabs */}
          <div style={{ display:'flex', gap:'4px', overflowX:'auto', flexShrink:0, paddingBottom:'4px' }}>
            {sessions.length === 0 ? (
              <div style={{ color:'#475569', fontSize:'12px', padding:'6px 0' }}>
                No sessions in this phase — go back to Step 3 to add sessions.
              </div>
            ) : sessions.map((s, si) => (
              <button key={s.id} onClick={() => setActiveSession(si)}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', cursor:'pointer',
                  whiteSpace:'nowrap', fontSize:'12px', fontWeight: activeSession===si ? 600 : 400,
                  background: activeSession===si ? '#f97316' : 'rgba(255,255,255,0.08)',
                  color: activeSession===si ? '#fff' : '#94a3b8',
                  transition:'all 0.15s', flexShrink:0 }}>
                {s.name}
                {(s.exercises||[]).length > 0 &&
                  <span style={{ marginLeft:'4px', opacity:0.7, fontSize:'11px' }}>({s.exercises.length})</span>}
              </button>
            ))}
          </div>

          {!session ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', gap:'8px', color:'#475569' }}>
              <div style={{ fontSize:'28px' }}>💪</div>
              <div style={{ fontSize:'13px' }}>Select a session tab above to add exercises</div>
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
                    <div style={{ fontSize:'13px' }}>Search and click exercises on the left to add them to <strong style={{color:'#f97316'}}>{session.name}</strong></div>
                  </div>
                ) : (() => {
                  const seenSS = new Set();
                  return exercises.map((ex, i) => {
                    const ssLabel = ex.supersetId ? getSupersetLabel(ex.supersetId) : null;
                    const ssColor = ex.supersetId ? getSupersetColor(ex.supersetId) : null;
                    const isFirst = ex.supersetId && !seenSS.has(ex.supersetId);
                    if (ex.supersetId) seenSS.add(ex.supersetId);
                    const isLast = ex.supersetId && (i === exercises.length - 1 || exercises[i+1]?.supersetId !== ex.supersetId);
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
                              — do all back-to-back, then rest
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
const STEP_LABELS = ['Details', 'Phases', 'Sessions', 'Schedule', 'Exercises'];

const defaultProgramData = () => ({
  name: '', description: '', goal: 'Muscle Gain', daysPerWeek: 4,
  level: 'Intermediate', equipment: [], focusAreas: [],
  sessionDuration: 60, trainingType: 'Hypertrophy',
});

function parsePhasesFromProgram(prog) {
  if (prog?.PhasesJSON || prog?.phasesJSON) {
    try {
      const phases = JSON.parse(prog.PhasesJSON || prog.phasesJSON);
      return phases.map(migratePhaseLegacy);
    } catch {}
  }
  // Backward compat: wrap DaysJSON in a single phase
  const days = prog?.days || [];
  const singlePhase = {
    id: generateId('phase'), name: 'Phase 1', order: 1,
    weekCount: prog?.durationWeeks || 4, days,
  };
  return [migratePhaseLegacy(singlePhase)];
}

function CreateProgramModal({ initial, allExercises, onClose, onSave }) {
  const isEdit = !!initial;
  const [step, setStep]     = useState(0);
  const [data, setData]     = useState(initial ? {
    name: initial.name, description: initial.description || '',
    goal: initial.goal, daysPerWeek: initial.daysPerWeek,
    level: initial.level || 'Intermediate',
    equipment: initial.equipment || [], focusAreas: initial.focusAreas || [],
    sessionDuration: initial.sessionDuration || 60,
    trainingType: initial.trainingType || 'Hypertrophy',
  } : defaultProgramData());
  const [phases, setPhases] = useState(() =>
    initial ? parsePhasesFromProgram(initial) : initPhases(3, 4)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const updateData = (field, val) => {
    setData(d => ({ ...d, [field]: val }));
    if (field === 'numPhases') {
      setPhases(ps => initPhases(val, 0, ps));
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

      // Resolve weekSchedules + sessionTemplates → weekDays for each phase
      const resolvedPhases = phases.map(phase => {
        const templates  = phase.sessionTemplates || [];
        const schedules  = phase.weekSchedules || [];

        const weekDays = schedules.map(weekSched =>
          Array.from({ length: 7 }, (_, dayIdx) => {
            const sessionId = weekSched[dayIdx] || null;
            const sess = templates.find(s => s.id === sessionId);
            return {
              id:        generateId('day'),
              dayOrder:  dayIdx + 1,
              weekDay:   WD_NAMES[dayIdx],
              isRestDay: !sessionId,
              dayName:   sess?.name || '',
              focusArea: '',
              exercises: sess?.exercises || [],
              sessionId: sessionId,
            };
          })
        );

        // Compute daysPerWeek from first week
        const firstWeekTraining = (weekDays[0] || []).filter(d => !d.isRestDay).length;

        return {
          ...phase,
          weekDays,
          days: weekDays[0] || [], // backward compat for TrainingPage
          daysPerWeek: firstWeekTraining,
        };
      });

      // Compute overall daysPerWeek from first phase's first week
      const computedDaysPerWeek = resolvedPhases[0]?.daysPerWeek || data.daysPerWeek;
      const days = resolvedPhases[0]?.days || [];

      await onSave({
        ...data,
        daysPerWeek: computedDaysPerWeek,
        days,
        phases: resolvedPhases,
        durationWeeks,
        id: initial?.id,
      });
      onClose();
    } catch(e) { setError(e.message); setSaving(false); }
  };

  const isWideStep = step === 4; // Exercises step needs more width

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'12px' }}>
      <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%',
        maxWidth: isWideStep ? '720px' : '540px',
        maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden',
        transition:'max-width 0.3s' }}>

        {/* Header */}
        <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
          display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
          <div>
            <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'16px' }}>
              {isEdit ? 'Edit Program' : 'Create Program'}
            </div>
            <div style={{ display:'flex', gap:'4px', marginTop:'8px', flexWrap:'wrap' }}>
              {STEP_LABELS.map((label, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:'3px' }}>
                  <div style={{ width:'20px', height:'20px', borderRadius:'50%',
                    background: i < step ? '#22c55e' : i === step ? '#f97316' : 'rgba(255,255,255,0.08)',
                    color: i <= step ? '#fff' : '#64748b',
                    fontSize:'10px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span style={{ color: i === step ? '#f97316' : i < step ? '#22c55e' : '#475569',
                    fontSize:'11px', fontWeight: i === step ? 600 : 400 }}>{label}</span>
                  {i < STEP_LABELS.length - 1 && <span style={{ color:'#334155', margin:'0 1px' }}>›</span>}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#64748b',
            fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: step === 4 ? 'hidden' : 'auto', flex:1, padding:'20px' }}>
          {step === 0 && <StepDetails data={data} onChange={updateData} />}
          {step === 1 && <StepDefinePhases phases={phases} onPhasesChange={setPhases} />}
          {step === 2 && <StepSessions phases={phases} onPhasesChange={setPhases} />}
          {step === 3 && <StepSchedule phases={phases} onPhasesChange={setPhases} />}
          {step === 4 && <StepExercises phases={phases} onPhasesChange={setPhases} allExercises={allExercises} />}
          {error && (
            <div style={{ marginTop:'12px', background:'rgba(239,68,68,0.1)',
              border:'1px solid rgba(239,68,68,0.3)', borderRadius:'8px',
              padding:'10px 12px', color:'#fca5a5', fontSize:'13px' }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
          display:'flex', gap:'10px', flexShrink:0 }}>
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

export { parsePhasesFromProgram, CreateProgramModal, generateId, initPhase, initPhases, totalProgramWeeks, migratePhaseLegacy };
