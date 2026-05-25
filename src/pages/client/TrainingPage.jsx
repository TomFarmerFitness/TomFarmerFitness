import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { readSheet, appendToSheet } from '../../utils/sheets';

// ─── Constants ────────────────────────────────────────────────────────────────
const SORE_MUSCLES = ['Chest','Back','Shoulders','Arms','Legs','Glutes','Core','None'];
const FEELINGS     = ['Great','Good','Average','Tired but here','Not great'];
const DAY_NAMES    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MUSCLE_COLORS = { Chest:'#3b82f6', Back:'#8b5cf6', Shoulders:'#f59e0b',
  Arms:'#ec4899', Legs:'#22c55e', Glutes:'#f97316', Core:'#14b8a6', None:'#64748b' };
const DEFAULT_SCHEDULES = {
  1:[0], 2:[0,3], 3:[0,2,4], 4:[0,1,3,4],
  5:[0,1,2,3,4], 6:[0,1,2,3,4,5], 7:[0,1,2,3,4,5,6],
};
const DOW_MAP = { Monday:0,Tuesday:1,Wednesday:2,Thursday:3,Friday:4,Saturday:5,Sunday:6 };

// ─── Utilities ────────────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDays() {
  const today = new Date();
  const dow   = today.getDay();
  const mon   = new Date(today);
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0,0,0,0);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(mon); d.setDate(mon.getDate()+i);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { date: iso, dayName: DAY_NAMES[i], dateNum: d.getDate(),
             isToday: d.toDateString() === today.toDateString() };
  });
}

function getSessionForDay(sessions, weekIdx, daysPerWeek) {
  const byDow = sessions.find(s => s.DayOfWeek && DOW_MAP[s.DayOfWeek] === weekIdx);
  if (byDow) return byDow;
  const schedule = DEFAULT_SCHEDULES[Math.min(Math.max(parseInt(daysPerWeek)||3,1),7)] || DEFAULT_SCHEDULES[3];
  const pos = schedule.indexOf(weekIdx);
  if (pos === -1) return null;
  return [...sessions].sort((a,b)=>(parseInt(a.DayOrder)||0)-(parseInt(b.DayOrder)||0))[pos] || null;
}

function getAdjustments(data, exercises) {
  const adj = [];
  if (data.energyLevel < 4 && data.sleepQuality < 4) {
    adj.push({ type:'recovery',
      msg:'Tough day — we have adjusted today session to a recovery version. Lighter weights, same movements.' });
  }
  if (data.hasInjury && data.injuryNotes) {
    adj.push({ type:'injury',
      msg:'We have flagged this for your coach. For today, skip any exercises that affect the injured area.' });
  }
  if (data.sorenessLevel >= 8 && data.soreMuscles.length > 0 && !data.soreMuscles.includes('None')) {
    const exMuscles = exercises.map(e => (e.muscleGroup||'').toLowerCase());
    data.soreMuscles.forEach(m => {
      if (exMuscles.includes(m.toLowerCase())) {
        adj.push({ type:'soreness', muscle:m,
          msg:`High soreness detected on ${m}. Consider reducing load or substituting.` });
      }
    });
  }
  return adj;
}

function computeWeekStats(workoutLogs, weekDays) {
  const weekDates = new Set(weekDays.map(d => d.date));
  const weekLogs  = workoutLogs.filter(l => weekDates.has((l.Date||'').slice(0,10)) && l.Status==='Completed');
  let totalSets=0, totalReps=0, totalVolume=0;
  weekLogs.forEach(log => {
    try {
      const exs = JSON.parse(log.ExercisesCompleted||'[]');
      if (Array.isArray(exs)) {
        exs.forEach(ex => {
          (ex.sets||[]).forEach(s => {
            totalSets++;
            const r = parseFloat(s.reps)||0;
            const w = parseFloat(s.weight)||0;
            totalReps   += r;
            totalVolume += r * w;
          });
        });
      }
    } catch {}
  });
  return { totalSets, totalReps, totalVolume: Math.round(totalVolume), completedCount: weekLogs.length };
}

// ─── Reusable UI helpers ──────────────────────────────────────────────────────
function SliderInput({ label, value, onChange }) {
  const color = value <= 3 ? '#ef4444' : value <= 6 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{marginBottom:'20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
        <label style={{fontSize:'13px',fontWeight:'600',color:'#cbd5e1'}}>{label}</label>
        <span style={{fontSize:'15px',fontWeight:'800',color}}>{value}<span style={{fontSize:'11px',color:'#475569',fontWeight:'500'}}>/10</span></span>
      </div>
      <input type="range" min="1" max="10" value={value}
        onChange={e=>onChange(parseInt(e.target.value))}
        style={{width:'100%',accentColor:color,height:'4px'}}
      />
      <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'#475569',marginTop:'3px'}}>
        <span>Low</span><span>High</span>
      </div>
    </div>
  );
}

function PillToggle({ options, selected, multi=false, onChange }) {
  const isSelected = o => Array.isArray(selected) ? selected.includes(o) : selected === o;
  const handleClick = o => {
    if (!multi) { onChange(o); return; }
    if (o === 'None') { onChange(['None']); return; }
    const next = selected.includes(o)
      ? selected.filter(x=>x!==o)
      : [...selected.filter(x=>x!=='None'), o];
    onChange(next.length ? next : ['None']);
  };
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:'7px'}}>
      {options.map(o => (
        <button key={o} onClick={()=>handleClick(o)} style={{
          padding:'7px 13px', borderRadius:'20px',fontSize:'12px',fontWeight:'600',
          border: isSelected(o) ? '1.5px solid #f97316' : '1.5px solid rgba(255,255,255,0.1)',
          background: isSelected(o) ? 'rgba(249,115,22,0.15)' : 'transparent',
          color: isSelected(o) ? '#f97316' : '#64748b',
          cursor:'pointer', transition:'all 0.12s',
        }}>{o}</button>
      ))}
    </div>
  );
}

// ─── Status icon ─────────────────────────────────────────────────────────────
function StatusDot({ status, pulse=false }) {
  const configs = {
    completed: { bg:'#22c55e', content:'✓', textColor:'#fff' },
    missed:    { bg:'rgba(239,68,68,0.2)', content:'×', textColor:'#ef4444' },
    today:     { bg:'#f97316', content:'', textColor:'#fff' },
    upcoming:  { bg:'rgba(255,255,255,0.08)', content:'', textColor:'#475569' },
    rest:      { bg:'rgba(255,255,255,0.05)', content:'🌙', textColor:'#334155' },
  };
  const c = configs[status] || configs.upcoming;
  return (
    <div style={{
      width:'18px',height:'18px',borderRadius:'50%',
      background:c.bg, color:c.textColor,
      display:'flex',alignItems:'center',justifyContent:'center',
      fontSize:'9px',fontWeight:'800',
      animation: pulse && status==='today' ? 'todayPulse 2s ease-in-out infinite' : 'none',
    }}>{c.content}</div>
  );
}

// ─── Week strip ───────────────────────────────────────────────────────────────
function WeekStrip({ weekDays, selectedDate, sessions, workoutLogs, daysPerWeek, onSelect }) {
  return (
    <div style={{
      display:'flex',gap:'5px',overflowX:'auto',marginBottom:'14px',
      padding:'2px 2px 6px', scrollbarWidth:'none',
    }}>
      <style>{`div::-webkit-scrollbar{display:none}`}</style>
      {weekDays.map((day, i) => {
        const session    = getSessionForDay(sessions, i, daysPerWeek);
        const log        = workoutLogs.find(l=>(l.Date||'').slice(0,10)===day.date);
        const isTraining = !!session;
        const isSelected = day.date === selectedDate;
        let status = 'rest';
        if (isTraining) {
          if (log?.Status==='Completed') status='completed';
          else if (day.isToday) status='today';
          else if (new Date(day.date) < new Date(todayISO())) status='missed';
          else status='upcoming';
        }
        return (
          <button key={day.date} onClick={()=>onSelect(day.date, session)} style={{
            flexShrink:0, width:'48px',
            padding:'8px 4px', borderRadius:'12px',
            border: isSelected ? '1.5px solid #f97316' : '1.5px solid rgba(255,255,255,0.06)',
            background: isSelected ? 'rgba(249,115,22,0.12)' : day.isToday ? 'rgba(255,255,255,0.04)' : 'transparent',
            cursor:'pointer', display:'flex',flexDirection:'column',
            alignItems:'center', gap:'5px',
          }}>
            <span style={{fontSize:'10px',fontWeight:'700',
              color: day.isToday ? '#f97316' : '#64748b',
              textTransform:'uppercase',letterSpacing:'0.3px'}}>{day.dayName}</span>
            <span style={{fontSize:'15px',fontWeight:'800',
              color: isSelected ? '#f8fafc' : day.isToday ? '#f97316' : '#475569'}}>{day.dateNum}</span>
            <StatusDot status={status} pulse={day.isToday} />
            {isTraining && session?.SessionName && (
              <span style={{fontSize:'8px',color:'#475569',textAlign:'center',lineHeight:1.2,
                maxWidth:'44px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                padding:'0 2px'}}>
                {session.SessionName}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Pre-Workout Form (full-screen sub-view) ──────────────────────────────────
function PreWorkoutForm({ session, onSubmit, onCancel }) {
  const [energy,    setEnergy]    = useState(7);
  const [sleep,     setSleep]     = useState(7);
  const [hasInjury, setHasInjury] = useState(false);
  const [injuryNotes,setInjuryNotes]=useState('');
  const [soreMuscles,setSoreMuscles]=useState(['None']);
  const [sorenessLevel,setSorenessLevel]=useState(5);
  const [feeling,   setFeeling]   = useState('Good');
  const [submitting,setSubmitting]=useState(false);

  const hasSoreness = !soreMuscles.includes('None') && soreMuscles.length > 0;

  const handleSubmit = () => {
    setSubmitting(true);
    onSubmit({ energyLevel:energy, sleepQuality:sleep, hasInjury,
      injuryNotes, soreMuscles, sorenessLevel: hasSoreness ? sorenessLevel : 0,
      feeling });
  };

  return (
    <div style={{padding:'20px 16px 100px',fontFamily:"'Inter', system-ui, sans-serif",color:'#f8fafc'}}>
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'24px'}}>
        <button onClick={onCancel} style={{
          background:'rgba(255,255,255,0.06)',border:'none',borderRadius:'8px',
          color:'#94a3b8',fontSize:'13px',fontWeight:'600',padding:'8px 12px',cursor:'pointer',
        }}>← Back</button>
        <div>
          <div style={{fontSize:'11px',color:'#475569',fontWeight:'700',textTransform:'uppercase',letterSpacing:'1px'}}>Pre-Workout</div>
          <div style={{fontSize:'18px',fontWeight:'800'}}>{session?.SessionName || 'Check-In'}</div>
        </div>
      </div>

      {/* Energy */}
      <div style={{background:'#1e293b',borderRadius:'14px',padding:'16px 18px',marginBottom:'10px',border:'1px solid rgba(255,255,255,0.06)'}}>
        <SliderInput label="⚡ Energy level today" value={energy} onChange={setEnergy} />
        <SliderInput label="😴 Sleep quality last night" value={sleep} onChange={setSleep} />
      </div>

      {/* Injury */}
      <div style={{background:'#1e293b',borderRadius:'14px',padding:'16px 18px',marginBottom:'10px',border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:'13px',fontWeight:'700',color:'#f8fafc',marginBottom:'12px'}}>Any pain or injury today?</div>
        <div style={{display:'flex',gap:'8px',marginBottom: hasInjury ? '12px' : '0'}}>
          {['No','Yes'].map(opt => (
            <button key={opt} onClick={()=>setHasInjury(opt==='Yes')} style={{
              flex:1,padding:'10px',borderRadius:'10px',fontSize:'13px',fontWeight:'700',
              border: (hasInjury ? opt==='Yes' : opt==='No')
                ? '1.5px solid #f97316'
                : '1.5px solid rgba(255,255,255,0.08)',
              background: (hasInjury ? opt==='Yes' : opt==='No')
                ? 'rgba(249,115,22,0.12)' : 'transparent',
              color: (hasInjury ? opt==='Yes' : opt==='No') ? '#f97316' : '#64748b',
              cursor:'pointer',
            }}>{opt}</button>
          ))}
        </div>
        {hasInjury && (
          <textarea
            placeholder="Describe the pain or injury..."
            value={injuryNotes}
            onChange={e=>setInjuryNotes(e.target.value)}
            rows={3}
            style={{
              width:'100%',padding:'11px 13px',background:'#0f172a',
              border:'1px solid rgba(249,115,22,0.3)',borderRadius:'10px',
              color:'#f8fafc',fontSize:'14px',outline:'none',resize:'none',
              fontFamily:"'Inter', system-ui, sans-serif",lineHeight:1.5,
            }}
          />
        )}
      </div>

      {/* Sore muscles */}
      <div style={{background:'#1e293b',borderRadius:'14px',padding:'16px 18px',marginBottom:'10px',border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:'13px',fontWeight:'700',color:'#f8fafc',marginBottom:'10px'}}>Sore muscles right now</div>
        <PillToggle options={SORE_MUSCLES} selected={soreMuscles} multi onChange={setSoreMuscles} />
        {hasSoreness && (
          <div style={{marginTop:'16px'}}>
            <SliderInput label="Soreness level" value={sorenessLevel} onChange={setSorenessLevel} />
            {sorenessLevel >= 8 && (
              <div style={{
                background:'rgba(249,115,22,0.1)',border:'1px solid rgba(249,115,22,0.2)',
                borderRadius:'8px',padding:'10px 12px',
                fontSize:'12px',color:'#fbbf24',lineHeight:1.5,
              }}>
                ⚠️ High soreness noted. We will flag if today's workout targets these muscles.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overall feeling */}
      <div style={{background:'#1e293b',borderRadius:'14px',padding:'16px 18px',marginBottom:'16px',border:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{fontSize:'13px',fontWeight:'700',color:'#f8fafc',marginBottom:'10px'}}>How are you feeling going into this session?</div>
        <PillToggle options={FEELINGS} selected={feeling} onChange={setFeeling} />
      </div>

      <button onClick={handleSubmit} disabled={submitting} style={{
        width:'100%',padding:'15px',
        background: submitting ? 'rgba(249,115,22,0.4)' : '#f97316',
        border:'none',borderRadius:'13px',color:'#fff',
        fontSize:'15px',fontWeight:'800',cursor: submitting ? 'not-allowed' : 'pointer',
        display:'flex',alignItems:'center',justifyContent:'center',gap:'8px',
      }}>
        {submitting ? 'Processing…' : (
          <>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Start Workout
          </>
        )}
      </button>
    </div>
  );
}

// ─── Exercise card (used in ActiveWorkout) ────────────────────────────────────
function ExerciseCard({ exercise, sets, onUpdateSet, isFlagged, soreWarning, compact=false }) {
  const allDone = sets.every(s=>s.done);
  const doneSets = sets.filter(s=>s.done).length;
  const borderColor = isFlagged ? 'rgba(251,191,36,0.35)' : allDone ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)';
  const mcColor = MUSCLE_COLORS[exercise.muscleGroup] || '#64748b';

  return (
    <div style={{
      background: allDone ? 'rgba(34,197,94,0.05)' : isFlagged ? 'rgba(251,191,36,0.04)' : '#1e293b',
      borderRadius:'14px', padding:'14px 16px', marginBottom:'10px',
      border:`1px solid ${borderColor}`,
      transition:'border-color 0.25s,background 0.25s',
    }}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:'10px'}}>
        <div>
          <div style={{fontSize:'14px',fontWeight:'800',color:'#f8fafc',marginBottom:'3px'}}>{exercise.name}</div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            {exercise.muscleGroup && (
              <span style={{
                fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'5px',
                background:`${mcColor}1a`,color:mcColor,border:`1px solid ${mcColor}33`,
              }}>{exercise.muscleGroup}</span>
            )}
            <span style={{fontSize:'11px',color:'#475569'}}>
              {exercise.sets} sets × {exercise.reps} reps{exercise.weight ? ` @ ${exercise.weight}kg` : ''}
            </span>
          </div>
        </div>
        <div style={{
          fontSize:'11px',fontWeight:'700',
          color: allDone ? '#22c55e' : '#475569',
          background: allDone ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
          padding:'4px 8px',borderRadius:'6px',flexShrink:0,
        }}>{doneSets}/{sets.length}</div>
      </div>

      {/* Warnings */}
      {isFlagged && (
        <div style={{background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.25)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#fbbf24',marginBottom:'10px'}}>
          ⚠️ Injury flagged — consider skipping or modifying this exercise
        </div>
      )}
      {soreWarning && (
        <div style={{background:'rgba(251,191,36,0.07)',border:'1px solid rgba(251,191,36,0.18)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#f59e0b',marginBottom:'10px'}}>
          🔥 High soreness on {exercise.muscleGroup} — consider reducing load
        </div>
      )}

      {/* Set rows */}
      {!compact && sets.map((s, idx) => (
        <div key={idx} style={{
          display:'flex',alignItems:'center',gap:'8px',
          padding:'8px 0',
          borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          opacity: s.done ? 0.7 : 1,
        }}>
          <span style={{
            width:'52px',fontSize:'11px',fontWeight:'700',
            color: s.done ? '#22c55e' : '#475569',flexShrink:0,
          }}>Set {idx+1}</span>

          <div style={{flex:1,display:'flex',gap:'6px'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:'9px',color:'#475569',marginBottom:'3px',textAlign:'center',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.4px'}}>Reps</div>
              <input
                type="number" inputMode="numeric" value={s.reps}
                onChange={e=>onUpdateSet(idx,{...s,reps:e.target.value})}
                disabled={s.done}
                style={{
                  width:'100%',padding:'8px 6px',textAlign:'center',
                  background: s.done ? 'rgba(34,197,94,0.07)' : '#0f172a',
                  border:`1px solid ${s.done ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.09)'}`,
                  borderRadius:'8px',color:'#f8fafc',fontSize:'14px',fontWeight:'700',outline:'none',
                }}
              />
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:'9px',color:'#475569',marginBottom:'3px',textAlign:'center',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.4px'}}>Weight kg</div>
              <input
                type="number" inputMode="decimal" value={s.weight}
                onChange={e=>onUpdateSet(idx,{...s,weight:e.target.value})}
                disabled={s.done}
                style={{
                  width:'100%',padding:'8px 6px',textAlign:'center',
                  background: s.done ? 'rgba(34,197,94,0.07)' : '#0f172a',
                  border:`1px solid ${s.done ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.09)'}`,
                  borderRadius:'8px',color:'#f8fafc',fontSize:'14px',fontWeight:'700',outline:'none',
                }}
              />
            </div>
          </div>

          <button
            onClick={()=>onUpdateSet(idx,{...s,done:!s.done})}
            style={{
              width:'36px',height:'36px',borderRadius:'9px',flexShrink:0,
              background: s.done ? '#22c55e' : 'rgba(255,255,255,0.06)',
              border:'none',color: s.done ? '#fff' : '#475569',
              fontSize:'14px',fontWeight:'800',cursor:'pointer',
              transition:'all 0.15s',
            }}>{s.done ? '✓' : '○'}</button>
        </div>
      ))}
    </div>
  );
}

// ─── Active Workout view ──────────────────────────────────────────────────────
function ActiveWorkout({ session, exercises, sets, adjustments, preData,
  onUpdateSet, onAddExercise, onComplete, onCancel, saving }) {

  const [showAddEx,   setShowAddEx]  = useState(false);
  const [newEx,       setNewEx]      = useState({name:'',sets:'3',reps:'10',weight:'',muscleGroup:''});
  const [confirmDone, setConfirmDone]= useState(false);

  const totalSetsPlanned = exercises.reduce((n,ex)=>(sets[ex.name]||[]).length+n, 0);
  const totalSetsDone    = Object.values(sets).flat().filter(s=>s.done).length;
  const pct = totalSetsPlanned > 0 ? Math.round((totalSetsDone/totalSetsPlanned)*100) : 0;

  const injuredMuscles = adjustments.filter(a=>a.type==='injury').length > 0
    ? (preData?.injuryNotes||'').toLowerCase() : '';
  const sorenessMuscles = adjustments
    .filter(a=>a.type==='soreness').map(a=>a.muscle.toLowerCase());

  const handleComplete = () => {
    if (pct < 80) { setConfirmDone(true); return; }
    onComplete();
  };

  return (
    <div style={{padding:'16px 16px 120px',fontFamily:"'Inter', system-ui, sans-serif",color:'#f8fafc'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'16px'}}>
        <button onClick={onCancel} style={{
          background:'rgba(255,255,255,0.06)',border:'none',borderRadius:'8px',
          color:'#94a3b8',fontSize:'13px',fontWeight:'600',padding:'8px 12px',cursor:'pointer',
        }}>← Back</button>
        <div style={{flex:1}}>
          <div style={{fontSize:'11px',color:'#f97316',fontWeight:'700',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'2px'}}>Active Workout</div>
          <div style={{fontSize:'17px',fontWeight:'800'}}>{session?.SessionName || 'Workout'}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'18px',fontWeight:'800',color: pct===100 ? '#22c55e' : '#f97316'}}>{pct}%</div>
          <div style={{fontSize:'10px',color:'#475569'}}>{totalSetsDone}/{totalSetsPlanned} sets</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{height:'4px',background:'rgba(255,255,255,0.07)',borderRadius:'2px',marginBottom:'16px',overflow:'hidden'}}>
        <div style={{
          height:'100%',width:`${pct}%`,
          background: pct===100 ? '#22c55e' : '#f97316',
          borderRadius:'2px',transition:'width 0.4s ease',
        }}/>
      </div>

      {/* Adjustment banners */}
      {adjustments.map((adj,i) => (
        <div key={i} style={{
          padding:'12px 14px',borderRadius:'10px',marginBottom:'10px',fontSize:'13px',lineHeight:1.45,
          background: adj.type==='recovery' ? 'rgba(59,130,246,0.1)' : adj.type==='injury' ? 'rgba(251,191,36,0.1)' : 'rgba(249,115,22,0.1)',
          border: adj.type==='recovery' ? '1px solid rgba(59,130,246,0.25)' : adj.type==='injury' ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(249,115,22,0.2)',
          color: adj.type==='recovery' ? '#93c5fd' : adj.type==='injury' ? '#fbbf24' : '#fdba74',
        }}>
          {adj.type==='recovery' ? '💙' : adj.type==='injury' ? '⚠️' : '🔥'} {adj.msg}
        </div>
      ))}

      {/* Exercise cards */}
      {exercises.map(ex => (
        <ExerciseCard key={ex.name}
          exercise={ex}
          sets={sets[ex.name]||[]}
          onUpdateSet={(idx,s)=>onUpdateSet(ex.name,idx,s)}
          isFlagged={!!(injuredMuscles && (ex.muscleGroup||'').toLowerCase().includes(injuredMuscles.split(' ')[0]))}
          soreWarning={sorenessMuscles.includes((ex.muscleGroup||'').toLowerCase())}
        />
      ))}

      {/* Add exercise */}
      {showAddEx ? (
        <div style={{background:'#1e293b',borderRadius:'14px',padding:'16px',marginBottom:'12px',border:'1px solid rgba(249,115,22,0.2)'}}>
          <div style={{fontSize:'13px',fontWeight:'700',marginBottom:'12px'}}>Add Exercise</div>
          {[
            {k:'name',      label:'Exercise name',  placeholder:'e.g. Bench Press', type:'text'},
            {k:'sets',      label:'Sets',            placeholder:'3', type:'number'},
            {k:'reps',      label:'Reps per set',    placeholder:'10', type:'number'},
            {k:'weight',    label:'Weight (kg)',     placeholder:'0', type:'number'},
            {k:'muscleGroup',label:'Muscle group',   placeholder:'e.g. Chest', type:'text'},
          ].map(f=>(
            <div key={f.k} style={{marginBottom:'10px'}}>
              <label style={{fontSize:'10px',fontWeight:'700',color:'#64748b',display:'block',marginBottom:'4px',textTransform:'uppercase',letterSpacing:'0.5px'}}>{f.label}</label>
              <input type={f.type} placeholder={f.placeholder} value={newEx[f.k]}
                onChange={e=>setNewEx(p=>({...p,[f.k]:e.target.value}))}
                inputMode={f.type==='number'?'decimal':'text'}
                style={{width:'100%',padding:'9px 12px',background:'#0f172a',border:'1px solid rgba(255,255,255,0.09)',borderRadius:'8px',color:'#f8fafc',fontSize:'13px',outline:'none'}}
              />
            </div>
          ))}
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>{setShowAddEx(false);setNewEx({name:'',sets:'3',reps:'10',weight:'',muscleGroup:''}); }} style={{flex:1,padding:'10px',background:'transparent',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'9px',color:'#64748b',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
            <button onClick={()=>{
              if(!newEx.name.trim())return;
              onAddExercise({
                name:newEx.name.trim(),
                sets:parseInt(newEx.sets)||3,
                reps:parseInt(newEx.reps)||10,
                weight:parseFloat(newEx.weight)||0,
                muscleGroup:newEx.muscleGroup.trim(),
              });
              setShowAddEx(false);
              setNewEx({name:'',sets:'3',reps:'10',weight:'',muscleGroup:''});
            }} style={{flex:2,padding:'10px',background:'#f97316',border:'none',borderRadius:'9px',color:'#fff',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Add</button>
          </div>
        </div>
      ) : (
        <button onClick={()=>setShowAddEx(true)} style={{
          width:'100%',padding:'12px',marginBottom:'12px',
          background:'transparent',border:'1.5px dashed rgba(255,255,255,0.12)',
          borderRadius:'12px',color:'#475569',fontSize:'13px',fontWeight:'600',cursor:'pointer',
        }}>+ Add Exercise</button>
      )}

      {/* Confirm incomplete */}
      {confirmDone && (
        <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:'12px',padding:'14px 16px',marginBottom:'12px'}}>
          <div style={{fontSize:'13px',color:'#fca5a5',fontWeight:'600',marginBottom:'10px'}}>
            Only {pct}% of sets completed. Finish anyway?
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={()=>setConfirmDone(false)} style={{flex:1,padding:'9px',background:'transparent',border:'1px solid rgba(255,255,255,0.1)',borderRadius:'8px',color:'#64748b',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Keep going</button>
            <button onClick={onComplete} style={{flex:1,padding:'9px',background:'#f97316',border:'none',borderRadius:'8px',color:'#fff',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>Finish anyway</button>
          </div>
        </div>
      )}

      {/* Complete button */}
      <button onClick={handleComplete} disabled={saving} style={{
        position:'fixed',bottom:'74px',
        left:'50%',transform:'translateX(-50%)',
        width:'calc(100% - 32px)',maxWidth:'398px',
        padding:'15px',background: saving ? 'rgba(249,115,22,0.4)' : '#f97316',
        border:'none',borderRadius:'13px',color:'#fff',
        fontSize:'15px',fontWeight:'800',cursor: saving ? 'not-allowed' : 'pointer',
        zIndex:50, boxShadow:'0 8px 24px rgba(249,115,22,0.35)',
      }}>
        {saving ? 'Saving workout…' : 'Complete Workout ✓'}
      </button>
    </div>
  );
}

// ─── Weekly stats ─────────────────────────────────────────────────────────────
function WeekStats({ stats, scheduledCount, completedCount }) {
  const rate = scheduledCount > 0 ? Math.round((completedCount/scheduledCount)*100) : 0;
  return (
    <div style={{background:'#1e293b',borderRadius:'16px',padding:'16px 20px',marginBottom:'8px',border:'1px solid rgba(255,255,255,0.06)'}}>
      <div style={{fontSize:'11px',fontWeight:'700',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:'14px'}}>This Week</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'14px'}}>
        {[
          {label:'Total Sets',  value: stats.totalSets,     unit:''},
          {label:'Total Reps',  value: stats.totalReps,     unit:''},
          {label:'Volume',      value: stats.totalVolume,   unit:'kg'},
        ].map(s=>(
          <div key={s.label} style={{textAlign:'center'}}>
            <div style={{fontSize:'22px',fontWeight:'800',color:'#f8fafc',lineHeight:1}}>{s.value.toLocaleString()}<span style={{fontSize:'11px',fontWeight:'500',color:'#475569'}}>{s.unit}</span></div>
            <div style={{fontSize:'10px',color:'#475569',fontWeight:'600',marginTop:'3px',textTransform:'uppercase',letterSpacing:'0.5px'}}>{s.label}</div>
          </div>
        ))}
      </div>
      <div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'5px'}}>
          <span style={{fontSize:'11px',fontWeight:'600',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.5px'}}>Completion rate</span>
          <span style={{fontSize:'12px',fontWeight:'800',color: rate>=80?'#22c55e':rate>=50?'#f59e0b':'#f97316'}}>{completedCount}/{scheduledCount} sessions · {rate}%</span>
        </div>
        <div style={{height:'6px',background:'rgba(255,255,255,0.07)',borderRadius:'3px',overflow:'hidden'}}>
          <div style={{
            height:'100%',width:`${rate}%`,borderRadius:'3px',
            background: rate>=80?'#22c55e':rate>=50?'#f59e0b':'#f97316',
            transition:'width 0.8s ease',
          }}/>
        </div>
      </div>
    </div>
  );
}

// ─── Workout day card (weekly view) ──────────────────────────────────────────
function WorkoutDayCard({ session, log, date, actualDate, onActualDateChange, onStart, onEdit, daysPerWeek }) {
  const isCompleted = log?.Status === 'Completed';
  const isToday = date === todayISO();
  const isPast  = new Date(date) < new Date(todayISO());
  let exercises = [];
  try { exercises = JSON.parse(session?.Exercises || '[]'); } catch {}
  let loggedExercises = [];
  try {
    const raw = log?.ExercisesCompleted;
    if (raw && raw.startsWith('[')) loggedExercises = JSON.parse(raw);
  } catch {}

  if (!session) {
    return (
      <div style={{background:'#1e293b',borderRadius:'16px',padding:'20px',border:'1px solid rgba(255,255,255,0.06)',textAlign:'center'}}>
        <div style={{fontSize:'24px',marginBottom:'8px'}}>🌙</div>
        <div style={{fontSize:'15px',fontWeight:'700',color:'#f8fafc',marginBottom:'4px'}}>Rest Day</div>
        <div style={{fontSize:'13px',color:'#475569'}}>Recovery is part of the plan.</div>
      </div>
    );
  }

  return (
    <div style={{background:'#1e293b',borderRadius:'16px',padding:'18px 20px',border:`1px solid ${isCompleted?'rgba(34,197,94,0.2)':'rgba(255,255,255,0.06)'}`}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'14px'}}>
        <div>
          <div style={{fontSize:'11px',color:'#f97316',fontWeight:'700',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'3px'}}>
            {isCompleted ? 'Completed' : isToday ? 'Today' : isPast ? 'Missed' : 'Upcoming'}
          </div>
          <div style={{fontSize:'18px',fontWeight:'800',color:'#f8fafc',marginBottom:'3px'}}>{session.SessionName || 'Workout'}</div>
          {session.FocusArea && <div style={{fontSize:'12px',color:'#64748b'}}>{session.FocusArea}</div>}
        </div>
        <div style={{
          width:'40px',height:'40px',borderRadius:'10px',flexShrink:0,
          background: isCompleted ? 'rgba(34,197,94,0.12)' : 'rgba(249,115,22,0.1)',
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',
        }}>{isCompleted ? '✅' : '🏋️'}</div>
      </div>

      {/* Date selector */}
      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px',padding:'9px 12px',background:'rgba(255,255,255,0.03)',borderRadius:'9px',border:'1px solid rgba(255,255,255,0.06)'}}>
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#64748b" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span style={{fontSize:'12px',color:'#64748b',fontWeight:'600'}}>Trained on:</span>
        <input type="date" value={actualDate}
          onChange={e=>onActualDateChange(e.target.value)}
          style={{background:'transparent',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'700',outline:'none',cursor:'pointer'}}
        />
      </div>

      {/* Exercise preview / logged entries */}
      {(isCompleted ? loggedExercises : exercises).length > 0 && (
        <div style={{marginBottom:'14px'}}>
          {(isCompleted ? loggedExercises : exercises).slice(0,4).map((ex,i)=>(
            <div key={i} style={{
              display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{fontSize:'13px',color:'#e2e8f0',fontWeight:'600'}}>{ex.name}</span>
              <span style={{fontSize:'12px',color:'#475569'}}>
                {isCompleted
                  ? `${(ex.sets||[]).filter(s=>s.done).length}/${(ex.sets||[]).length} sets`
                  : `${ex.sets}×${ex.reps}${ex.weight ? ` @ ${ex.weight}kg` : ''}`
                }
              </span>
            </div>
          ))}
          {(isCompleted ? loggedExercises : exercises).length > 4 && (
            <div style={{fontSize:'12px',color:'#475569',paddingTop:'6px'}}>
              +{(isCompleted ? loggedExercises : exercises).length - 4} more exercises
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      {isCompleted ? (
        <button onClick={onEdit} style={{
          width:'100%',padding:'12px',background:'transparent',
          border:'1.5px solid rgba(34,197,94,0.3)',borderRadius:'11px',
          color:'#22c55e',fontSize:'14px',fontWeight:'700',cursor:'pointer',
        }}>Edit Entries</button>
      ) : (
        <button onClick={onStart} style={{
          width:'100%',padding:'13px',background:'#f97316',border:'none',
          borderRadius:'11px',color:'#fff',fontSize:'14px',fontWeight:'700',cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',gap:'7px',
        }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Start Workout
        </button>
      )}
    </div>
  );
}

// ─── Main TrainingPage ─────────────────────────────────────────────────────────
export default function TrainingPage() {
  const { user } = useAuth();

  // ── View state: 'weekly' | 'preWorkout' | 'active' ──
  const [view,         setView]         = useState('weekly');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [actualDate,   setActualDate]   = useState(todayISO());
  const [sessions,     setSessions]     = useState([]);
  const [workoutLogs,  setWorkoutLogs]  = useState([]);
  const [clientProfile,setClientProfile]= useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState(null);

  // ── Active workout state ──
  const [preWorkoutData,   setPreWorkoutData]   = useState(null);
  const [adjustments,      setAdjustments]      = useState([]);
  const [activeExercises,  setActiveExercises]  = useState([]);
  const [activeSets,       setActiveSets]       = useState({});
  const [activeSession,    setActiveSession]    = useState(null);

  const weekDays     = getWeekDays();
  const daysPerWeek  = parseInt(clientProfile?.TrainingDaysPerWeek) || 3;

  const fetchData = useCallback(async () => {
    if (!user?.clientID) return;
    setLoading(true); setError(null);
    try {
      const [clients, progs, logs] = await Promise.all([
        readSheet('Clients'), readSheet('WorkoutPrograms'), readSheet('WorkoutLogs'),
      ]);
      const profile = clients.find(c=>c.ClientID===user.clientID) || null;
      setClientProfile(profile);
      // Fetch sessions for this program
      let sessRows = [];
      try { sessRows = await readSheet('WorkoutSessions'); } catch {}
      const mySessions = profile?.ProgramID
        ? sessRows.filter(s=>s.ProgramID===profile.ProgramID)
        : [];
      setSessions(mySessions);
      setWorkoutLogs(logs.filter(l=>l.ClientID===user.clientID));
    } catch { setError('Could not load training data.'); }
    finally { setLoading(false); }
  }, [user?.clientID]);

  useEffect(()=>{ fetchData(); }, [fetchData]);

  // Derived
  const selectedDayIdx   = weekDays.findIndex(d=>d.date===selectedDate);
  const selectedSession  = selectedDayIdx >= 0 ? getSessionForDay(sessions, selectedDayIdx, daysPerWeek) : null;
  const selectedLog      = workoutLogs.find(l=>(l.Date||'').slice(0,10)===selectedDate && l.Status==='Completed');
  const weekStats        = computeWeekStats(workoutLogs, weekDays);
  const scheduledThisWeek= weekDays.filter((_,i)=>!!getSessionForDay(sessions,i,daysPerWeek)).length;

  // Init active sets from exercises
  const initActiveSets = (exs) => {
    const s = {};
    exs.forEach(ex=>{
      s[ex.name] = Array.from({length:ex.sets},()=>({reps:String(ex.reps||''),weight:String(ex.weight||''),done:false}));
    });
    return s;
  };

  // Handle pre-workout form submission
  const handlePreWorkoutSubmit = (data) => {
    setPreWorkoutData(data);
    let exs = [];
    try { exs = JSON.parse(activeSession?.Exercises||'[]'); } catch {}

    // Apply adjustments
    const adjs = getAdjustments(data, exs);

    // Recovery mode: reduce sets by 1
    if (adjs.some(a=>a.type==='recovery')) {
      exs = exs.map(ex=>({...ex, sets: Math.max(1,ex.sets-1)}));
    }

    setAdjustments(adjs);
    setActiveExercises(exs);
    setActiveSets(initActiveSets(exs));
    setView('active');
  };

  const handleStartWorkout = (session) => {
    setActiveSession(session);
    setActualDate(selectedDate);
    setView('preWorkout');
  };

  const handleEditEntries = () => {
    const log = selectedLog;
    let exs = [];
    try {
      const raw = log?.ExercisesCompleted;
      if (raw && raw.startsWith('[')) exs = JSON.parse(raw);
    } catch {}
    setActiveSession(selectedSession);
    setActualDate((log?.Date||selectedDate).slice(0,10));
    setAdjustments([]);
    setPreWorkoutData(null);
    if (exs.length > 0) {
      setActiveExercises(exs);
      // Pre-fill logged sets
      const s = {};
      exs.forEach(ex=>{
        s[ex.name] = (ex.sets||[]).length > 0
          ? ex.sets.map(st=>({...st,done:true}))
          : Array.from({length:ex.sets_count||3},()=>({reps:'',weight:'',done:false}));
      });
      setActiveSets(s);
    } else {
      setActiveExercises([]);
      setActiveSets({});
    }
    setView('active');
  };

  const handleUpdateSet = (exName, idx, newSet) => {
    setActiveSets(prev=>({
      ...prev,
      [exName]: prev[exName].map((s,i)=>i===idx?newSet:s),
    }));
  };

  const handleAddExercise = (ex) => {
    setActiveExercises(prev=>[...prev,ex]);
    setActiveSets(prev=>({
      ...prev,
      [ex.name]: Array.from({length:ex.sets},()=>({reps:String(ex.reps||''),weight:String(ex.weight||''),done:false})),
    }));
  };

  const handleCompleteWorkout = async () => {
    setSaving(true);
    try {
      const logID = `WL_${Date.now()}`;
      const exSummary = activeExercises.map(ex=>({
        name: ex.name, muscleGroup: ex.muscleGroup||'',
        sets: (activeSets[ex.name]||[]),
      }));
      const totalSetsDone = Object.values(activeSets).flat().filter(s=>s.done).length;

      await appendToSheet('WorkoutLogs', {
        LogID: logID, ClientID: user.clientID,
        Date: actualDate,
        ProgramID: clientProfile?.ProgramID || '',
        WorkoutName: activeSession?.SessionName || 'Workout',
        ExercisesCompleted: JSON.stringify(exSummary),
        TotalSets: String(totalSetsDone),
        Duration: '', Status: 'Completed', Notes: '',
        LoggedAt: new Date().toISOString(),
      });

      if (preWorkoutData) {
        try {
          await appendToSheet('PreWorkoutCheckins', {
            CheckinID: `PW_${Date.now()}`, ClientID: user.clientID,
            WorkoutLogID: logID, Date: actualDate,
            EnergyLevel: String(preWorkoutData.energyLevel),
            SleepQuality: String(preWorkoutData.sleepQuality),
            HasInjury: preWorkoutData.hasInjury ? 'Yes' : 'No',
            InjuryNotes: preWorkoutData.injuryNotes||'',
            SoreMuscles: (preWorkoutData.soreMuscles||[]).join(', '),
            SorenessLevel: String(preWorkoutData.sorenessLevel||0),
            OverallFeeling: preWorkoutData.feeling||'',
            LoggedAt: new Date().toISOString(),
          });
        } catch {}
      }

      if (preWorkoutData?.hasInjury && preWorkoutData?.injuryNotes) {
        try {
          await appendToSheet('AIQuestions', {
            QuestionID: `Q_${Date.now()}`, ClientID: user.clientID,
            ClientName: user.name||'',
            Question: `[INJURY FLAG] ${preWorkoutData.injuryNotes}`,
            Answer:'', Status:'Flagged',
            AskedAt: new Date().toISOString(), AnsweredAt:'',
          });
        } catch {}
      }

      setView('weekly');
      await fetchData();
    } catch { alert('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  };

  // ── Sub-views ──
  if (view === 'preWorkout') {
    return <PreWorkoutForm session={activeSession} onSubmit={handlePreWorkoutSubmit} onCancel={()=>setView('weekly')} />;
  }
  if (view === 'active') {
    return (
      <ActiveWorkout
        session={activeSession}
        exercises={activeExercises}
        sets={activeSets}
        adjustments={adjustments}
        preData={preWorkoutData}
        onUpdateSet={handleUpdateSet}
        onAddExercise={handleAddExercise}
        onComplete={handleCompleteWorkout}
        onCancel={()=>setView('weekly')}
        saving={saving}
      />
    );
  }

  // ── Weekly view ──
  return (
    <div style={{padding:'20px 16px 24px',fontFamily:"'Inter', system-ui, sans-serif",color:'#f8fafc'}}>
      <style>{`
        @keyframes todayPulse {
          0%,100% { box-shadow:0 0 0 0 rgba(249,115,22,0.6); }
          50%      { box-shadow:0 0 0 6px rgba(249,115,22,0); }
        }
      `}</style>

      <div style={{fontSize:'11px',color:'#475569',fontWeight:'700',textTransform:'uppercase',letterSpacing:'1px',marginBottom:'6px'}}>Training</div>
      <h1 style={{margin:'0 0 16px',fontSize:'24px',fontWeight:'800'}}>This Week</h1>

      {/* Week strip */}
      {loading ? (
        <div style={{height:'88px',background:'#1e293b',borderRadius:'14px',marginBottom:'14px',animation:'skeletonPulse 1.6s infinite'}}/>
      ) : (
        <WeekStrip
          weekDays={weekDays}
          selectedDate={selectedDate}
          sessions={sessions}
          workoutLogs={workoutLogs}
          daysPerWeek={daysPerWeek}
          onSelect={(date, _sess) => {
            setSelectedDate(date);
            setActualDate(date);
          }}
        />
      )}

      {/* Workout card */}
      {loading ? (
        <div style={{height:'180px',background:'#1e293b',borderRadius:'16px',marginBottom:'14px',animation:'skeletonPulse 1.6s infinite'}}/>
      ) : (
        <WorkoutDayCard
          session={selectedSession}
          log={selectedLog}
          date={selectedDate}
          actualDate={actualDate}
          onActualDateChange={setActualDate}
          daysPerWeek={daysPerWeek}
          onStart={()=>handleStartWorkout(selectedSession)}
          onEdit={handleEditEntries}
        />
      )}

      {/* New sheets notice */}
      {!loading && sessions.length === 0 && (
        <div style={{
          background:'rgba(59,130,246,0.07)',border:'1px solid rgba(59,130,246,0.18)',
          borderRadius:'12px',padding:'12px 14px',marginBottom:'12px',
          fontSize:'12px',color:'#93c5fd',lineHeight:1.5,
        }}>
          <strong>Set up workout sessions</strong> — Ask your trainer to add sessions to your program in the <em>WorkoutSessions</em> sheet. Until then, you can still log workouts using the Start Workout button.
        </div>
      )}

      {/* Weekly stats */}
      {!loading && (
        <WeekStats
          stats={weekStats}
          scheduledCount={scheduledThisWeek}
          completedCount={weekStats.completedCount}
        />
      )}

      {error && (
        <div style={{color:'#fca5a5',fontSize:'13px',textAlign:'center',marginTop:'8px'}}>
          {error} <button onClick={fetchData} style={{background:'none',border:'none',color:'#f97316',fontSize:'13px',fontWeight:'700',cursor:'pointer',padding:'0 4px'}}>Retry</button>
        </div>
      )}
    </div>
  );
}
