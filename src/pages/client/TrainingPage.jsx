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

function getSessionForDay(sessions, weekIdx, daysPerWeek, trainingDaysSet) {
  // If specific training days assigned, use those
  if (trainingDaysSet && trainingDaysSet.size > 0) {
    const dayName = DAY_NAMES[weekIdx];
    if (!trainingDaysSet.has(dayName)) return null;
    const orderedDays = DAY_NAMES.filter(d => trainingDaysSet.has(d));
    const pos = orderedDays.indexOf(dayName);
    if (pos === -1) return null;
    return [...sessions].sort((a,b)=>(parseInt(a.DayOrder)||0)-(parseInt(b.DayOrder)||0))[pos] || null;
  }
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

// ─── Injury swap helpers ──────────────────────────────────────────────────────
const INJURY_KEYWORD_MAP = {
  knee:          ['Legs'],
  'lower back':  ['Back', 'Legs'],
  back:          ['Back'],
  shoulder:      ['Shoulders', 'Chest'],
  elbow:         ['Arms'],
  wrist:         ['Arms', 'Chest', 'Shoulders'],
  hip:           ['Glutes', 'Legs'],
  ankle:         ['Legs'],
  neck:          ['Back', 'Shoulders'],
  hamstring:     ['Legs'],
  quad:          ['Legs'],
  calf:          ['Legs'],
  groin:         ['Legs', 'Glutes'],
  pec:           ['Chest'],
  trap:          ['Back', 'Shoulders'],
  rotator:       ['Shoulders'],
};

function swapInjuredExercises(exercises, injuryNotes, allExercises) {
  const lower = injuryNotes.toLowerCase();
  const affected = new Set();
  Object.entries(INJURY_KEYWORD_MAP).forEach(([kw, groups]) => {
    if (lower.includes(kw)) groups.forEach(g => affected.add(g));
  });
  if (affected.size === 0) return exercises;

  return exercises.map(ex => {
    const mg = (ex.muscleGroup || '').trim();
    if (!affected.has(mg)) return ex;
    // Prefer Machine > Cable > Bodyweight as safer alternatives
    const alt = allExercises.find(ae =>
      (ae.PrimaryMuscle || '') === mg &&
      ['Machine', 'Cable', 'Bodyweight'].includes(ae.EquipmentNeeded || '') &&
      (ae.Name || '').toLowerCase() !== (ex.name || '').toLowerCase()
    );
    if (alt) return { ...ex, name: alt.Name, originalName: ex.name, swappedForInjury: true };
    return { ...ex, flaggedForInjury: true };
  });
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

function computeProgression(exercises, completedSets) {
  const updates = [];
  exercises.forEach(ex => {
    const exSets = completedSets[ex.name] || [];
    if (exSets.length === 0) return;
    if (!exSets.every(s => s.done)) return;
    const targetReps = parseInt(String(ex.reps || '0').split('-')[0]) || 0;
    if (targetReps === 0) return;
    if (!exSets.every(s => (parseInt(s.reps) || 0) >= targetReps)) return;
    const currentWeight = parseFloat(ex.weight) || 0;
    const isCompound = /bench|squat|deadlift|row|press|pull|dip|lunge/i.test(ex.name);
    if (currentWeight > 0) {
      const inc = isCompound ? 2.5 : 1.25;
      updates.push({ exerciseName: ex.name, muscleGroup: ex.muscleGroup||'',
        type:'weight', currentWeight, newWeight: Math.round((currentWeight+inc)*100)/100,
        increment: inc, currentReps: ex.reps });
    } else {
      const cr = parseInt(String(ex.reps||'0').split('-')[0]) || 0;
      if (cr > 0) updates.push({ exerciseName: ex.name, muscleGroup: ex.muscleGroup||'',
        type:'reps', currentReps: cr, newReps: cr + 1 });
    }
  });
  return updates;
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
function WeekStrip({ weekDays, selectedDate, sessions, workoutLogs, daysPerWeek, trainingDays, onSelect }) {
  return (
    <div style={{
      display:'flex',gap:'5px',overflowX:'auto',marginBottom:'14px',
      padding:'2px 2px 6px', scrollbarWidth:'none',
    }}>
      <style>{`div::-webkit-scrollbar{display:none}`}</style>
      {weekDays.map((day, i) => {
        const session    = getSessionForDay(sessions, i, daysPerWeek, trainingDays);
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

// ─── Pre-Workout Chat (conversational coach check-in) ─────────────────────────
function PreWorkoutChat({ session, onSubmit, onCancel }) {
  const [messages,    setMessages]    = useState([]);
  const [step,        setStep]        = useState('waiting');
  const [typing,      setTyping]      = useState(false);
  const [energy,      setEnergy]      = useState(null);
  const [sleep,       setSleep]       = useState(null);
  const [soreness,    setSoreness]    = useState(['None']);
  const [injuryInput, setInjuryInput] = useState('');
  const [injuryDesc,  setInjuryDesc]  = useState('');
  const [hasInjury,   setHasInjury]   = useState(null);
  const scrollRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  const addCoach = useCallback((text, nextStep, delay = 650) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages(prev => [...prev, { role: 'coach', text, id: Date.now() + Math.random() }]);
      setStep(nextStep);
    }, delay);
  }, []);

  const addUser = (text) =>
    setMessages(prev => [...prev, { role: 'user', text, id: Date.now() + Math.random() }]);

  // Initial greeting
  useEffect(() => {
    const name = session?.SessionName || 'today\'s session';
    addCoach(
      `Hey! 👋 Ready to crush ${name}? Quick check-in before we start — just a few questions. First up: how's your energy feeling right now?`,
      'energy', 700
    );
  }, []); // eslint-disable-line

  const handleEnergy = (val, label) => {
    setEnergy(val);
    addUser(label);
    setStep('waiting');
    const msg = val >= 4
      ? 'Love the energy! 💪 And how did you sleep last night?'
      : val === 3
        ? 'We can work with that! How did you sleep last night? 😴'
        : 'You showed up — that\'s the hardest part. 🙌 How\'s the sleep been?';
    addCoach(msg, 'sleep');
  };

  const handleSleep = (val, label) => {
    setSleep(val);
    addUser(label);
    setStep('waiting');
    const msg = val >= 4
      ? 'Well rested — great sign. Any muscles feeling tight or sore going in today? 🔥'
      : val === 3
        ? 'Not bad. Any muscles particularly sore right now?'
        : 'Rough night — we\'ll be smart with the intensity. Any muscles particularly sore today?';
    addCoach(msg, 'soreness');
  };

  const handleSorenessSubmit = () => {
    const text = soreness.includes('None') ? 'No soreness, feeling fresh! 💚' : `Sore: ${soreness.join(', ')}`;
    addUser(text);
    setStep('waiting');
    addCoach(
      'Got it. Last one — any pain or niggles right now? Anything that\'s been bothering you that I should know about before we start? ⚠️',
      'injury'
    );
  };

  const handleInjury = (val) => {
    setHasInjury(val);
    addUser(val ? 'Yes, I have something ⚠️' : 'No, feeling good! ✅');
    setStep('waiting');
    if (val) {
      addCoach(
        'Thanks for the heads up. Tell me about it — where is it and what does the pain feel like? The more detail the better so I can adapt the session.',
        'injuryDesc'
      );
    } else {
      buildSummary(false, '');
    }
  };

  const handleInjurySubmit = () => {
    const desc = injuryInput.trim();
    if (!desc) return;
    setInjuryDesc(desc);
    addUser(desc);
    setInjuryInput('');
    setStep('waiting');
    buildSummary(true, desc);
  };

  const buildSummary = (injured, injNotes) => {
    const energyVal = energy || 3;
    const sleepVal  = sleep  || 3;
    const lowEnergy = energyVal <= 2;
    const badSleep  = sleepVal  <= 2;
    const hasSore   = !soreness.includes('None') && soreness.length > 0;

    let msg = '';
    if (lowEnergy || badSleep) {
      msg = 'Alright — today we\'ll keep it smart. I\'ve taken a set or two off the session so you can finish strong without burning out.';
    } else {
      msg = 'Everything\'s looking solid on my end! You\'re primed for a strong session today.';
    }
    if (hasSore) {
      const soreList = soreness.filter(s => s !== 'None');
      msg += ` I\'ll keep an eye on ${soreList.join(' and ')} and flag any exercises hitting those muscles.`;
    }
    if (injured && injNotes) {
      const snippet = injNotes.split(' ').slice(0, 6).join(' ');
      msg += ` I\'ve flagged "${snippet}…" for Tom to review, and I\'ve swapped out any exercises that might aggravate it.`;
    }
    msg += ' Let\'s get after it! 🔥';

    addCoach(msg, 'summary', 900);
  };

  // Soreness chip toggle
  const toggleSoreness = (muscle) => {
    if (muscle === 'None') { setSoreness(['None']); return; }
    setSoreness(prev => {
      const without = prev.filter(x => x !== 'None');
      return without.includes(muscle)
        ? (without.filter(x => x !== muscle).length ? without.filter(x => x !== muscle) : ['None'])
        : [...without, muscle];
    });
  };

  // ── Render input controls by step ──
  const renderInput = () => {
    if (typing || step === 'waiting') return null;

    const emojiScaleBtn = (o, onClick) => (
      <button key={o.val} onClick={() => onClick(o.val, `${o.emoji} ${o.label}`)} style={{
        flex: 1, padding: '11px 4px',
        background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px', color: '#f8fafc', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
        transition: 'border-color 0.12s',
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
      >
        <span style={{ fontSize: '22px' }}>{o.emoji}</span>
        <span style={{ fontSize: '9px', color: '#64748b', fontWeight: '600', textAlign: 'center', lineHeight: 1.2 }}>{o.label}</span>
      </button>
    );

    if (step === 'energy') {
      return (
        <div style={{ display: 'flex', gap: '7px' }}>
          {[
            { val: 1, emoji: '😴', label: 'Very low' },
            { val: 2, emoji: '😑', label: 'Low' },
            { val: 3, emoji: '😐', label: 'Okay' },
            { val: 4, emoji: '💪', label: 'Good' },
            { val: 5, emoji: '⚡', label: 'Great' },
          ].map(o => emojiScaleBtn(o, handleEnergy))}
        </div>
      );
    }

    if (step === 'sleep') {
      return (
        <div style={{ display: 'flex', gap: '7px' }}>
          {[
            { val: 1, emoji: '😵', label: 'Terrible' },
            { val: 2, emoji: '😫', label: 'Poor' },
            { val: 3, emoji: '😐', label: 'Okay' },
            { val: 4, emoji: '😊', label: 'Good' },
            { val: 5, emoji: '🌟', label: 'Great' },
          ].map(o => emojiScaleBtn(o, handleSleep))}
        </div>
      );
    }

    if (step === 'soreness') {
      return (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '10px' }}>
            {SORE_MUSCLES.map(m => {
              const sel = soreness.includes(m);
              return (
                <button key={m} onClick={() => toggleSoreness(m)} style={{
                  padding: '7px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
                  border: sel ? '1.5px solid #f97316' : '1.5px solid rgba(255,255,255,0.1)',
                  background: sel ? 'rgba(249,115,22,0.15)' : 'transparent',
                  color: sel ? '#f97316' : '#64748b', cursor: 'pointer', transition: 'all 0.12s',
                }}>{m}</button>
              );
            })}
          </div>
          <button onClick={handleSorenessSubmit} style={{
            width: '100%', padding: '12px', background: '#f97316', border: 'none',
            borderRadius: '11px', color: '#fff', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
          }}>Done ✓</button>
        </div>
      );
    }

    if (step === 'injury') {
      return (
        <div style={{ display: 'flex', gap: '10px' }}>
          {[
            { label: 'No, all good! ✅', val: false, color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)' },
            { label: 'Yes, I do ⚠️',     val: true,  color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.3)' },
          ].map(o => (
            <button key={String(o.val)} onClick={() => handleInjury(o.val)} style={{
              flex: 1, padding: '13px', background: o.bg,
              border: `1.5px solid ${o.border}`, borderRadius: '12px',
              color: o.color, fontSize: '13px', fontWeight: '700', cursor: 'pointer',
            }}>{o.label}</button>
          ))}
        </div>
      );
    }

    if (step === 'injuryDesc') {
      return (
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={injuryInput}
            onChange={e => setInjuryInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleInjurySubmit(); }}
            placeholder="e.g. Left knee — sharp pain on the way down stairs…"
            style={{
              flex: 1, padding: '12px 14px', background: '#1e293b',
              border: '1.5px solid rgba(249,115,22,0.4)', borderRadius: '12px',
              color: '#f8fafc', fontSize: '14px', outline: 'none',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
            autoFocus
          />
          <button onClick={handleInjurySubmit} style={{
            padding: '12px 16px', background: '#f97316', border: 'none',
            borderRadius: '12px', color: '#fff', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
          }}>→</button>
        </div>
      );
    }

    if (step === 'summary') {
      return (
        <button onClick={() => onSubmit({
          energyLevel:  energy || 3,
          sleepQuality: sleep  || 3,
          hasInjury:    !!hasInjury,
          injuryNotes:  injuryDesc,
          soreMuscles:  soreness.includes('None') ? ['None'] : soreness,
          sorenessLevel: soreness.includes('None') ? 0 : 7,
          feeling: (energy || 3) >= 4 ? 'Good' : (energy || 3) >= 3 ? 'Average' : 'Not great',
        })} style={{
          width: '100%', padding: '15px', background: '#f97316', border: 'none',
          borderRadius: '13px', color: '#fff', fontSize: '15px', fontWeight: '800', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          boxShadow: '0 6px 20px rgba(249,115,22,0.4)',
        }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Let's Go! Start Workout
        </button>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: "'Inter', system-ui, sans-serif", background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <button onClick={onCancel} style={{
          background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px',
          color: '#94a3b8', fontSize: '13px', fontWeight: '600', padding: '8px 12px', cursor: 'pointer',
        }}>← Back</button>
        <div>
          <div style={{ fontSize: '10px', color: '#f97316', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>Pre-Workout</div>
          <div style={{ fontSize: '17px', fontWeight: '800' }}>{session?.SessionName || 'Check-In'}</div>
        </div>
        <div style={{ marginLeft: 'auto', width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(249,115,22,0.15)', border: '2px solid rgba(249,115,22,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>🏋️</div>
      </div>

      {/* Chat area */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <style>{`
          @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
          @keyframes dotBounce { 0%,80%,100% { transform:translateY(0); } 40% { transform:translateY(-6px); } }
        `}</style>

        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            alignItems: 'flex-end', gap: '8px',
            animation: 'fadeUp 0.25s ease',
          }}>
            {msg.role === 'coach' && (
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(249,115,22,0.2)', border: '1.5px solid rgba(249,115,22,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>T</div>
            )}
            <div style={{
              maxWidth: '78%', padding: '11px 14px', borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? '#f97316' : '#1e293b',
              border: msg.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.08)',
              fontSize: '14px', lineHeight: 1.55, color: '#f8fafc',
            }}>{msg.text}</div>
          </div>
        ))}

        {/* Typing indicator */}
        {typing && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', animation: 'fadeUp 0.2s ease' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(249,115,22,0.2)', border: '1.5px solid rgba(249,115,22,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>T</div>
            <div style={{ padding: '12px 16px', background: '#1e293b', borderRadius: '18px 18px 18px 4px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: '4px', alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#475569', display: 'inline-block', animation: `dotBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ padding: '12px 16px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, minHeight: '80px', display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%' }}>
          {renderInput()}
        </div>
      </div>
    </div>
  );
}

// ─── Niggle modal (in-workout injury report) ──────────────────────────────────
const NIGGLE_MUSCLE_MAP = {
  Knee:     ['Legs'],
  Shoulder: ['Shoulders', 'Chest'],
  Back:     ['Back'],
  Hip:      ['Glutes', 'Legs'],
  Elbow:    ['Arms'],
  Wrist:    ['Arms', 'Chest', 'Shoulders'],
  Ankle:    ['Legs'],
  Neck:     ['Back', 'Shoulders'],
};

function NiggleModal({ exercises, onFlag, onClose }) {
  const [nigStep,    setNigStep]    = useState('where');
  const [bodyPart,   setBodyPart]   = useState('');
  const [customTxt,  setCustomTxt]  = useState('');
  const [flaggedExs, setFlaggedExs] = useState([]);

  const PARTS = ['Knee','Shoulder','Back','Hip','Elbow','Wrist','Ankle','Neck'];

  const pickPart = (part) => {
    setBodyPart(part);
    const groups = NIGGLE_MUSCLE_MAP[part] || [];
    setFlaggedExs(groups.length > 0 ? exercises.filter(ex => groups.includes(ex.muscleGroup)) : []);
    setNigStep('severity');
  };

  const handleCustom = () => {
    const p = customTxt.trim();
    if (!p) return;
    setBodyPart(p);
    setFlaggedExs([]);
    setNigStep('severity');
  };

  const handleSeverity = (sev) => {
    onFlag(bodyPart, sev, flaggedExs);
    setNigStep('done');
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(3px)',
    display: 'flex', alignItems: 'flex-end',
  };
  const panelStyle = {
    width: '100%', maxWidth: '430px', margin: '0 auto',
    background: '#1e293b', borderRadius: '20px 20px 0 0',
    padding: '20px 18px 36px',
    border: '1px solid rgba(255,255,255,0.1)',
    animation: 'slideUp 0.25s ease',
  };

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`@keyframes slideUp { from { transform:translateY(60px); opacity:0; } to { transform:translateY(0); opacity:1; } }`}</style>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#f8fafc' }}>🤕 Report a Niggle</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Let's adapt the session for you</div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: '8px',
            color: '#94a3b8', width: '32px', height: '32px', cursor: 'pointer', fontSize: '16px',
          }}>✕</button>
        </div>

        {nigStep === 'where' && (
          <>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '12px' }}>Where's the issue?</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
              {PARTS.map(p => (
                <button key={p} onClick={() => pickPart(p)} style={{
                  padding: '8px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700',
                  background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)',
                  color: '#cbd5e1', cursor: 'pointer', transition: 'all 0.12s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#cbd5e1'; }}
                >{p}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={customTxt}
                onChange={e => setCustomTxt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCustom(); }}
                placeholder="Other — e.g. shin, forearm, groin…"
                style={{
                  flex: 1, padding: '11px 13px', background: '#0f172a',
                  border: '1px solid rgba(255,255,255,0.09)', borderRadius: '10px',
                  color: '#f8fafc', fontSize: '13px', outline: 'none',
                }}
              />
              <button onClick={handleCustom} style={{
                padding: '11px 14px', background: '#f97316', border: 'none', borderRadius: '10px',
                color: '#fff', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
              }}>→</button>
            </div>
          </>
        )}

        {nigStep === 'severity' && (
          <>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px' }}>
              How bad is the <strong style={{ color: '#f97316' }}>{bodyPart}</strong>?
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              {[
                { val: 1, emoji: '😐', label: 'Mild' },
                { val: 2, emoji: '😕', label: 'Aching' },
                { val: 3, emoji: '😣', label: 'Sore' },
                { val: 4, emoji: '😖', label: 'Sharp' },
                { val: 5, emoji: '😡', label: 'Severe' },
              ].map(s => (
                <button key={s.val} onClick={() => handleSeverity(s.val)} style={{
                  flex: 1, padding: '11px 4px',
                  background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px', color: '#f8fafc', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                  transition: 'border-color 0.12s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.5)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >
                  <span style={{ fontSize: '20px' }}>{s.emoji}</span>
                  <span style={{ fontSize: '9px', color: '#64748b', fontWeight: '600' }}>{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {nigStep === 'done' && (
          <>
            <div style={{
              background: flaggedExs.length > 0 ? 'rgba(251,191,36,0.08)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${flaggedExs.length > 0 ? 'rgba(251,191,36,0.25)' : 'rgba(34,197,94,0.25)'}`,
              borderRadius: '12px', padding: '14px 16px', marginBottom: '14px',
            }}>
              {flaggedExs.length > 0 ? (
                <>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#fbbf24', marginBottom: '6px' }}>
                    ⚠️ Flagged {flaggedExs.length} exercise{flaggedExs.length > 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                    {flaggedExs.map(e => e.name).join(', ')} — these may aggravate your {bodyPart}. Consider modifying load or skipping.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#86efac' }}>
                  ✓ Logged. Tom will be able to see this. If it gets worse, stop the session and let your coach know directly.
                </div>
              )}
            </div>
            <button onClick={onClose} style={{
              width: '100%', padding: '13px', background: '#f97316', border: 'none',
              borderRadius: '12px', color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
            }}>Got it — back to workout 💪</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Session picker modal ─────────────────────────────────────────────────────────────────
function SessionPickerModal({ sessions, onPick, onClose }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.72)',
      backdropFilter:'blur(3px)',display:'flex',alignItems:'flex-end'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{width:'100%',maxWidth:'430px',margin:'0 auto',background:'#1e293b',
        borderRadius:'20px 20px 0 0',padding:'20px 18px 36px',
        border:'1px solid rgba(255,255,255,0.1)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'16px'}}>
          <div>
            <div style={{fontSize:'16px',fontWeight:'800',color:'#f8fafc'}}>📋 Pick a Session</div>
            <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>Choose a workout to do today</div>
          </div>
          <button onClick={onClose} style={{background:'rgba(255,255,255,0.07)',border:'none',
            borderRadius:'8px',color:'#94a3b8',width:'32px',height:'32px',cursor:'pointer',fontSize:'16px'}}>✕</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {sessions.map((s,i) => (
            <button key={i} onClick={()=>onPick(s)}
              style={{padding:'14px 16px',background:'rgba(255,255,255,0.04)',
                border:'1px solid rgba(255,255,255,0.08)',borderRadius:'12px',
                color:'#f8fafc',cursor:'pointer',textAlign:'left',
                display:'flex',alignItems:'center',justifyContent:'space-between',
                transition:'border-color 0.12s'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(249,115,22,0.4)'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}>
              <div>
                <div style={{fontSize:'14px',fontWeight:'700'}}>{s.SessionName||`Day ${i+1}`}</div>
                {s.FocusArea && <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{s.FocusArea}</div>}
              </div>
              <span style={{color:'#f97316',fontSize:'16px'}}>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Rest Timer (auto-starts after a set is completed) ───────────────────────
function RestTimer({ seconds, onDone }) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    if (remaining <= 0) { onDone(); return; }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  const pct = ((seconds - remaining) / seconds) * 100;
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return (
    <div style={{
      background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.25)',
      borderRadius:'10px',padding:'10px 14px',marginTop:'8px',
      display:'flex',alignItems:'center',gap:'12px',
    }}>
      <div style={{position:'relative',width:'36px',height:'36px',flexShrink:0}}>
        <svg width="36" height="36" style={{transform:'rotate(-90deg)'}}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(249,115,22,0.15)" strokeWidth="3"/>
          <circle cx="18" cy="18" r="15" fill="none" stroke="#f97316" strokeWidth="3"
            strokeDasharray={`${2*Math.PI*15}`}
            strokeDashoffset={`${2*Math.PI*15*(1-pct/100)}`}
            style={{transition:'stroke-dashoffset 1s linear'}}/>
        </svg>
        <span style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:'9px',fontWeight:'800',color:'#f97316'}}>
          {mins > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : secs}
        </span>
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#f97316'}}>Rest period</div>
        <div style={{fontSize:'11px',color:'#64748b'}}>
          {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`} remaining
        </div>
      </div>
      <button onClick={onDone} style={{
        background:'rgba(249,115,22,0.15)',border:'1px solid rgba(249,115,22,0.3)',
        borderRadius:'7px',padding:'5px 10px',color:'#f97316',
        fontSize:'11px',fontWeight:'700',cursor:'pointer',
      }}>Skip</button>
    </div>
  );
}

// ─── Stopwatch (for time-based exercises) ────────────────────────────────────
function Stopwatch() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const reset = () => { setRunning(false); setElapsed(0); };
  return (
    <div style={{
      background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.25)',
      borderRadius:'10px',padding:'10px 14px',marginTop:'6px',
      display:'flex',alignItems:'center',gap:'12px',
    }}>
      <div style={{fontSize:'22px',fontWeight:'800',color:'#818cf8',minWidth:'64px',fontVariantNumeric:'tabular-nums'}}>
        {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
      </div>
      <div style={{flex:1,fontSize:'11px',color:'#64748b'}}>Stopwatch</div>
      <button onClick={() => setRunning(r => !r)} style={{
        background: running ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
        border: `1px solid ${running ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)'}`,
        borderRadius:'7px',padding:'5px 12px',
        color: running ? '#fca5a5' : '#818cf8',
        fontSize:'11px',fontWeight:'700',cursor:'pointer',
      }}>{running ? 'Pause' : elapsed > 0 ? 'Resume' : 'Start'}</button>
      {elapsed > 0 && !running && (
        <button onClick={reset} style={{
          background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',
          borderRadius:'7px',padding:'5px 10px',color:'#64748b',
          fontSize:'11px',fontWeight:'700',cursor:'pointer',
        }}>Reset</button>
      )}
    </div>
  );
}

// ─── How to perform section ──────────────────────────────────────────────────
function HowToSection({ libraryEx }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginTop: '8px' }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: '11px', fontWeight: '700', color: '#64748b',
        padding: '4px 0', display: 'flex', alignItems: 'center', gap: '5px',
      }}>
        <span>📋 How to perform</span>
        <span style={{ fontSize: '9px', color: '#475569' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{
          background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '10px 12px',
          marginTop: '6px', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {libraryEx.HowToPerform && (
            <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 8px' }}>
              {libraryEx.HowToPerform}
            </p>
          )}
          {libraryEx.VideoURL && (
            <a href={libraryEx.VideoURL} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '11px', fontWeight: '700', color: '#f97316',
              background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.25)',
              borderRadius: '6px', padding: '5px 10px', textDecoration: 'none',
            }}>▶ Watch video</a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Exercise card (used in ActiveWorkout) ────────────────────────────────────
function ExerciseCard({ exercise, sets, onUpdateSet, isFlagged, soreWarning, niggleFlag, compact=false, restSeconds=90, libraryEx }) {
  const allDone = sets.every(s=>s.done);
  const doneSets = sets.filter(s=>s.done).length;
  const borderColor = isFlagged ? 'rgba(251,191,36,0.35)' : allDone ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)';
  const mcColor = MUSCLE_COLORS[exercise.muscleGroup] || '#64748b';
  const [restActive, setRestActive] = useState(false);

  // Detect time-based exercise: reps field contains 'sec', 'min', 's', or metric=time
  const repsStr = String(exercise.reps || '');
  const isTimeBased = /sec|min|\ds$|time/i.test(repsStr) || exercise.metric === 'time';

  const handleToggleDone = (idx, s) => {
    const nowDone = !s.done;
    onUpdateSet(idx, {...s, done: nowDone});
    // Start rest timer when marking a set as done (not when undoing)
    if (nowDone && !allDone) setRestActive(true);
  };

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
      {exercise.swappedForInjury && (
        <div style={{background:'rgba(139,92,246,0.1)',border:'1px solid rgba(139,92,246,0.25)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#c4b5fd',marginBottom:'10px'}}>
          🔄 Swapped from <em>{exercise.originalName}</em> to protect your injury — safer alternative selected
        </div>
      )}
      {isFlagged && !exercise.swappedForInjury && (
        <div style={{background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.25)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#fbbf24',marginBottom:'10px'}}>
          ⚠️ Injury flagged — consider skipping or reducing load on this exercise
        </div>
      )}
      {niggleFlag && (
        <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#fca5a5',marginBottom:'10px'}}>
          🤕 In-workout niggle reported — modify load or skip if pain increases
        </div>
      )}
      {soreWarning && (
        <div style={{background:'rgba(251,191,36,0.07)',border:'1px solid rgba(251,191,36,0.18)',borderRadius:'7px',padding:'8px 10px',fontSize:'12px',color:'#f59e0b',marginBottom:'10px'}}>
          🔥 High soreness on {exercise.muscleGroup} — consider reducing load
        </div>
      )}

      {/* Stopwatch for time-based exercises */}
      {isTimeBased && <Stopwatch />}

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
              <div style={{fontSize:'9px',color:'#475569',marginBottom:'3px',textAlign:'center',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.4px'}}>{isTimeBased ? 'Duration' : 'Reps'}</div>
              <input
                type={isTimeBased ? 'text' : 'number'} inputMode={isTimeBased ? 'text' : 'numeric'} value={s.reps}
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
            {!isTimeBased && (
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
            )}
          </div>

          <button
            onClick={()=>handleToggleDone(idx, s)}
            style={{
              width:'36px',height:'36px',borderRadius:'9px',flexShrink:0,
              background: s.done ? '#22c55e' : 'rgba(255,255,255,0.06)',
              border:'none',color: s.done ? '#fff' : '#475569',
              fontSize:'14px',fontWeight:'800',cursor:'pointer',
              transition:'all 0.15s',
            }}>{s.done ? '✓' : '○'}</button>
        </div>
      ))}

      {/* Rest timer — shows after completing a set */}
      {restActive && !allDone && (
        <RestTimer seconds={restSeconds} onDone={() => setRestActive(false)} />
      )}

      {/* How to perform — expandable */}
      {libraryEx && (libraryEx.HowToPerform || libraryEx.VideoURL) && (
        <HowToSection libraryEx={libraryEx} />
      )}
    </div>
  );
}

// ─── Active Workout view ──────────────────────────────────────────────────────
function ActiveWorkout({ session, exercises, sets, adjustments, preData,
  onUpdateSet, onAddExercise, onComplete, onCancel, onNiggleLog, saving, allExercises=[] }) {

  const [showAddEx,   setShowAddEx]  = useState(false);
  const [newEx,       setNewEx]      = useState({name:'',sets:'3',reps:'10',weight:'',muscleGroup:''});
  const [confirmDone, setConfirmDone]= useState(false);
  const [showNiggle,  setShowNiggle] = useState(false);
  const [niggleFlags, setNiggleFlags]= useState({}); // exerciseName → true

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
    <div style={{padding:'16px 16px 32px',fontFamily:"'Inter', system-ui, sans-serif",color:'#f8fafc'}}>
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
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <button onClick={()=>setShowNiggle(true)} style={{
            background:'#1e293b', border:'1.5px solid rgba(251,191,36,0.35)',
            borderRadius:'16px', padding:'6px 11px',
            color:'#fbbf24', fontSize:'11px', fontWeight:'700',
            cursor:'pointer', display:'flex', alignItems:'center', gap:'4px',
          }}>🤕 Niggle</button>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:'18px',fontWeight:'800',color: pct===100 ? '#22c55e' : '#f97316'}}>{pct}%</div>
            <div style={{fontSize:'10px',color:'#475569'}}>{totalSetsDone}/{totalSetsPlanned} sets</div>
          </div>
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
      {adjustments.map((adj,i) => {
        const styles = {
          recovery: { bg:'rgba(59,130,246,0.1)',  border:'rgba(59,130,246,0.25)',  color:'#93c5fd',  icon:'💙' },
          injury:   { bg:'rgba(251,191,36,0.1)',  border:'rgba(251,191,36,0.25)',  color:'#fbbf24',  icon:'⚠️' },
          swap:     { bg:'rgba(139,92,246,0.1)',   border:'rgba(139,92,246,0.25)',  color:'#c4b5fd',  icon:'🔄' },
          soreness: { bg:'rgba(249,115,22,0.1)',  border:'rgba(249,115,22,0.2)',   color:'#fdba74',  icon:'🔥' },
        };
        const s = styles[adj.type] || styles.soreness;
        return (
          <div key={i} style={{
            padding:'12px 14px',borderRadius:'10px',marginBottom:'10px',fontSize:'13px',lineHeight:1.45,
            background:s.bg, border:`1px solid ${s.border}`, color:s.color,
          }}>
            {s.icon} {adj.msg}
          </div>
        );
      })}

      {/* Exercise cards */}
      {exercises.map(ex => (
        <ExerciseCard key={ex.name}
          exercise={ex}
          sets={sets[ex.name]||[]}
          onUpdateSet={(idx,s)=>onUpdateSet(ex.name,idx,s)}
          isFlagged={!!(injuredMuscles && (ex.muscleGroup||'').toLowerCase().includes(injuredMuscles.split(' ')[0]))}
          soreWarning={sorenessMuscles.includes((ex.muscleGroup||'').toLowerCase())}
          niggleFlag={!!niggleFlags[ex.name]}
          libraryEx={allExercises.find(e => e.Name?.toLowerCase() === ex.name?.toLowerCase())}
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

      {/* Complete button — in scroll flow, not fixed */}
      <button onClick={handleComplete} disabled={saving} style={{
        width:'100%', marginTop:'16px',
        padding:'16px',background: saving ? 'rgba(249,115,22,0.4)' : '#f97316',
        border:'none',borderRadius:'14px',color:'#fff',
        fontSize:'15px',fontWeight:'800',cursor: saving ? 'not-allowed' : 'pointer',
        boxShadow:'0 8px 24px rgba(249,115,22,0.35)',
      }}>
        {saving ? 'Saving workout…' : 'Complete Workout ✓'}
      </button>

      {/* Niggle modal */}
      {showNiggle && (
        <NiggleModal
          exercises={exercises}
          onFlag={(bodyPart, severity, flaggedExs) => {
            const flags = {};
            flaggedExs.forEach(ex => { flags[ex.name] = true; });
            setNiggleFlags(prev => ({ ...prev, ...flags }));
            if (onNiggleLog) onNiggleLog(bodyPart, severity, flaggedExs);
          }}
          onClose={() => setShowNiggle(false)}
        />
      )}
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
function WorkoutDayCard({ session, log, date, actualDate, onActualDateChange, onStart, onEdit, daysPerWeek, onPickSession }) {
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
        <div style={{fontSize:'13px',color:'#475569',marginBottom: onPickSession ? '14px' : '0'}}>Recovery is part of the plan.</div>
        {onPickSession && (
          <button onClick={onPickSession} style={{
            width:'100%',padding:'11px',background:'transparent',
            border:'1.5px dashed rgba(249,115,22,0.35)',borderRadius:'11px',
            color:'#f97316',fontSize:'13px',fontWeight:'700',cursor:'pointer',
          }}>Want to train today? Pick a session →</button>
        )}
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


// ─── WeeklyVolumePanel ───────────────────────────────────────────────────────
const MUSCLE_ORDER = ['Chest','Back','Shoulders','Arms','Legs','Glutes','Core'];
const VOLUME_COLORS = {
  Chest:'#3b82f6', Back:'#8b5cf6', Shoulders:'#f59e0b',
  Arms:'#ec4899', Legs:'#22c55e', Glutes:'#f97316', Core:'#14b8a6',
};

function computeWeeklyVolume(programDays) {
  // programDays = array of { exercises: [{name, sets, muscleGroup, ...}] }
  const counts = {};
  (programDays || []).forEach(day => {
    let exList = [];
    try { exList = typeof day.exercises === 'string' ? JSON.parse(day.exercises) : (day.exercises || []); } catch {}
    exList.forEach(ex => {
      const muscle = ex.muscleGroup || ex.primaryMuscle || ex.PrimaryMuscle || 'Other';
      const sets   = parseInt(ex.sets) || 0;
      counts[muscle] = (counts[muscle] || 0) + sets;
    });
  });
  return counts;
}

function WeeklyVolumePanel({ programDays }) {
  if (!programDays || programDays.length === 0) return null;
  const volume = computeWeeklyVolume(programDays);
  const hasData = Object.values(volume).some(v => v > 0);
  if (!hasData) return null;

  const TARGET_MIN = 10;
  const TARGET_MAX = 20;

  return (
    <div style={{
      background: '#1e293b', borderRadius: 14, padding: '16px 18px',
      border: '1px solid rgba(255,255,255,0.06)', marginBottom: 14,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:14 }}>Weekly Volume</div>
        <div style={{ color:'#64748b', fontSize:11 }}>Target: 10–20 sets / muscle</div>
      </div>
      {MUSCLE_ORDER.filter(m => (volume[m] || 0) > 0).map(muscle => {
        const sets = volume[muscle] || 0;
        const pct  = Math.min((sets / TARGET_MAX) * 100, 100);
        const color = VOLUME_COLORS[muscle] || '#94a3b8';
        const status = sets < TARGET_MIN ? 'under' : sets > TARGET_MAX ? 'over' : 'ok';
        return (
          <div key={muscle} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:12, color:'#94a3b8' }}>{muscle}</span>
              <span style={{ fontSize:12, fontWeight:600,
                color: status === 'ok' ? '#22c55e' : status === 'under' ? '#f59e0b' : '#ef4444' }}>
                {sets} sets {status === 'under' ? '↑' : status === 'over' ? '⚠' : '✓'}
              </span>
            </div>
            <div style={{ height:6, background:'rgba(255,255,255,0.07)', borderRadius:99, overflow:'hidden' }}>
              <div style={{
                height:'100%', width:`${pct}%`, borderRadius:99,
                background: status === 'ok' ? color : status === 'under' ? '#f59e0b' : '#ef4444',
                transition:'width 0.5s ease',
              }} />
            </div>
          </div>
        );
      })}
      <div style={{ display:'flex', gap:12, marginTop:10, paddingTop:10,
        borderTop:'1px solid rgba(255,255,255,0.05)' }}>
        {[['✓','On track','#22c55e'],['↑','Under target','#f59e0b'],['⚠','Over target','#ef4444']].map(([icon,label,c])=>(
          <div key={label} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ color:c, fontSize:11 }}>{icon}</span>
            <span style={{ color:'#64748b', fontSize:10 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Progressive Overload modal ───────────────────────────────────────────────────────
function ProgressionModal({ updates, onConfirm, onDismiss, saving }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:210,background:'rgba(0,0,0,0.78)',
      backdropFilter:'blur(4px)',display:'flex',alignItems:'center',
      justifyContent:'center',padding:'20px'}}>
      <div style={{width:'100%',maxWidth:'400px',background:'#1e293b',borderRadius:'20px',
        padding:'24px 20px',border:'1px solid rgba(249,115,22,0.25)'}}>
        <div style={{textAlign:'center',marginBottom:'20px'}}>
          <div style={{fontSize:'32px',marginBottom:'10px'}}>🎯</div>
          <div style={{fontSize:'18px',fontWeight:'800',color:'#f8fafc'}}>Progressive Overload!</div>
          <div style={{fontSize:'13px',color:'#64748b',marginTop:'6px',lineHeight:1.5}}>
            You nailed every rep on {updates.length} exercise{updates.length>1?'s':''}.<br/>Time to level up for your next session.
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px'}}>
          {updates.map((u,i) => (
            <div key={i} style={{background:'rgba(249,115,22,0.07)',
              border:'1px solid rgba(249,115,22,0.18)',borderRadius:'11px',
              padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:'13px',fontWeight:'700',color:'#f8fafc'}}>{u.exerciseName}</div>
                <div style={{fontSize:'11px',color:'#64748b',marginTop:'2px'}}>{u.muscleGroup}</div>
              </div>
              <div style={{textAlign:'right'}}>
                {u.type==='weight' ? (
                  <>
                    <div style={{fontSize:'15px',fontWeight:'800',color:'#22c55e'}}>{u.newWeight}kg</div>
                    <div style={{fontSize:'10px',color:'#64748b'}}>was {u.currentWeight}kg (+{u.increment}kg)</div>
                  </>
                ) : (
                  <>
                    <div style={{fontSize:'15px',fontWeight:'800',color:'#22c55e'}}>{u.newReps} reps</div>
                    <div style={{fontSize:'10px',color:'#64748b'}}>was {u.currentReps} reps (+1)</div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <button onClick={onConfirm} disabled={saving} style={{
          width:'100%',padding:'13px',background:saving?'rgba(249,115,22,0.4)':'#f97316',
          border:'none',borderRadius:'12px',color:'#fff',fontSize:'14px',
          fontWeight:'700',cursor:saving?'not-allowed':'pointer',marginBottom:'8px',
        }}>{saving ? 'Updating program…' : 'Apply to my program ✓'}</button>
        <button onClick={onDismiss} style={{
          width:'100%',padding:'12px',background:'transparent',
          border:'1px solid rgba(255,255,255,0.1)',borderRadius:'12px',
          color:'#64748b',fontSize:'14px',fontWeight:'600',cursor:'pointer',
        }}>Not now</button>
      </div>
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
  const [activeProgram,setActiveProgram]= useState(null);
  const [trainingDays, setTrainingDays]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState(null);

  // ── Active workout state ──
  const [preWorkoutData,   setPreWorkoutData]   = useState(null);
  const [adjustments,      setAdjustments]      = useState([]);
  const [activeExercises,  setActiveExercises]  = useState([]);
  const [activeSets,       setActiveSets]       = useState({});
  const [activeSession,    setActiveSession]    = useState(null);
  const [allExercises,     setAllExercises]     = useState([]);
  const [prepping,         setPrepping]         = useState(false);
  const [showSessionPicker,setShowSessionPicker]= useState(false);
  const [progressionItems, setProgressionItems] = useState([]);
  const [showProgression,  setShowProgression]  = useState(false);
  const [savingProgression,setSavingProgression]= useState(false);

  const weekDays     = getWeekDays();
  const daysPerWeek  = trainingDays?.size || parseInt(activeProgram?.DaysPerWeek) || parseInt(clientProfile?.TrainingDaysPerWeek) || 3;

  const fetchData = useCallback(async () => {
    if (!user?.clientID) return;
    setLoading(true); setError(null);
    try {
      const [clients, progRows, logs] = await Promise.all([
        readSheet('Clients'),
        readSheet('Programs'),
        readSheet('WorkoutLogs'),
      ]);
      // Load exercises library for smart swap (non-fatal)
      try { const exs = await readSheet('Exercises'); setAllExercises(exs || []); } catch {}

      const profile = clients.find(c => c.ClientID === user.clientID) || null;
      setClientProfile(profile);

      // Find assigned program from client's ProgramID field
      const myProgram = profile?.ProgramID
        ? progRows.find(p => p.ProgramID === profile.ProgramID) || null
        : null;
      setActiveProgram(myProgram);
      const assignedDays = profile?.TrainingDays
        ? new Set(profile.TrainingDays.split(',').map(d=>d.trim()).filter(Boolean))
        : null;
      setTrainingDays(assignedDays);

      // Transform DaysJSON into session-like objects WorkoutDayCard expects
      let mySessions = [];
      if (myProgram?.DaysJSON) {
        try {
          const days = JSON.parse(myProgram.DaysJSON);
          mySessions = days.map(day => ({
            SessionID:   `${myProgram.ProgramID}_day${day.dayOrder}`,
            ProgramID:   myProgram.ProgramID,
            DayOrder:    String(day.dayOrder),
            SessionName: day.dayName || `Day ${day.dayOrder}`,
            FocusArea:   day.focusArea || '',
            Exercises:   JSON.stringify(day.exercises || []),
          }));
        } catch { /* malformed DaysJSON — leave empty */ }
      }
      setSessions(mySessions);
      setWorkoutLogs(logs.filter(l => l.ClientID === user.clientID));
    } catch { setError('Could not load training data.'); }
    finally { setLoading(false); }
  }, [user?.clientID]);

  useEffect(()=>{ fetchData(); }, [fetchData]);

  // Derived
  const selectedDayIdx   = weekDays.findIndex(d=>d.date===selectedDate);
  const selectedSession  = selectedDayIdx >= 0 ? getSessionForDay(sessions, selectedDayIdx, daysPerWeek, trainingDays) : null;
  const selectedLog      = workoutLogs.find(l => l.Status==='Completed' && ((l.Date||'').slice(0,10)===selectedDate || (selectedSession && l.WorkoutName===selectedSession.SessionName && (l.Date||'').slice(0,10)===selectedDate)));
  const weekStats        = computeWeekStats(workoutLogs, weekDays);
  const scheduledThisWeek= weekDays.filter((_,i)=>!!getSessionForDay(sessions,i,daysPerWeek,trainingDays)).length;

  // Init active sets from exercises
  const initActiveSets = (exs) => {
    const s = {};
    exs.forEach(ex=>{
      s[ex.name] = Array.from({length:ex.sets},()=>({reps:String(ex.reps||''),weight:String(ex.weight||''),done:false}));
    });
    return s;
  };

  // Handle pre-workout chat submission
  const handlePreWorkoutSubmit = async (data) => {
    setPreWorkoutData(data);
    let exs = [];
    try { exs = JSON.parse(activeSession?.Exercises||'[]'); } catch {}

    // Step 1: local keyword-based swap from Exercises library
    if (data.hasInjury && data.injuryNotes && allExercises.length > 0) {
      exs = swapInjuredExercises(exs, data.injuryNotes, allExercises);
    }

    // Step 2: AI sub via Claude for any exercises still flagged (no local match found)
    const stillFlagged = exs.filter(ex => ex.flaggedForInjury);
    if (stillFlagged.length > 0 && data.hasInjury && data.injuryNotes) {
      setPrepping(true);
      try {
        const result = await callProxy({
          action: 'substituteExercises',
          exercises: stillFlagged.map(e => ({ name: e.name, muscleGroup: e.muscleGroup||'' })),
          injuryNotes: data.injuryNotes,
        });
        if (result.substitutions?.length > 0) {
          const subMap = {};
          result.substitutions.forEach(s => { subMap[s.original.toLowerCase()] = s; });
          exs = exs.map(ex => {
            if (!ex.flaggedForInjury) return ex;
            const sub = subMap[(ex.name||'').toLowerCase()];
            if (sub) return { ...ex, name: sub.substitute, originalName: ex.name,
              swappedForInjury: true, flaggedForInjury: false };
            return ex;
          });
        }
      } catch { /* AI sub failed — leave exercises flagged */ }
      finally { setPrepping(false); }
    }

    // Apply adjustments (banners + recovery detection)
    const adjs = getAdjustments(data, exs);

    // Recovery mode: reduce sets by 1
    if (adjs.some(a=>a.type==='recovery')) {
      exs = exs.map(ex=>({...ex, sets: Math.max(1, ex.sets-1)}));
    }

    // Add swap-summary banner if exercises were swapped
    const swappedCount = exs.filter(ex => ex.swappedForInjury).length;
    if (swappedCount > 0) {
      adjs.push({
        type: 'swap',
        msg: `${swappedCount} exercise${swappedCount > 1 ? 's have' : ' has'} been swapped for safer alternatives due to your reported injury.`,
      });
    }

    setAdjustments(adjs);
    setActiveExercises(exs);
    setActiveSets(initActiveSets(exs));
    setView('active');
  };

  // Log in-workout niggle to AIQuestions for trainer review
  const handleNiggleLog = async (bodyPart, severity, flaggedExercises) => {
    try {
      await appendToSheet('AIQuestions', {
        QuestionID: `Q_NIG_${Date.now()}`,
        ClientID:   user.clientID,
        ClientName: user.name || '',
        Question:   `[IN-WORKOUT NIGGLE] ${bodyPart} — Severity ${severity}/5 — During: ${activeSession?.SessionName || 'workout'}${flaggedExercises.length > 0 ? ` — Flagged: ${flaggedExercises.map(e=>e.name).join(', ')}` : ''}`,
        Answer:    '',
        Status:    'Flagged',
        AskedAt:   new Date().toISOString(),
        AnsweredAt:'',
      });
    } catch {}
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

      // Check for progressive overload opportunities
      const progItems = computeProgression(activeExercises, activeSets);
      setView('weekly');
      await fetchData();
      if (progItems.length > 0) {
        setProgressionItems(progItems);
        setShowProgression(true);
      }
    } catch(e) { console.error('Save failed:', e); }
    finally { setSaving(false); }
  };

  const handleConfirmProgression = async () => {
    setSavingProgression(true);
    try {
      if (activeProgram?.ProgramID && progressionItems.length > 0) {
        await callProxy({
          action: 'applyProgression',
          programId: activeProgram.ProgramID,
          updates: progressionItems,
        });
        await fetchData(); // reload updated program
      }
    } catch { /* silent — progression not critical */ }
    finally {
      setSavingProgression(false);
      setShowProgression(false);
      setProgressionItems([]);
    }
  };

  const handleDismissProgression = () => {
    setShowProgression(false);
    setProgressionItems([]);
  };

  // ── Sub-views ──
  if (view === 'preWorkout') {
    return (
      <>
        <PreWorkoutChat
          session={activeSession}
          onSubmit={handlePreWorkoutSubmit}
          onCancel={()=>setView('weekly')}
        />
        {prepping && (
          <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(15,23,42,0.96)',
            display:'flex',alignItems:'center',justifyContent:'center',
            flexDirection:'column',gap:'16px'}}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{width:'48px',height:'48px',borderRadius:'50%',
              border:'4px solid rgba(249,115,22,0.2)',borderTopColor:'#f97316',
              animation:'spin 1s linear infinite'}}/>
            <div style={{color:'#f97316',fontWeight:700,fontSize:'15px'}}>Adapting your session…</div>
            <div style={{color:'#64748b',fontSize:'12px'}}>Finding safer exercise alternatives</div>
          </div>
        )}
      </>
    );
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
        onNiggleLog={handleNiggleLog}
        saving={saving}
        allExercises={allExercises}
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
          trainingDays={trainingDays}
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
          onPickSession={sessions.length > 0 ? ()=>setShowSessionPicker(true) : null}
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

      {/* Session picker modal — shown for rest days or to swap workout day */}
      {showSessionPicker && (
        <SessionPickerModal
          sessions={sessions}
          onPick={s => { setShowSessionPicker(false); handleStartWorkout(s); }}
          onClose={() => setShowSessionPicker(false)}
        />
      )}

      {/* Progressive overload modal — shown after a complete workout */}
      {showProgression && (
        <ProgressionModal
          updates={progressionItems}
          onConfirm={handleConfirmProgression}
          onDismiss={handleDismissProgression}
          saving={savingProgression}
        />
      )}
    </div>
  );
}
