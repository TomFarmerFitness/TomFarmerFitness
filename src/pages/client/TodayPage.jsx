import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { readSheet } from '../../utils/sheets';
import { useSafeAppend } from '../../hooks/useSafeAppend';
import { runMacroAdjustmentCheck, getMacroNotification, dismissMacroNotification } from '../../utils/macroAdjustment';

const MOTIVATIONAL = [
  "Every rep builds the person you're becoming.",
  "The hardest part is starting. You already started.",
  "Consistency beats perfection every time.",
  "Small steps forward are still steps forward.",
  "Your body can do it. Trust your training.",
  "One workout at a time. That's all.",
  "Fuel your body. Honor your goals.",
  "Progress is quiet. Keep going anyway.",
  "Show up. Do the work. Feel the shift.",
  "Strong is built, not born.",
  "Every good choice compounds.",
  "Rest is part of the plan too.",
  "You're doing better than you think.",
  "The discomfort you feel is called growth.",
  "Today's effort is tomorrow's result.",
  "Trust the process. It's working.",
  "Discipline is freedom in disguise.",
  "Your future self will thank today's self.",
  "Hard days build strong people.",
  "You don't have to be perfect. Just consistent.",
  "Fuel first. Perform second.",
  "Movement is medicine.",
  "Make today count.",
  "One day at a time. One rep at a time.",
  "The work is the reward.",
  "Strong body, clear mind.",
  "Push a little harder today.",
  "Recovery is progress too.",
  "Show up for yourself today.",
  "This is where it happens — right here.",
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Circular calorie ring ─────────────────────────────────────────────────
function CircularProgress({ consumed, target }) {
  const size = 136, sw = 11;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  const offset = circ * (1 - pct);
  const over = consumed > target && target > 0;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={over ? '#22c55e' : '#f97316'} strokeWidth={sw}
          strokeDasharray={circ} strokeDashoffset={Math.max(0, offset)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: '22px', fontWeight: '800', color: '#f8fafc', lineHeight: 1 }}>{consumed}</div>
        <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>/ {target} kcal</div>
        <div style={{ fontSize: '10px', fontWeight: '700', color: over ? '#22c55e' : '#f97316', marginTop: '1px' }}>
          {Math.round(pct * 100)}%
        </div>
      </div>
    </div>
  );
}

// ── Macro progress bar ────────────────────────────────────────────────────
function MacroBar({ label, consumed, target, color }) {
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>
          {Math.round(consumed)}<span style={{ color: '#334155' }}>/{target}g</span>
        </span>
      </div>
      <div style={{ height: '5px', background: 'rgba(255,255,255,0.07)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct * 100}%`,
          background: color, borderRadius: '3px',
          transition: 'width 0.9s ease',
        }} />
      </div>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────
function Skeleton({ height = 100, mb = 12 }) {
  return (
    <div style={{
      height, borderRadius: '16px', marginBottom: mb,
      background: '#1e293b',
      animation: 'skeletonPulse 1.6s ease-in-out infinite',
    }} />
  );
}

// ── Workout sub-cards ─────────────────────────────────────────────────────
function CompletionCard({ log }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg,rgba(34,197,94,0.12),rgba(21,128,61,0.07))',
      borderRadius: '16px', padding: '18px 20px', marginBottom: '12px',
      border: '1px solid rgba(34,197,94,0.2)',
      display: 'flex', alignItems: 'center', gap: '14px',
    }}>
      <div style={{
        width: '46px', height: '46px', borderRadius: '13px',
        background: 'rgba(34,197,94,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '22px', flexShrink: 0,
      }}>&#x2705;</div>
      <div>
        <div style={{ fontSize: '15px', fontWeight: '800', color: '#22c55e' }}>&#x2705; Workout completed!</div>
        <div style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc', marginTop: '3px' }}>
          {log?.WorkoutName || "Today's session"}
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
          Great work today &#x1F4AA;{log?.TotalSets ? ` · ${log.TotalSets} sets done` : ''}
        </div>
      </div>
    </div>
  );
}

function WorkoutCard({ program, profile, onStart }) {
  if (!program && !profile?.ProgramID) {
    return (
      <div style={{
        background: '#1e293b', borderRadius: '16px', padding: '20px',
        border: '1px solid rgba(255,255,255,0.06)', marginBottom: '12px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>&#x1F3CB;&#xFE0F;</div>
        <div style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.5 }}>No program assigned yet.<br/>Your trainer will set one up for you.</div>
      </div>
    );
  }
  const trainingDays = parseInt(profile?.TrainingDaysPerWeek) || 3;
  const goal = profile?.Goal || program?.Goal || 'General Fitness';
  return (
    <div style={{
      background: 'linear-gradient(135deg,#1e293b 0%,#162032 100%)',
      borderRadius: '16px', padding: '18px 20px', marginBottom: '12px',
      border: '1px solid rgba(249,115,22,0.18)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: '#f97316', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
            Today's Workout
          </div>
          <div style={{ fontSize: '17px', fontWeight: '800', color: '#f8fafc', lineHeight: 1.2, marginBottom: '3px' }}>
            {program?.Name || 'Your Program'}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>{goal} &middot; {trainingDays}&times;/week</div>
        </div>
        <div style={{
          width: '42px', height: '42px', borderRadius: '11px',
          background: 'rgba(249,115,22,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', flexShrink: 0, marginLeft: '12px',
        }}>&#x1F3CB;&#xFE0F;</div>
      </div>
      {program?.Description && (
        <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.45, marginBottom: '14px' }}>
          {program.Description}
        </div>
      )}
      <button onClick={onStart} style={{
        width: '100%', padding: '13px',
        background: '#f97316', border: 'none', borderRadius: '11px',
        color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
      }}>
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Start Workout
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function TodayPage() {
  const { user } = useAuth();
  const navigate    = useNavigate();
  const safeAppend  = useSafeAppend();

  const [loading,       setLoading]       = useState(true);
  const [clientProfile, setClientProfile] = useState(null);
  const [program,       setProgram]       = useState(null);
  const [todayLog,      setTodayLog]      = useState(null);
  const [nutritionLogs, setNutritionLogs] = useState([]);
  const [todayWeight,   setTodayWeight]   = useState(null);
  const [error,         setError]         = useState(null);

  const [showQuickLog,  setShowQuickLog]  = useState(false);
  const [qlVisible,     setQlVisible]     = useState(false);
  const [qlForm,        setQlForm]        = useState({ meal: '', calories: '', protein: '', carbs: '', fats: '' });
  const [qlSaving,      setQlSaving]      = useState(false);

  const [showWeightLog, setShowWeightLog] = useState(false);
  const [macroNotif,    setMacroNotif]    = useState(null);   // pending macro adjustment notification
  const [wlVisible,     setWlVisible]     = useState(false);
  const [wlWeight,      setWlWeight]      = useState('');
  const [wlSaving,      setWlSaving]      = useState(false);

  const today      = todayISO();
  const dayOfYear  = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const motivational = MOTIVATIONAL[dayOfYear % MOTIVATIONAL.length];
  const hour       = new Date().getHours();
  const greeting   = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greetEmoji = hour < 12 ? '&#x2600;&#xFE0F;' : hour < 17 ? '&#x26A1;' : '&#x1F319;';
  const firstName  = (user?.name || 'there').split(' ')[0];
  const dateLabel  = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  const fetchData = useCallback(async () => {
    if (!user?.clientID) return;
    setLoading(true); setError(null);
    try {
      const [clients, programs, workoutLogs, nutritionRows, metricsRows, macroAdj] = await Promise.all([
        readSheet('Clients'),
        readSheet('WorkoutPrograms'),
        readSheet('WorkoutLogs'),
        readSheet('NutritionLogs'),
        readSheet('BodyMetrics'),
        readSheet('MacroAdjustments').catch(() => []),
      ]);
      const profile = clients.find(c => c.ClientID === user.clientID) || null;
      setClientProfile(profile);
      const prog = profile?.ProgramID ? programs.find(p => p.ProgramID === profile.ProgramID) || null : null;
      if (prog) setProgram(prog);
      setTodayLog(workoutLogs.find(l =>
        l.ClientID === user.clientID &&
        (l.Date || '').slice(0,10) === today &&
        l.Status === 'Completed'
      ) || null);
      setNutritionLogs(nutritionRows.filter(r =>
        r.ClientID === user.clientID && (r.Date || '').slice(0,10) === today
      ));
      setTodayWeight(metricsRows.find(r =>
        r.ClientID === user.clientID && (r.Date || '').slice(0,10) === today
      ) || null);

      // Run macro adjustment check (fires-and-forgets write; updates notification state)
      if (profile) {
        try {
          await runMacroAdjustmentCheck({
            client:           profile,
            weightEntries:    metricsRows,
            nutritionLogs:    nutritionRows,
            trainingLogs:     workoutLogs,
            macroAdjustments: macroAdj,
            daysPerWeek:      prog ? parseInt(prog.DaysPerWeek || 3) : 3,
          });
        } catch (adjErr) {
          console.warn('Macro adjustment check failed:', adjErr);
        }
        // Pick up any pending notification (written by check above)
        const notif = getMacroNotification(user.clientID);
        if (notif) setMacroNotif(notif);
      }
    } catch {
      setError('Could not load data. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user?.clientID, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Re-fetch when user navigates back to this tab (e.g. after completing a workout)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchData]);

  const openModal  = (setShow, setVisible) => { setShow(true);  requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true))); };
  const closeModal = (setShow, setVisible, delay = 300) => { setVisible(false); setTimeout(() => setShow(false), delay); };

  const handleQuickLogSubmit = async () => {
    if (!qlForm.calories) return;
    setQlSaving(true);
    try {
      await safeAppend('NutritionLogs', {
        LogID: `NL_${Date.now()}`, ClientID: user.clientID,
        Date: today, MealName: qlForm.meal || 'Quick Log',
        Calories: qlForm.calories, Protein: qlForm.protein || '0',
        Carbs: qlForm.carbs || '0', Fats: qlForm.fats || '0',
        Notes: '', LoggedAt: new Date().toISOString(),
      });
      closeModal(setShowQuickLog, setQlVisible);
      setQlForm({ meal: '', calories: '', protein: '', carbs: '', fats: '' });
      setTimeout(fetchData, 350);
    } catch { alert('Failed to save. Please try again.'); }
    finally { setQlSaving(false); }
  };

  const handleWeightSubmit = async () => {
    if (!wlWeight) return;
    setWlSaving(true);
    try {
      await safeAppend('BodyMetrics', {
        MetricID: `BM_${Date.now()}`, ClientID: user.clientID,
        Date: today, WeightKg: wlWeight,
        BodyFatPct: '', Notes: '', LoggedAt: new Date().toISOString(),
      });
      closeModal(setShowWeightLog, setWlVisible);
      setWlWeight('');
      setTimeout(fetchData, 350);
    } catch { alert('Failed to save. Please try again.'); }
    finally { setWlSaving(false); }
  };

  const totals = nutritionLogs.reduce((acc, r) => ({
    calories: acc.calories + (parseFloat(r.Calories) || 0),
    protein:  acc.protein  + (parseFloat(r.Protein)  || 0),
    carbs:    acc.carbs    + (parseFloat(r.Carbs)    || 0),
    fats:     acc.fats     + (parseFloat(r.Fats)     || 0),
  }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

  const targets = {
    calories: parseInt(clientProfile?.CalorieTarget) || 2000,
    protein:  parseInt(clientProfile?.ProteinTarget) || 150,
    carbs:    parseInt(clientProfile?.CarbsTarget)   || 220,
    fats:     parseInt(clientProfile?.FatsTarget)    || 65,
  };

  const inputStyle = {
    width: '100%', padding: '12px 14px',
    background: '#0f172a', border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: '10px', color: '#f8fafc', fontSize: '15px',
    outline: 'none', WebkitAppearance: 'none',
  };

  return (
    <div style={{ padding: '20px 16px 24px', fontFamily: "'Inter', system-ui, sans-serif", color: '#f8fafc' }}>

      {/* Macro adjustment notification */}
      {macroNotif && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.1))',
          border: '1px solid rgba(249,115,22,0.35)',
          borderRadius: '12px', padding: '14px 16px', marginBottom: '18px',
          display: 'flex', gap: '12px', alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: '22px', flexShrink: 0 }}>📊</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fb923c', fontWeight: '700', fontSize: '14px', marginBottom: '4px' }}>
              Nutrition targets updated
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: 1.5 }}>
              Your macros have been adjusted based on your progress. Check the Nutrition tab.
            </div>
            {macroNotif.new && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                {[
                  { label: 'Calories', val: `${macroNotif.new.calories} kcal`, old: macroNotif.old?.calories },
                  { label: 'Protein',  val: `${macroNotif.new.protein}g`,      old: macroNotif.old?.protein },
                  { label: 'Carbs',    val: `${macroNotif.new.carbs}g`,        old: macroNotif.old?.carbs },
                  { label: 'Fats',     val: `${macroNotif.new.fats}g`,         old: macroNotif.old?.fats },
                ].map(({ label, val, old }) => (
                  <div key={label} style={{
                    background: 'rgba(0,0,0,0.25)', borderRadius: '8px',
                    padding: '5px 10px', textAlign: 'center',
                  }}>
                    <div style={{ color: '#64748b', fontSize: '10px', marginBottom: '2px' }}>{label}</div>
                    <div style={{ color: '#f97316', fontSize: '13px', fontWeight: '700' }}>{val}</div>
                    {old && old !== parseInt(val) && (
                      <div style={{ color: '#475569', fontSize: '10px' }}>was {old}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { dismissMacroNotification(user.clientID); setMacroNotif(null); }}
            style={{ background: 'none', border: 'none', color: '#64748b',
              fontSize: '18px', cursor: 'pointer', padding: '2px', flexShrink: 0, lineHeight: 1 }}>
            ×
          </button>
        </div>
      )}

      {/* Date + greeting */}
      <div style={{ marginBottom: '22px' }}>
        <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.9px' }}>
          {dateLabel}
        </div>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#f8fafc', lineHeight: 1.2 }}
          dangerouslySetInnerHTML={{ __html: `${greeting}, ${firstName} ${greetEmoji}` }}
        />
      </div>

      {/* Workout card */}
      {loading ? <Skeleton height={116} /> : todayLog
        ? <CompletionCard log={todayLog} />
        : <WorkoutCard program={program} profile={clientProfile} onStart={() => navigate('/client/training')} />
      }

      {/* Calorie ring + macro bars */}
      <div style={{
        background: '#1e293b', borderRadius: '16px', padding: '18px 20px',
        marginBottom: '12px', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#f8fafc', marginBottom: '2px' }}>Nutrition Today</div>
            <div style={{ fontSize: '12px', color: '#475569' }}>
              {loading ? '...' : `${nutritionLogs.length} meal${nutritionLogs.length !== 1 ? 's' : ''} logged`}
            </div>
          </div>
          <button onClick={() => openModal(setShowQuickLog, setQlVisible)} style={{
            background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)',
            borderRadius: '8px', color: '#f97316', fontSize: '12px', fontWeight: '700',
            padding: '8px 13px', cursor: 'pointer',
          }}>+ Log Meal</button>
        </div>
        {loading ? (
          <div style={{ height: '136px', background: 'rgba(255,255,255,0.04)', borderRadius: '12px', animation: 'skeletonPulse 1.6s infinite' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <CircularProgress consumed={Math.round(totals.calories)} target={targets.calories} />
            <div style={{ flex: 1 }}>
              <MacroBar label="Protein" consumed={totals.protein} target={targets.protein} color="#3b82f6" />
              <MacroBar label="Carbs"   consumed={totals.carbs}   target={targets.carbs}   color="#f59e0b" />
              <MacroBar label="Fats"    consumed={totals.fats}    target={targets.fats}    color="#f43f5e" />
            </div>
          </div>
        )}
      </div>

      {/* Weight */}
      <div style={{
        background: '#1e293b', borderRadius: '16px', padding: '16px 20px',
        marginBottom: '12px', border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#f8fafc' }}>
            {todayWeight ? `${todayWeight.WeightKg ? todayWeight.WeightKg + ' kg' : 'Weight'} logged ✓` : "Log today's weight"}
          </div>
          <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
            {todayWeight ? 'Great work tracking progress' : 'Daily check-in keeps you on track'}
          </div>
        </div>
        {!todayWeight ? (
          <button onClick={() => openModal(setShowWeightLog, setWlVisible)} style={{
            background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.25)',
            borderRadius: '8px', color: '#f97316', fontSize: '12px', fontWeight: '700',
            padding: '8px 14px', cursor: 'pointer', flexShrink: 0,
          }}>Log</button>
        ) : (
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%',
            background: 'rgba(34,197,94,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#22c55e', fontSize: '14px', fontWeight: '700', flexShrink: 0,
          }}>&#x2713;</div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '12px', padding: '12px 16px', marginBottom: '12px',
          fontSize: '13px', color: '#fca5a5',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button onClick={fetchData} style={{
            background: 'rgba(239,68,68,0.15)', border: 'none',
            borderRadius: '6px', color: '#fca5a5', fontSize: '12px',
            fontWeight: '700', padding: '5px 10px', cursor: 'pointer',
          }}>Retry</button>
        </div>
      )}

      {/* Motivational message */}
      <div style={{
        background: 'linear-gradient(135deg,rgba(249,115,22,0.09),rgba(234,88,12,0.04))',
        borderRadius: '14px', padding: '16px 18px',
        border: '1px solid rgba(249,115,22,0.14)',
      }}>
        <div style={{ fontSize: '10px', color: '#f97316', fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Daily Message
        </div>
        <div style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: 1.55, fontStyle: 'italic' }}>
          &ldquo;{motivational}&rdquo;
        </div>
      </div>

      {/* ── Quick Log Modal ── */}
      {showQuickLog && (
        <div
          onClick={() => closeModal(setShowQuickLog, setQlVisible)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: qlVisible ? 'rgba(0,0,0,0.65)' : 'transparent',
            backdropFilter: qlVisible ? 'blur(2px)' : 'none',
            WebkitBackdropFilter: qlVisible ? 'blur(2px)' : 'none',
            transition: 'background 0.25s ease',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '430px', margin: '0 auto',
            background: '#1e293b', borderRadius: '20px 20px 0 0',
            padding: '0 20px 36px',
            border: '1px solid rgba(255,255,255,0.09)',
            transform: qlVisible ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.32s cubic-bezier(0.16,1,0.3,1)',
          }}>
            <div style={{ width: '36px', height: '4px', background: '#334155', borderRadius: '2px', margin: '14px auto 22px' }} />
            <div style={{ fontSize: '19px', fontWeight: '800', marginBottom: '20px' }}>Log a Meal</div>
            {[
              { key: 'meal',     label: 'Meal name',   placeholder: 'e.g. Chicken & rice', type: 'text' },
              { key: 'calories', label: 'Calories',    placeholder: '0', type: 'number' },
              { key: 'protein',  label: 'Protein (g)', placeholder: '0', type: 'number' },
              { key: 'carbs',    label: 'Carbs (g)',   placeholder: '0', type: 'number' },
              { key: 'fats',     label: 'Fats (g)',    placeholder: '0', type: 'number' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{f.label}</label>
                <input type={f.type} placeholder={f.placeholder}
                  value={qlForm[f.key]}
                  onChange={e => setQlForm(p => ({ ...p, [f.key]: e.target.value }))}
                  inputMode={f.type === 'number' ? 'decimal' : 'text'}
                  style={inputStyle}
                />
              </div>
            ))}
            <button onClick={handleQuickLogSubmit} disabled={qlSaving || !qlForm.calories} style={{
              width: '100%', padding: '14px', marginTop: '6px',
              background: qlSaving || !qlForm.calories ? 'rgba(249,115,22,0.28)' : '#f97316',
              border: 'none', borderRadius: '12px',
              color: '#fff', fontSize: '15px', fontWeight: '700',
              cursor: qlSaving || !qlForm.calories ? 'not-allowed' : 'pointer',
            }}>{qlSaving ? 'Saving…' : 'Save Meal'}</button>
          </div>
        </div>
      )}

      {/* ── Weight Log Modal ── */}
      {showWeightLog && (
        <div
          onClick={() => closeModal(setShowWeightLog, setWlVisible)}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: wlVisible ? 'rgba(0,0,0,0.65)' : 'transparent',
            backdropFilter: wlVisible ? 'blur(2px)' : 'none',
            WebkitBackdropFilter: wlVisible ? 'blur(2px)' : 'none',
            transition: 'background 0.25s ease',
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '430px', margin: '0 auto',
            background: '#1e293b', borderRadius: '20px 20px 0 0',
            padding: '0 20px 36px',
            border: '1px solid rgba(255,255,255,0.09)',
            transform: wlVisible ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.32s cubic-bezier(0.16,1,0.3,1)',
          }}>
            <div style={{ width: '36px', height: '4px', background: '#334155', borderRadius: '2px', margin: '14px auto 22px' }} />
            <div style={{ fontSize: '19px', fontWeight: '800', marginBottom: '4px' }}>Log Weight</div>
            <div style={{ fontSize: '13px', color: '#475569', marginBottom: '22px' }}>Daily tracking keeps you on course</div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Weight (kg)</label>
            <input type="number" inputMode="decimal"
              placeholder={clientProfile?.CurrentWeightKg || '70.0'}
              value={wlWeight} onChange={e => setWlWeight(e.target.value)}
              autoFocus
              style={{ ...inputStyle, fontSize: '22px', fontWeight: '700', textAlign: 'center', marginBottom: '16px', padding: '14px' }}
            />
            <button onClick={handleWeightSubmit} disabled={wlSaving || !wlWeight} style={{
              width: '100%', padding: '14px',
              background: wlSaving || !wlWeight ? 'rgba(249,115,22,0.28)' : '#f97316',
              border: 'none', borderRadius: '12px',
              color: '#fff', fontSize: '15px', fontWeight: '700',
              cursor: wlSaving || !wlWeight ? 'not-allowed' : 'pointer',
            }}>{wlSaving ? 'Saving…' : 'Save Weight'}</button>
          </div>
        </div>
      )}

    </div>
  );
}
