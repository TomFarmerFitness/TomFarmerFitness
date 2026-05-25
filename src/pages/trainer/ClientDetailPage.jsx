import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { readSheet } from '../../utils/sheets';

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
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

function MacroBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '12px', fontWeight: '600', color: '#e2e8f0' }}>{value}g</span>
      </div>
      <div style={{ height: '5px', background: 'rgba(255,255,255,0.07)', borderRadius: '99px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '99px', transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ─── Mini Weight Chart (trainer view) ────────────────────────────────────────

function TrainerWeightChart({ entries, targetWeight }) {
  if (entries.length === 0) {
    return <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>No weight entries logged yet.</div>;
  }
  const data = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ date: e.date, label: fmtShort(e.date), weight: parseFloat(e.weight) }))
    .filter(d => !isNaN(d.weight));

  const weights = data.map(d => d.weight);
  if (targetWeight) weights.push(parseFloat(targetWeight));
  const minW = Math.floor(Math.min(...weights) - 2);
  const maxW = Math.ceil(Math.max(...weights)  + 2);

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis domain={[minW, maxW]} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={v => [`${v} kg`, 'Weight']}
        />
        {targetWeight && (
          <ReferenceLine y={parseFloat(targetWeight)} stroke="#f59e0b" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: `Goal ${targetWeight}kg`, fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
        )}
        <Line type="monotone" dataKey="weight" stroke="#22c55e" strokeWidth={2} dot={data.length <= 15} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Mini Photo Gallery (trainer view) ───────────────────────────────────────

function TrainerPhotoGallery({ photos, onViewPhoto }) {
  if (photos.length === 0) {
    return <div style={{ color: '#475569', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>No progress photos yet.</div>;
  }

  // Group by month, show most recent first
  const sorted  = [...photos].sort((a, b) => b.date.localeCompare(a.date));
  const grouped = {};
  sorted.forEach(p => {
    const m = fmtMonthYear(p.date);
    if (!grouped[m]) grouped[m] = [];
    grouped[m].push(p);
  });

  return (
    <div>
      {Object.entries(grouped).map(([month, ps]) => (
        <div key={month} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{month}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ps.map(photo => (
              <div key={photo.photoId}
                onClick={() => onViewPhoto(photo)}
                style={{ position: 'relative', width: 80, height: 108, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', flexShrink: 0 }}>
                <img src={photo.driveThumbURL || photo.driveViewURL} alt={photo.photoType}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                  padding: '12px 4px 4px',
                  fontSize: 10, color: '#fff', textAlign: 'center',
                }}>
                  {photo.photoType}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Photo Lightbox for trainer ───────────────────────────────────────────────

function TrainerPhotoViewer({ photo, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <button onClick={onClose} style={{
        position: 'absolute', top: 20, right: 20,
        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
        width: 36, height: 36, cursor: 'pointer', color: '#fff', fontSize: 20,
      }}>×</button>
      <img src={photo.driveViewURL} alt={photo.photoType}
        style={{ maxWidth: '90%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }}
        onClick={e => e.stopPropagation()} />
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>{photo.photoType} · {format(new Date(photo.date + 'T12:00:00'), 'MMM d, yyyy')}</div>
        {photo.note && <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{photo.note}</div>}
        <a href={photo.driveViewURL} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', marginTop: 8, fontSize: 13, color: '#60a5fa' }}
          onClick={e => e.stopPropagation()}>
          Open in Drive ↗
        </a>
      </div>
    </div>
  );
}

// ─── ClientDetailPage ─────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate     = useNavigate();
  const [client,        setClient]       = useState(null);
  const [logs,          setLogs]         = useState([]);
  const [weightEntries, setWeightEntries] = useState([]);
  const [photos,        setPhotos]       = useState([]);
  const [loading,       setLoading]      = useState(true);
  const [error,         setError]        = useState(null);
  const [viewingPhoto,  setViewingPhoto] = useState(null);
  const [activeSection, setActiveSection] = useState('overview'); // 'overview' | 'progress'

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [clients, workoutLogs, bodyMetrics, progressPhotos] = await Promise.all([
          readSheet('Clients'),
          readSheet('WorkoutLogs'),
          readSheet('BodyMetrics'),
          readSheet('ProgressPhotos').catch(() => []),
        ]);

        const found = clients.find(c => c.ClientID === clientId);
        if (!found) { setError('Client not found.'); return; }
        setClient(found);

        setLogs(workoutLogs.filter(l => l.ClientID === clientId).sort((a, b) => {
          const da = parseDate(a.Date), db = parseDate(b.Date);
          if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
          return db - da;
        }));

        setWeightEntries(
          bodyMetrics
            .filter(r => r.ClientID === clientId)
            .map(r => ({ metricId: r.MetricID, date: (r.Date || '').slice(0,10), weight: r.Weight, bodyFat: r.BodyFat, notes: r.Notes }))
            .filter(r => r.date && r.weight)
        );

        setPhotos(
          progressPhotos
            .filter(r => r.ClientID === clientId)
            .map(r => ({ photoId: r.PhotoID, date: (r.Date || '').slice(0,10), photoType: r.PhotoType, note: r.Note, driveViewURL: r.DriveViewURL, driveThumbURL: r.DriveThumbURL }))
            .filter(r => r.date && r.driveViewURL)
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#64748b', fontSize: '14px' }}>
      <span style={{ display: 'inline-block', width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading client...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (error || !client) return (
    <div>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', padding: 0 }}>← Back</button>
      <div style={{ color: '#fca5a5' }}>{error || 'Client not found.'}</div>
    </div>
  );

  const completedLogs   = logs.filter(l => l.Status === 'Completed');
  const fourWeeksAgo    = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const recentCompleted = completedLogs.filter(l => { const d = parseDate(l.Date); return d && d >= fourWeeksAgo; }).length;
  const expected        = Number(client.TrainingDaysPerWeek || 3) * 4;
  const compliancePct   = expected > 0 ? Math.round((recentCompleted / expected) * 100) : 0;
  const dotColor        = compliancePct >= 80 ? '#22c55e' : compliancePct >= 50 ? '#f59e0b' : '#ef4444';
  const lastLog         = completedLogs[0];

  const sortedWeights   = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
  const currentWeight   = sortedWeights.length > 0 ? sortedWeights[sortedWeights.length - 1].weight : null;

  const cardStyle = { background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid rgba(255,255,255,0.06)' };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Back nav */}
      <button onClick={() => navigate('/trainer/dashboard')}
        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '13px', marginBottom: '20px', padding: 0, display: 'flex', alignItems: 'center', gap: '6px', transition: 'color 0.12s' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#f97316'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; }}>
        ← Back to Overview
      </button>

      {/* Client header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div style={{
          width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #1e40af, #7c3aed)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '20px', fontWeight: '700', color: '#fff',
        }}>
          {(client.Name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: '700', margin: 0 }}>{client.Name}</h1>
            <span style={{
              padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '600',
              background: client.Status === 'Active' ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.15)',
              color: client.Status === 'Active' ? '#4ade80' : '#94a3b8',
            }}>{client.Status || 'Unknown'}</span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '12.5px', marginTop: '3px' }}>
            Goal: <strong style={{ color: '#e2e8f0' }}>{client.Goal || '—'}</strong>
            {client.StartDate && <> · Started {format(new Date(client.StartDate), 'MMM d, yyyy')}</>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}60` }} />
          <span style={{ fontSize: '12px', color: dotColor, fontWeight: '600' }}>{compliancePct}% compliance</span>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {[['overview','Overview'],['progress','Progress & Photos']].map(([val, label]) => (
          <button key={val} onClick={() => setActiveSection(val)} style={{
            padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: activeSection === val ? '#f97316' : 'rgba(255,255,255,0.05)',
            color: activeSection === val ? '#fff' : '#64748b',
            transition: 'background 0.15s, color 0.15s',
          }}>{label}</button>
        ))}
      </div>

      {/* ══════════════════ OVERVIEW SECTION ══════════════════ */}
      {activeSection === 'overview' && (
        <>
          {/* Key metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '14px', marginBottom: '28px' }}>
            {[
              { label: 'Current Weight', value: currentWeight ? `${currentWeight} kg` : (client.CurrentWeight ? `${client.CurrentWeight} kg` : '—'), icon: '⚖️' },
              { label: 'Target Weight',  value: client.TargetWeight  ? `${client.TargetWeight} kg`  : '—', icon: '🎯' },
              { label: 'Height',         value: client.Height        ? `${client.Height} cm`         : '—', icon: '📏' },
              { label: 'Age',            value: client.Age           ? `${client.Age} yrs`           : '—', icon: '🎂' },
              { label: 'Training Days',  value: client.TrainingDaysPerWeek ? `${client.TrainingDaysPerWeek}×/week` : '—', icon: '🗓️' },
              { label: 'Last Workout',   value: lastLog ? formatDistanceToNow(parseDate(lastLog.Date), { addSuffix: true }) : 'Not started', icon: '🏋️' },
            ].map(({ label, value, icon }) => (
              <div key={label} style={{ ...cardStyle, padding: '14px 16px' }}>
                <div style={{ fontSize: '18px', marginBottom: '6px' }}>{icon}</div>
                <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#f1f5f9', marginTop: '3px' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '28px' }}>
            {/* Macro targets */}
            <div style={cardStyle}>
              <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 16px' }}>Daily Macro Targets</h3>
              {client.Calories || client.TargetCalories ? (
                <>
                  <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#f97316' }}>{client.TargetCalories || client.Calories}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>kcal / day</div>
                  </div>
                  <MacroBar label="Protein" value={client.TargetProtein || client.Protein || 0} max={250} color="#4ade80" />
                  <MacroBar label="Carbs"   value={client.TargetCarbs   || client.Carbs   || 0} max={400} color="#60a5fa" />
                  <MacroBar label="Fats"    value={client.TargetFats    || client.Fats    || 0} max={120} color="#fbbf24" />
                </>
              ) : (
                <div style={{ color: '#475569', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No macro targets set yet.</div>
              )}
            </div>
            {/* Profile */}
            <div style={cardStyle}>
              <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 16px' }}>Profile</h3>
              {[
                { label: 'Gender',    value: client.Gender },
                { label: 'Equipment', value: client.Equipment },
                { label: 'Program',   value: client.ProgramID || 'None assigned' },
                { label: 'Injuries',  value: client.Injuries  || 'None noted' },
                { label: 'Notes',     value: client.Notes     || '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                  <div style={{ fontSize: '13px', color: '#cbd5e1', marginTop: '2px' }}>{value || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent workout log */}
          <div style={cardStyle}>
            <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 16px' }}>
              Recent Workouts
              <span style={{ fontWeight: '400', color: '#475569', fontSize: '12px', marginLeft: '8px' }}>
                {completedLogs.length} total completed
              </span>
            </h3>
            {logs.length === 0 ? (
              <div style={{ color: '#475569', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No workout logs yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {logs.slice(0, 8).map((log, i) => {
                  const d = parseDate(log.Date);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: log.Status === 'Completed' ? '#22c55e' : '#ef4444' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>Day {log.DayID || '?'} {log.ProgramID ? `· ${log.ProgramID}` : ''}</div>
                        <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                          {log.ExercisesCompleted && log.TotalExercises ? `${log.ExercisesCompleted}/${log.TotalExercises} exercises` : log.Status}
                          {log.Duration ? ` · ${log.Duration} min` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', flexShrink: 0 }}>{d ? format(d, 'MMM d') : ''}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════ MACRO ADJUSTMENT HISTORY ══════════════════ */}
      {activeSection === 'overview' && macroHistory.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 14px',
            display:'flex', alignItems:'center', gap:'8px' }}>
            📊 Macro Adjustment History
            <span style={{ color:'#64748b', fontWeight:400, fontSize:'12px' }}>
              ({macroHistory.length} adjustment{macroHistory.length !== 1 ? 's' : ''})
            </span>
          </h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'10px', maxHeight:'320px', overflowY:'auto' }}>
            {macroHistory.map((adj, i) => (
              <div key={adj.AdjustmentID || i} style={{
                background: 'rgba(255,255,255,0.03)', borderRadius:'8px',
                border: '1px solid rgba(255,255,255,0.06)', padding:'12px',
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'8px', marginBottom:'8px' }}>
                  <div style={{ color:'#94a3b8', fontSize:'11px' }}>{adj.AdjustedAt}</div>
                  <span style={{ padding:'2px 8px', borderRadius:'10px', fontSize:'10px', fontWeight:600,
                    background:'rgba(249,115,22,0.12)', color:'#f97316', flexShrink:0 }}>
                    {adj.Goal}
                  </span>
                </div>
                <div style={{ color:'#cbd5e1', fontSize:'12px', lineHeight:1.5, marginBottom:'8px' }}>
                  {adj.Reason}
                </div>
                {adj.NewCalories && (
                  <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                    {[
                      { label:'Calories', old: adj.OldCalories, new_: adj.NewCalories, unit:'kcal' },
                      { label:'Protein',  old: adj.OldProtein,  new_: adj.NewProtein,  unit:'g' },
                      { label:'Carbs',    old: adj.OldCarbs,    new_: adj.NewCarbs,    unit:'g' },
                      { label:'Fats',     old: adj.OldFats,     new_: adj.NewFats,     unit:'g' },
                    ].map(({ label, old, new_, unit }) => {
                      const diff = parseInt(new_) - parseInt(old);
                      const diffColor = diff > 0 ? '#4ade80' : diff < 0 ? '#f87171' : '#64748b';
                      return (
                        <div key={label} style={{ background:'rgba(0,0,0,0.2)', borderRadius:'6px',
                          padding:'4px 8px', textAlign:'center', minWidth:'56px' }}>
                          <div style={{ color:'#64748b', fontSize:'9px', marginBottom:'1px' }}>{label}</div>
                          <div style={{ color:'#f1f5f9', fontSize:'11px', fontWeight:600 }}>{new_}{unit}</div>
                          {diff !== 0 && (
                            <div style={{ color: diffColor, fontSize:'9px' }}>
                              {diff > 0 ? '+' : ''}{diff}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {adj.WeightTrendKgPerWeek && (
                      <div style={{ background:'rgba(0,0,0,0.2)', borderRadius:'6px',
                        padding:'4px 8px', textAlign:'center', minWidth:'56px' }}>
                        <div style={{ color:'#64748b', fontSize:'9px', marginBottom:'1px' }}>Trend</div>
                        <div style={{ color: parseFloat(adj.WeightTrendKgPerWeek) < 0 ? '#4ade80' : '#f97316',
                          fontSize:'11px', fontWeight:600 }}>
                          {parseFloat(adj.WeightTrendKgPerWeek) > 0 ? '+' : ''}{parseFloat(adj.WeightTrendKgPerWeek).toFixed(2)} kg/wk
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Override modal */}
      {showOverride && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div style={{ background:'#1e293b', borderRadius:'14px', width:'100%', maxWidth:'400px',
            display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'15px' }}>Override Macro Targets</div>
                <div style={{ color:'#64748b', fontSize:'12px', marginTop:'2px' }}>
                  Auto-adjust will pause for 10 days after saving.
                </div>
              </div>
              <button onClick={() => setShowOverride(false)}
                style={{ background:'none', border:'none', color:'#64748b', fontSize:'22px',
                  cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
            </div>
            <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:'12px' }}>
              {[
                { label:'Daily Calories (kcal)', key:'calories' },
                { label:'Protein (g)',           key:'protein'  },
                { label:'Carbohydrates (g)',      key:'carbs'    },
                { label:'Fats (g)',               key:'fats'     },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                    marginBottom:'5px', display:'block' }}>{label.toUpperCase()}</label>
                  <input type="number" min={0} value={overrideForm[key]}
                    onChange={e => setOverrideForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width:'100%', background:'rgba(255,255,255,0.06)',
                      border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                      color:'#f1f5f9', fontSize:'15px', padding:'10px 12px', boxSizing:'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
              display:'flex', gap:'10px' }}>
              <button onClick={() => setShowOverride(false)}
                style={{ flex:1, padding:'11px', background:'rgba(255,255,255,0.06)',
                  border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
                  color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>Cancel</button>
              <button disabled={overrideSaving} onClick={async () => {
                setOverrideSaving(true);
                try {
                  const today = new Date().toISOString().slice(0,10);
                  const pauseUntil = new Date();
                  pauseUntil.setDate(pauseUntil.getDate() + 10);
                  const pauseUntilISO = pauseUntil.toISOString().slice(0,10);

                  // Build updated client row
                  const updatedClient = {
                    ...Object.fromEntries(Object.entries(client)),
                    TargetCalories: overrideForm.calories,
                    TargetProtein:  overrideForm.protein,
                    TargetCarbs:    overrideForm.carbs,
                    TargetFats:     overrideForm.fats,
                    AutoAdjustPausedUntil: pauseUntilISO,
                  };

                  // Write to Clients sheet via proxy
                  const url = config.APPS_SCRIPT_URL;
                  if (url && !url.startsWith('YOUR_')) {
                    await fetch(url, {
                      method:'POST', headers:{'Content-Type':'application/json'},
                      body: JSON.stringify({
                        action:'upsertRow', tab:'Clients',
                        idColumn:'ClientID', id: client.ClientID,
                        row: updatedClient,
                      }),
                    });
                  }

                  // Log the manual override to MacroAdjustments
                  await appendToSheet('MacroAdjustments', {
                    AdjustmentID: `adj-manual-${Date.now()}`,
                    ClientID: client.ClientID,
                    AdjustedAt: today,
                    Goal: client.Goal,
                    OldCalories: client.TargetCalories || '',
                    OldProtein:  client.TargetProtein  || '',
                    OldCarbs:    client.TargetCarbs    || '',
                    OldFats:     client.TargetFats     || '',
                    NewCalories: overrideForm.calories,
                    NewProtein:  overrideForm.protein,
                    NewCarbs:    overrideForm.carbs,
                    NewFats:     overrideForm.fats,
                    Reason: `Manual override by trainer. Auto-adjust paused until ${pauseUntilISO}.`,
                    WeightTrendKgPerWeek: '', NutritionCompliance: '', TrainingCompliance: '',
                  });

                  // Optimistic local update
                  setClient(updatedClient);
                  setMacroHistory(prev => [{
                    AdjustmentID: `adj-manual-${Date.now()}`,
                    ClientID: client.ClientID, AdjustedAt: today, Goal: client.Goal,
                    OldCalories: client.TargetCalories, OldProtein: client.TargetProtein,
                    OldCarbs: client.TargetCarbs, OldFats: client.TargetFats,
                    NewCalories: overrideForm.calories, NewProtein: overrideForm.protein,
                    NewCarbs: overrideForm.carbs, NewFats: overrideForm.fats,
                    Reason: `Manual override by trainer. Auto-adjust paused until ${pauseUntilISO}.`,
                  }, ...prev]);
                  setShowOverride(false);
                } catch (e) {
                  alert('Save failed: ' + e.message);
                } finally {
                  setOverrideSaving(false);
                }
              }}
              style={{ flex:2, padding:'11px', background: overrideSaving ? '#7c3f0a' : '#f97316',
                border:'none', borderRadius:'10px', color:'#fff',
                fontSize:'14px', fontWeight:600, cursor: overrideSaving ? 'default' : 'pointer' }}>
                {overrideSaving ? 'Saving…' : '✓ Save & Pause Auto-Adjust'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════ PROGRESS SECTION ══════════════════ */}
      {activeSection === 'progress' && (
        <>
          {/* Weight chart */}
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 4px' }}>
              Weight Trend
              <span style={{ fontWeight: '400', color: '#475569', fontSize: '12px', marginLeft: '8px' }}>
                {weightEntries.length} {weightEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            </h3>

            {weightEntries.length > 0 && (() => {
              const sorted   = [...weightEntries].sort((a, b) => a.date.localeCompare(b.date));
              const first    = parseFloat(sorted[0].weight);
              const current  = parseFloat(sorted[sorted.length - 1].weight);
              const target   = client.TargetWeight ? parseFloat(client.TargetWeight) : null;
              const change   = +(current - first).toFixed(1);
              return (
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  {[
                    ['Start',   `${first} kg`,   '#94a3b8'],
                    ['Current', `${current} kg`, '#e2e8f0'],
                    ['Change',  `${change > 0 ? '+' : ''}${change} kg`, change < 0 ? '#4ade80' : change > 0 ? '#f87171' : '#94a3b8'],
                    target ? ['Goal', `${target} kg`, '#fbbf24'] : null,
                  ].filter(Boolean).map(([label, val, color]) => (
                    <div key={label}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color }}>{val}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <TrainerWeightChart entries={weightEntries} targetWeight={client.TargetWeight} />
          </div>

          {/* Progress photos */}
          <div style={cardStyle}>
            <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 16px' }}>
              Progress Photos
              <span style={{ fontWeight: '400', color: '#475569', fontSize: '12px', marginLeft: '8px' }}>
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
              </span>
            </h3>
            <TrainerPhotoGallery photos={photos} onViewPhoto={setViewingPhoto} />
          </div>
        </>
      )}

      {/* Photo lightbox */}
      {viewingPhoto && (
        <TrainerPhotoViewer photo={viewingPhoto} onClose={() => setViewingPhoto(null)} />
      )}
    </>
  );
}
