import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { readSheet, upsertRow, appendToSheet, deleteRow, deleteRowsWhere } from '../../utils/sheets';
import config from '../../config';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

// ─── WeeklyVolumePanel ────────────────────────────────────────────────────────
const VOLUME_MUSCLE_ORDER = ['Chest','Back','Shoulders','Arms','Legs','Glutes','Core'];
const VOLUME_COLORS = {
  Chest:'#3b82f6', Back:'#8b5cf6', Shoulders:'#f59e0b',
  Arms:'#ec4899', Legs:'#22c55e', Glutes:'#f97316', Core:'#14b8a6',
};

function computeWeeklyVolume(programDays) {
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

function WeeklyVolumePanel({ program }) {
  if (!program?.DaysJSON) return null;
  let days = [];
  try { days = JSON.parse(program.DaysJSON); } catch { return null; }
  const volume = computeWeeklyVolume(days);
  const hasData = Object.values(volume).some(v => v > 0);
  if (!hasData) return null;
  const TARGET_MIN = 10, TARGET_MAX = 20;
  return (
    <div style={{ background:'rgba(255,255,255,0.02)', borderRadius:10, padding:'14px 16px',
      border:'1px solid rgba(255,255,255,0.05)', marginBottom:16 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ color:'#e2e8f0', fontWeight:600, fontSize:13 }}>Weekly Volume</div>
        <div style={{ color:'#475569', fontSize:11 }}>Target: 10–20 sets / muscle</div>
      </div>
      {VOLUME_MUSCLE_ORDER.filter(m => (volume[m] || 0) > 0).map(muscle => {
        const sets = volume[muscle] || 0;
        const pct  = Math.min((sets / TARGET_MAX) * 100, 100);
        const color = VOLUME_COLORS[muscle] || '#94a3b8';
        const status = sets < TARGET_MIN ? 'under' : sets > TARGET_MAX ? 'over' : 'ok';
        return (
          <div key={muscle} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:12, color:'#94a3b8' }}>{muscle}</span>
              <span style={{ fontSize:12, fontWeight:600,
                color: status==='ok'?'#22c55e':status==='under'?'#f59e0b':'#ef4444' }}>
                {sets} sets{status==='under'?' ↑':status==='over'?' ⚠':' ✓'}
              </span>
            </div>
            <div style={{ height:5, background:'rgba(255,255,255,0.07)', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, borderRadius:99,
                background:status==='ok'?color:status==='under'?'#f59e0b':'#ef4444',
                transition:'width 0.5s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── Lift Progression Panel ────────────────────────────────────────────────────

// ─── ProgramRoadmap (trainer read-only view) ──────────────────────────────────
function ProgramRoadmap({ program, client, logs }) {
  const phases = program?.phases;
  if (!phases || phases.length === 0) return null;

  const [expanded, setExpanded] = useState(null);

  const completedWeeks = new Set();
  (logs || []).forEach(log => {
    if (log.ProgramID === program?.ProgramID && log.Status === 'Completed' && log.WeekNumber) {
      completedWeeks.add(`${log.PhaseIndex || 0}-${log.WeekNumber}`);
    }
  });

  const currentPhaseIdx = parseInt(client?.CurrentPhaseIdx) || 0;
  const currentWeek = parseInt(client?.CurrentWeek) || 1;

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, margin: 0 }}>
          📋 Program Roadmap
        </h3>
        <span style={{ fontSize: 12, color: '#475569' }}>
          {phases.reduce((s, p) => s + (p.weekCount || 4), 0)} weeks · {phases.length} phase{phases.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {phases.map((phase, phaseIdx) => {
          const isCurrentPhase = phaseIdx === currentPhaseIdx;
          const isExpanded = expanded === phase.id || isCurrentPhase;
          const weeksDone = Array.from({ length: phase.weekCount || 4 }, (_, wi) =>
            completedWeeks.has(`${phaseIdx}-${wi + 1}`)
          ).filter(Boolean).length;
          const phaseDone = weeksDone >= (phase.weekCount || 4);
          return (
            <div key={phase.id} style={{
              background: isCurrentPhase ? 'rgba(249,115,22,0.05)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${isCurrentPhase ? 'rgba(249,115,22,0.25)' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 10, overflow: 'hidden',
            }}>
              <button onClick={() => setExpanded(isExpanded ? null : phase.id)}
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: phaseDone ? 'rgba(34,197,94,0.15)' : isCurrentPhase ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${phaseDone ? '#22c55e' : isCurrentPhase ? '#f97316' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: phaseDone ? '#22c55e' : isCurrentPhase ? '#f97316' : '#64748b' }}>
                  {phaseDone ? '✓' : phaseIdx + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600,
                    color: phaseDone ? '#22c55e' : isCurrentPhase ? '#f97316' : '#e2e8f0' }}>
                    {phase.name || `Phase ${phaseIdx + 1}`}
                    {isCurrentPhase && !phaseDone && (
                      <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(249,115,22,0.15)',
                        color: '#f97316', padding: '1px 6px', borderRadius: 20, fontWeight: 600 }}>CURRENT</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                    {phase.weekCount || 4} weeks · {weeksDone}/{phase.weekCount || 4} completed
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {Array.from({ length: phase.weekCount || 4 }, (_, wi) => {
                    const done = completedWeeks.has(`${phaseIdx}-${wi + 1}`);
                    const isCurrent = isCurrentPhase && (wi + 1) === currentWeek;
                    return (
                      <div key={wi} style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: done ? '#22c55e' : isCurrent ? '#f97316' : 'rgba(255,255,255,0.12)' }} />
                    );
                  })}
                </div>
                <span style={{ color: '#475569', fontSize: 11 }}>{isExpanded ? '▲' : '▼'}</span>
              </button>
              {isExpanded && (
                <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {Array.from({ length: phase.weekCount || 4 }, (_, wi) => {
                    const weekNum = wi + 1;
                    const done = completedWeeks.has(`${phaseIdx}-${weekNum}`);
                    const isCurrent = isCurrentPhase && weekNum === currentWeek;
                    return (
                      <div key={wi} style={{ display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 10px', borderRadius: 6,
                        background: isCurrent ? 'rgba(249,115,22,0.08)' : 'transparent' }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                          background: done ? '#22c55e' : isCurrent ? '#f97316' : 'rgba(255,255,255,0.06)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 700,
                          color: done || isCurrent ? '#fff' : '#475569' }}>
                          {done ? '✓' : weekNum}
                        </div>
                        <span style={{ fontSize: 12, color: done ? '#22c55e' : isCurrent ? '#e2e8f0' : '#64748b', fontWeight: isCurrent ? 600 : 400 }}>
                          Week {weekNum}
                          {isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: '#f97316' }}>← Client here</span>}
                          {done && !isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: '#4ade80' }}>✓</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiftProgressionPanel({ logs }) {
  const progressMap = {};
  logs.forEach(log => {
    if (log.Status !== 'Completed') return;
    const dateStr = (log.Date || '').slice(0, 10);
    if (!dateStr) return;
    let exs = [];
    try { exs = JSON.parse(log.ExercisesCompleted || '[]'); } catch {}
    if (!Array.isArray(exs)) return;
    exs.forEach(ex => {
      if (!ex.name) return;
      const key = ex.name;
      const doneSets = (ex.sets || []).filter(s => s.done);
      if (doneSets.length === 0) return;
      const weights = doneSets.map(s => parseFloat(s.weight) || 0).filter(w => w > 0);
      const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
      const totalReps = doneSets.reduce((n, s) => n + (parseInt(s.reps) || 0), 0);
      if (!progressMap[key]) progressMap[key] = [];
      progressMap[key].push({ date: dateStr, maxWeight, totalReps });
    });
  });

  // Sort each exercise's entries by date, keep only those with 2+ entries
  const exercises = Object.entries(progressMap)
    .map(([name, entries]) => ({
      name,
      entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .filter(e => e.entries.length >= 2 && e.entries.some(en => en.maxWeight > 0))
    .sort((a, b) => b.entries.length - a.entries.length)
    .slice(0, 8);

  if (exercises.length === 0) return null;

  return (
    <div style={{
      background: '#1e293b', borderRadius: '12px', padding: '18px 20px',
      border: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px',
    }}>
      <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 14px' }}>
        Lift Progressions
        <span style={{ color: '#475569', fontWeight: '400', fontSize: '12px', marginLeft: '8px' }}>
          {exercises.length} exercise{exercises.length !== 1 ? 's' : ''} tracked
        </span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {exercises.map(({ name, entries }) => {
          const withWeight = entries.filter(e => e.maxWeight > 0);
          const first = withWeight[0]?.maxWeight || 0;
          const last  = withWeight[withWeight.length - 1]?.maxWeight || 0;
          const diff  = +(last - first).toFixed(1);
          const diffColor = diff > 0 ? '#22c55e' : diff < 0 ? '#f87171' : '#94a3b8';
          return (
            <div key={name} style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
              padding: '10px 12px', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{name}</div>
                {diff !== 0 && (
                  <div style={{ fontSize: '12px', fontWeight: '700', color: diffColor }}>
                    {diff > 0 ? '+' : ''}{diff}kg
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                {withWeight.map((en, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{
                      background: i === withWeight.length - 1 ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.07)',
                      border: `1px solid ${i === withWeight.length - 1 ? 'rgba(249,115,22,0.4)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '6px', padding: '3px 8px',
                      fontSize: '12px', fontWeight: '600',
                      color: i === withWeight.length - 1 ? '#f97316' : '#94a3b8',
                    }}>{en.maxWeight}kg</span>
                    {i < withWeight.length - 1 && (
                      <span style={{ fontSize: '9px', color: '#334155' }}>→</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Weekly Sets Panel ─────────────────────────────────────────────────────────
const WEEKLY_MUSCLES = ['Biceps','Triceps','Back','Chest','Shoulders','Quads','Hamstrings','Calves','Core'];

function WeeklySetsPanel({ logs }) {
  // Get current week Mon-Sun
  const today = new Date();
  const dow = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  const setCounts = {};
  WEEKLY_MUSCLES.forEach(m => { setCounts[m] = 0; });

  logs.forEach(log => {
    if (log.Status !== 'Completed') return;
    const d = new Date((log.Date || '').slice(0, 10) + 'T12:00:00');
    if (isNaN(d) || d < mon || d > sun) return;
    let exs = [];
    try { exs = JSON.parse(log.ExercisesCompleted || '[]'); } catch {}
    if (!Array.isArray(exs)) return;
    exs.forEach(ex => {
      const mg = (ex.muscleGroup || '').trim();
      // Match muscle group to our list (case-insensitive partial match)
      const match = WEEKLY_MUSCLES.find(m => m.toLowerCase() === mg.toLowerCase() ||
        mg.toLowerCase().includes(m.toLowerCase()));
      if (!match) return;
      const doneSets = (ex.sets || []).filter(s => s.done).length;
      setCounts[match] = (setCounts[match] || 0) + doneSets;
    });
  });

  const hasData = Object.values(setCounts).some(v => v > 0);

  return (
    <div style={{
      background: '#1e293b', borderRadius: '12px', padding: '18px 20px',
      border: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: 0 }}>
          Weekly Sets by Muscle
        </h3>
        <div style={{ fontSize: '11px', color: '#475569' }}>Target: 10–15 sets</div>
      </div>
      {!hasData ? (
        <div style={{ fontSize: '13px', color: '#475569', textAlign: 'center', padding: '12px 0' }}>
          No sets logged this week yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {WEEKLY_MUSCLES.map(muscle => {
            const sets = setCounts[muscle] || 0;
            const pct = Math.min((sets / 15) * 100, 100);
            const color = sets >= 10 ? '#22c55e' : sets >= 5 ? '#f59e0b' : '#ef4444';
            return (
              <div key={muscle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{muscle}</span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color }}>{sets} sets</span>
                </div>
                <div style={{ height: '5px', background: 'rgba(255,255,255,0.07)', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`, borderRadius: '99px',
                    background: color, transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: '12px', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {[['#22c55e','≥10 sets on track'],['#f59e0b','5–9 building'],['#ef4444','<5 needs work']].map(([c,label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, flexShrink: 0 }} />
                <span style={{ fontSize: '10px', color: '#64748b' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate     = useNavigate();
  const [client,        setClient]       = useState(null);
  const [logs,          setLogs]         = useState([]);
  const [weightEntries, setWeightEntries] = useState([]);
  const [photos,        setPhotos]       = useState([]);
  const [macroHistory,  setMacroHistory] = useState([]);
  const [loading,       setLoading]      = useState(true);
  const [error,         setError]        = useState(null);
  const [viewingPhoto,  setViewingPhoto] = useState(null);
  const [activeSection, setActiveSection] = useState('overview'); // 'overview' | 'progress'
  const [showPwModal,   setShowPwModal]   = useState(false);
  const [newPassword,   setNewPassword]   = useState('');
  const [confirmPw,     setConfirmPw]     = useState('');
  const [pwSaving,      setPwSaving]      = useState(false);
  const [pwError,       setPwError]       = useState('');
  const [pwSuccess,     setPwSuccess]     = useState(false);
  const [showOverride,  setShowOverride]  = useState(false);
  const [overrideForm,  setOverrideForm]  = useState({ calories: '', protein: '', carbs: '', fats: '' });
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [showTDEE,      setShowTDEE]      = useState(false);
  const [tdeeForm,      setTdeeForm]      = useState({ sex: 'male', age: '', weight: '', height: '', activity: '1.55', goal: 'lose_moderate' });
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState({ age: '', targetWeight: '', trainingDaysPerWeek: '', trainingDays: [] });
  const [profileEditSaving, setProfileEditSaving] = useState(false);
  const [statusSaving,  setStatusSaving]  = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting,      setDeleting]      = useState(false);
  const [assignedProgram, setAssignedProgram] = useState(null);
  const [checkins,      setCheckins]      = useState([]);
  const [aiQuestions,   setAiQuestions]   = useState([]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [clients, workoutLogs, bodyMetrics, progressPhotos, macroAdj, progRows, preCheckins, aiQs] = await Promise.all([
          readSheet('Clients'),
          readSheet('WorkoutLogs'),
          readSheet('BodyMetrics').catch(() => []),
          readSheet('ProgressPhotos').catch(() => []),
          readSheet('MacroAdjustments').catch(() => []),
          readSheet('Programs').catch(() => []),
          readSheet('PreWorkoutCheckins').catch(() => []),
          readSheet('AIQuestions').catch(() => []),
        ]);

        const found = clients.find(c => c.ClientID === clientId);
        if (!found) { setError('Client not found.'); return; }
        setClient(found);

        // Find assigned program from client's ProgramID field
        const myProgRaw = found.ProgramID
          ? progRows.find(p => p.ProgramID === found.ProgramID) || null
          : null;
        let myProgram = myProgRaw;
        if (myProgRaw) {
          let phases = null;
          try { phases = myProgRaw.PhasesJSON ? JSON.parse(myProgRaw.PhasesJSON) : null; } catch {}
          myProgram = { ...myProgRaw, phases };
        }
        setAssignedProgram(myProgram);

        setCheckins(
          (preCheckins || [])
            .filter(r => r.ClientID === clientId && r.HasInjury === 'Yes')
            .sort((a, b) => (b.CheckinDate || '').localeCompare(a.CheckinDate || ''))
        );

        setAiQuestions(
          (aiQs || [])
            .filter(r => r.ClientID === clientId && (r.Question || '').startsWith('[IN-WORKOUT NIGGLE]'))
            .sort((a, b) => (b.AskedAt || '').localeCompare(a.AskedAt || ''))
        );

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

        setMacroHistory(
          (macroAdj || [])
            .filter(r => r.ClientID === clientId)
            .sort((a, b) => (b.AdjustmentDate || '').localeCompare(a.AdjustmentDate || ''))
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}60` }} />
            <span style={{ fontSize: '12px', color: dotColor, fontWeight: '600' }}>{compliancePct}% compliance</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Active / Inactive toggle */}
            <button disabled={statusSaving} onClick={async () => {
              const newStatus = client.Status === 'Active' ? 'Inactive' : 'Active';
              setStatusSaving(true);
              try {
                await upsertRow('Clients', 'ClientID', client.ClientID, { ...client, Status: newStatus });
                setClient(c => ({ ...c, Status: newStatus }));
              } catch (e) { alert('Failed to update status: ' + e.message); }
              finally { setStatusSaving(false); }
            }} style={{
              padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: statusSaving ? 'not-allowed' : 'pointer', border: 'none',
              background: client.Status === 'Active' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              color: client.Status === 'Active' ? '#4ade80' : '#f87171',
            }}>
              {statusSaving ? '…' : client.Status === 'Active' ? '✓ Active — Pause' : '⏸ Inactive — Activate'}
            </button>
            {/* Change password */}
            <button onClick={() => { setShowPwModal(true); setNewPassword(''); setConfirmPw(''); setPwError(''); setPwSuccess(false); }}
              style={{ padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.08)', color: '#f97316', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              🔑 Password
            </button>
            {/* Delete */}
            <button onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); }}
              style={{ padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              🗑 Delete
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {showDeleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget && !deleting) setShowDeleteModal(false); }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '420px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div style={{ fontSize: '28px', textAlign: 'center', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: '700', margin: '0 0 8px', textAlign: 'center' }}>Delete {client.Name}?</h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 20px', textAlign: 'center', lineHeight: 1.5 }}>
              This will permanently delete the client and <strong style={{ color: '#f87171' }}>all their data</strong> — workouts, nutrition logs, weight history, photos, and messages. This cannot be undone.
            </p>
            <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 8px' }}>
              Type <strong style={{ color: '#e2e8f0' }}>{client.Name}</strong> to confirm:
            </p>
            <input
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder={client.Name}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', fontSize: '14px', boxSizing: 'border-box', marginBottom: '18px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button disabled={deleting} onClick={() => setShowDeleteModal(false)}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                Cancel
              </button>
              <button
                disabled={deleting || deleteConfirmText !== client.Name}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const id = client.ClientID;
                    await Promise.all([
                      deleteRow('Clients', 'ClientID', id),
                      deleteRowsWhere('WorkoutLogs',      'ClientID', id),
                      deleteRowsWhere('ExerciseLogs',     'ClientID', id),
                      deleteRowsWhere('NutritionLogs',    'ClientID', id),
                      deleteRowsWhere('BodyMetrics',      'ClientID', id),
                      deleteRowsWhere('ProgressPhotos',   'ClientID', id),
                      deleteRowsWhere('MacroAdjustments', 'ClientID', id),
                      deleteRowsWhere('AIQuestions',      'ClientID', id),
                    ]);
                    navigate('/trainer/clients');
                  } catch (e) {
                    alert('Delete failed: ' + e.message);
                    setDeleting(false);
                  }
                }}
                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: '600', cursor: deleting || deleteConfirmText !== client.Name ? 'not-allowed' : 'pointer', background: deleting || deleteConfirmText !== client.Name ? 'rgba(239,68,68,0.3)' : '#ef4444', color: '#fff' }}>
                {deleting ? 'Deleting…' : 'Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Password Modal ── */}
      {showPwModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) setShowPwModal(false); }}>
          <div style={{ background: '#1e293b', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: '700', margin: '0 0 6px' }}>Change Password</h3>
            <p style={{ color: '#64748b', fontSize: '13px', margin: '0 0 20px' }}>Set a new password for {client.Name}</p>
            {pwSuccess ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>✅</div>
                <div style={{ color: '#4ade80', fontWeight: '600' }}>Password updated successfully</div>
                <button onClick={() => setShowPwModal(false)} style={{ marginTop: '16px', padding: '8px 20px', borderRadius: '8px', border: 'none', background: '#f97316', color: '#fff', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>Done</button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>Confirm Password</label>
                  <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Confirm new password"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: '#f1f5f9', fontSize: '14px', boxSizing: 'border-box' }} />
                </div>
                {pwError && <div style={{ color: '#fca5a5', fontSize: '13px', marginBottom: '14px' }}>{pwError}</div>}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setShowPwModal(false)}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                    Cancel
                  </button>
                  <button disabled={pwSaving} onClick={async () => {
                    setPwError('');
                    if (!newPassword || newPassword.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
                    if (newPassword !== confirmPw) { setPwError('Passwords do not match.'); return; }
                    setPwSaving(true);
                    try {
                      const hash = await sha256(newPassword);
                      await upsertRow('Clients', 'ClientID', client.ClientID, { ...client, PasswordHash: hash });
                      setPwSuccess(true);
                    } catch (e) {
                      setPwError('Failed to update password. Please try again.');
                    } finally {
                      setPwSaving(false);
                    }
                  }} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: pwSaving ? '#7c3aed' : '#f97316', color: '#fff', fontWeight: '600', cursor: pwSaving ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
                    {pwSaving ? 'Saving…' : 'Save Password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
                <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: 0 }}>Daily Macro Targets</h3>
                <div style={{ display:'flex', gap:'6px' }}>
                  <button
                    onClick={() => {
                      setTdeeForm({
                        sex:      (client.Gender || 'male').toLowerCase(),
                        age:      client.Age || '',
                        weight:   currentWeight || client.CurrentWeight || '',
                        height:   client.Height || '',
                        activity: '1.55',
                        goal:     'lose_moderate',
                      });
                      setShowTDEE(true);
                    }}
                    style={{ padding:'5px 12px', borderRadius:'8px', border:'none',
                      background:'rgba(59,130,246,0.12)', color:'#60a5fa',
                      fontSize:'12px', fontWeight:600, cursor:'pointer' }}>
                    🧮 TDEE
                  </button>
                  <button
                    onClick={() => {
                      setOverrideForm({
                        calories: client.DailyCalories || client.TargetCalories || '',
                        protein:  client.ProteinTarget || client.TargetProtein   || '',
                        carbs:    client.CarbTarget    || client.TargetCarbs     || '',
                        fats:     client.FatTarget     || client.TargetFats      || '',
                      });
                      setShowOverride(true);
                    }}
                    style={{ padding:'5px 12px', borderRadius:'8px', border:'none',
                      background:'rgba(249,115,22,0.1)', color:'#f97316',
                      fontSize:'12px', fontWeight:600, cursor:'pointer' }}>
                    ✏️ Edit
                  </button>
                </div>
              </div>
              {client.DailyCalories || client.TargetCalories ? (
                <>
                  <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#f97316' }}>{client.DailyCalories || client.TargetCalories}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>kcal / day</div>
                  </div>
                  <MacroBar label="Protein" value={client.ProteinTarget || client.TargetProtein || 0} max={250} color="#4ade80" />
                  <MacroBar label="Carbs"   value={client.CarbTarget    || client.TargetCarbs   || 0} max={400} color="#60a5fa" />
                  <MacroBar label="Fats"    value={client.FatTarget     || client.TargetFats    || 0} max={120} color="#fbbf24" />
                </>
              ) : (
                <div style={{ color: '#475569', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No macro targets set yet.</div>
              )}
            </div>
            {/* Profile */}
            <div style={cardStyle}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
                <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: 0 }}>Profile</h3>
                <button
                  onClick={() => {
                    const days = client.TrainingDays
                      ? client.TrainingDays.split(',').map(d => d.trim()).filter(Boolean)
                      : [];
                    setProfileEditForm({
                      age: client.Age || '',
                      targetWeight: client.TargetWeight || '',
                      trainingDaysPerWeek: client.TrainingDaysPerWeek || '',
                      trainingDays: days,
                    });
                    setShowProfileEdit(true);
                  }}
                  style={{ padding:'5px 12px', borderRadius:'8px', border:'none',
                    background:'rgba(249,115,22,0.1)', color:'#f97316',
                    fontSize:'12px', fontWeight:600, cursor:'pointer' }}>
                  ✏️ Edit
                </button>
              </div>
              {[
                { label: 'Gender',    value: client.Gender },
                { label: 'Equipment', value: client.Equipment },
                { label: 'Program',   value: assignedProgram ? assignedProgram.Name || assignedProgram.ProgramID : 'None assigned' },
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

          {/* Program Roadmap */}
          {assignedProgram?.phases && (
            <ProgramRoadmap program={assignedProgram} client={client} logs={logs} />
          )}

          {/* Weekly volume */}
          {assignedProgram && <WeeklyVolumePanel program={assignedProgram} />}

          {/* Lift progressions */}
          <LiftProgressionPanel logs={logs} />

          {/* Weekly sets by muscle */}
          <WeeklySetsPanel logs={logs} />

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
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{log.WorkoutName || 'Workout'}</div>
                        <div style={{ fontSize: '11.5px', color: '#64748b' }}>
                          {log.TotalSets ? `${log.TotalSets} sets` : log.Status || 'Completed'}
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

      {/* ══════════════════ HEALTH FLAGS ══════════════════ */}
      {activeSection === 'overview' && (
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', margin: '0 0 14px',
            display: 'flex', alignItems: 'center', gap: '8px' }}>
            🏥 Health Flags
          </h3>
          {checkins.length === 0 && aiQuestions.length === 0 ? (
            <div style={{ color: '#475569', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>
              No health flags reported.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                ...checkins.slice(0, 5).map(c => ({
                  type: 'injury',
                  date: c.CheckinDate,
                  text: c.InjuryNotes || 'Injury reported',
                  extra: c.EnergyLevel ? `Energy: ${c.EnergyLevel}/10` : '',
                })),
                ...aiQuestions.slice(0, 5).map(q => ({
                  type: 'niggle',
                  date: (q.AskedAt || '').slice(0, 10),
                  text: (q.Question || '').replace('[IN-WORKOUT NIGGLE]', '').trim(),
                  extra: '',
                })),
              ]
              .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
              .slice(0, 5)
              .map((flag, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: '10px',
                  background: flag.type === 'injury' ? 'rgba(251,146,60,0.08)' : 'rgba(234,179,8,0.08)',
                  border: `1px solid ${flag.type === 'injury' ? 'rgba(251,146,60,0.25)' : 'rgba(234,179,8,0.25)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700',
                      color: flag.type === 'injury' ? '#fb923c' : '#eab308' }}>
                      {flag.type === 'injury' ? '⚠️ Pre-workout Injury Flag' : '🤕 In-workout Niggle'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#475569' }}>{flag.date}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#cbd5e1' }}>{flag.text}</div>
                  {flag.extra && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>{flag.extra}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
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

      {/* ── TDEE Calculator modal ── */}
      {showTDEE && (() => {
        const sex    = tdeeForm.sex;
        const age    = parseFloat(tdeeForm.age)    || 0;
        const kg     = parseFloat(tdeeForm.weight) || 0;
        const cm     = parseFloat(tdeeForm.height) || 0;
        const act    = parseFloat(tdeeForm.activity) || 1.55;
        const ready  = age > 0 && kg > 0 && cm > 0;

        // Mifflin-St Jeor BMR
        const bmr  = ready ? Math.round((10 * kg) + (6.25 * cm) - (5 * age) + (sex === 'male' ? 5 : -161)) : 0;
        const tdee = ready ? Math.round(bmr * act) : 0;

        // Goal calorie adjustments
        const goalDeltas = {
          lose_aggressive: -750, lose_moderate: -500, lose_mild: -250,
          maintain: 0,
          gain_mild: 250, gain_moderate: 500,
        };
        const delta    = goalDeltas[tdeeForm.goal] || 0;
        const targetCal = Math.max(1200, tdee + delta);

        // Macro split: protein first, then fat, then carbs fill the rest
        const proteinG  = ready ? Math.round(kg * (tdeeForm.goal.includes('lose') ? 2.2 : 2.0)) : 0;
        const fatPct    = tdeeForm.goal === 'maintain' ? 0.30 : 0.25;
        const fatG      = ready ? Math.round((targetCal * fatPct) / 9) : 0;
        const carbCals  = targetCal - (proteinG * 4) - (fatG * 9);
        const carbG     = ready ? Math.max(0, Math.round(carbCals / 4)) : 0;

        const inp = { width:'100%', boxSizing:'border-box', padding:'9px 11px',
          background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
          borderRadius:'8px', color:'#f1f5f9', fontSize:'14px' };
        const lbl = { color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
          marginBottom:'5px', display:'block', textTransform:'uppercase' };

        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1000,
            display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}
            onClick={e => { if (e.target === e.currentTarget) setShowTDEE(false); }}>
            <div style={{ background:'#1e293b', borderRadius:'16px', width:'100%', maxWidth:'480px',
              maxHeight:'90vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>

              {/* Header */}
              <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:'#f1f5f9', fontSize:'16px', fontWeight:700 }}>🧮 TDEE Calculator</div>
                  <div style={{ color:'#64748b', fontSize:'12px', marginTop:2 }}>Total Daily Energy Expenditure · Mifflin-St Jeor</div>
                </div>
                <button onClick={() => setShowTDEE(false)} style={{ background:'none', border:'none',
                  color:'#64748b', fontSize:'22px', cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
              </div>

              <div style={{ padding:'18px 20px', display:'flex', flexDirection:'column', gap:'14px' }}>

                {/* Sex + Age row */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  <div>
                    <label style={lbl}>Sex</label>
                    <select value={tdeeForm.sex} onChange={e => setTdeeForm(f => ({ ...f, sex: e.target.value }))} style={{ ...inp, cursor:'pointer' }}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Age (years)</label>
                    <input type="number" min={10} max={100} placeholder="e.g. 32" style={inp}
                      value={tdeeForm.age} onChange={e => setTdeeForm(f => ({ ...f, age: e.target.value }))} />
                  </div>
                </div>

                {/* Weight + Height row */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  <div>
                    <label style={lbl}>Weight (kg)</label>
                    <input type="number" min={30} max={300} placeholder="e.g. 85" style={inp}
                      value={tdeeForm.weight} onChange={e => setTdeeForm(f => ({ ...f, weight: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Height (cm)</label>
                    <input type="number" min={100} max={250} placeholder="e.g. 178" style={inp}
                      value={tdeeForm.height} onChange={e => setTdeeForm(f => ({ ...f, height: e.target.value }))} />
                  </div>
                </div>

                {/* Activity level */}
                <div>
                  <label style={lbl}>Activity Level</label>
                  <select value={tdeeForm.activity} onChange={e => setTdeeForm(f => ({ ...f, activity: e.target.value }))} style={{ ...inp, cursor:'pointer' }}>
                    <option value="1.2">Sedentary — desk job, little/no exercise</option>
                    <option value="1.375">Lightly Active — exercise 1–3 days/week</option>
                    <option value="1.55">Moderately Active — exercise 3–5 days/week</option>
                    <option value="1.725">Very Active — hard exercise 6–7 days/week</option>
                    <option value="1.9">Extra Active — physical job + daily training</option>
                  </select>
                </div>

                {/* Goal */}
                <div>
                  <label style={lbl}>Goal</label>
                  <select value={tdeeForm.goal} onChange={e => setTdeeForm(f => ({ ...f, goal: e.target.value }))} style={{ ...inp, cursor:'pointer' }}>
                    <option value="lose_aggressive">Aggressive Fat Loss (−750 kcal · ~0.85kg/wk)</option>
                    <option value="lose_moderate">Moderate Fat Loss (−500 kcal · ~0.5kg/wk)</option>
                    <option value="lose_mild">Mild Fat Loss (−250 kcal · ~0.25kg/wk)</option>
                    <option value="maintain">Maintain Weight</option>
                    <option value="gain_mild">Lean Bulk (+250 kcal · ~0.25kg/wk)</option>
                    <option value="gain_moderate">Moderate Bulk (+500 kcal · ~0.5kg/wk)</option>
                  </select>
                </div>

                {/* Results */}
                {ready && (
                  <div style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
                    borderRadius:'12px', padding:'16px', marginTop:'2px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'14px' }}>
                      {[
                        { label:'BMR', value:`${bmr.toLocaleString()} kcal`, sub:'Base metabolic rate', color:'#94a3b8' },
                        { label:'TDEE', value:`${tdee.toLocaleString()} kcal`, sub:'Maintenance calories', color:'#60a5fa' },
                        { label:'Target', value:`${targetCal.toLocaleString()} kcal`, sub: delta === 0 ? 'Maintenance' : delta > 0 ? `+${delta} surplus` : `${delta} deficit`, color:'#f97316' },
                      ].map(({ label, value, sub, color }) => (
                        <div key={label} style={{ textAlign:'center', padding:'10px 6px',
                          background:'rgba(0,0,0,0.2)', borderRadius:'8px' }}>
                          <div style={{ fontSize:'11px', color:'#475569', marginBottom:'4px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
                          <div style={{ fontSize:'16px', fontWeight:'700', color }}>{value}</div>
                          <div style={{ fontSize:'10px', color:'#475569', marginTop:'3px' }}>{sub}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize:'12px', color:'#64748b', marginBottom:'10px', textAlign:'center' }}>Suggested macros</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px' }}>
                      {[
                        { label:'Protein', value:`${proteinG}g`, color:'#4ade80', note:'2.2g/kg (loss) · 2.0g/kg (gain)' },
                        { label:'Carbs',   value:`${carbG}g`,    color:'#60a5fa', note:'Fills remaining calories' },
                        { label:'Fats',    value:`${fatG}g`,     color:'#fbbf24', note: tdeeForm.goal === 'maintain' ? '30% of calories' : '25% of calories' },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ textAlign:'center', padding:'8px 4px',
                          background:'rgba(0,0,0,0.2)', borderRadius:'8px' }}>
                          <div style={{ fontSize:'18px', fontWeight:'700', color }}>{value}</div>
                          <div style={{ fontSize:'10px', color:'#64748b', textTransform:'uppercase' }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!ready && (
                  <div style={{ textAlign:'center', padding:'20px', color:'#475569', fontSize:'13px',
                    background:'rgba(255,255,255,0.03)', borderRadius:'10px' }}>
                    Fill in age, weight and height to see the calculation
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
                display:'flex', gap:'10px' }}>
                <button onClick={() => setShowTDEE(false)}
                  style={{ flex:1, padding:'11px', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
                    color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>Cancel</button>
                <button
                  onClick={() => {
                    setOverrideForm({
                      calories: String(targetCal),
                      protein:  String(proteinG),
                      carbs:    String(carbG),
                      fats:     String(fatG),
                    });
                    setShowTDEE(false);
                    setShowOverride(true);
                  }}
                  style={{ flex:2, padding:'11px', borderRadius:'10px', border:'none',
                    background: ready ? '#f97316' : 'rgba(249,115,22,0.3)',
                    color: ready ? '#fff' : '#9a5c1e', fontSize:'14px', fontWeight:700,
                    cursor: ready ? 'pointer' : 'not-allowed' }}>
                  Apply to Client →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              {/* Macro inputs — calories auto-calculated */}
              {[
                { label:'Protein (g)',      key:'protein' },
                { label:'Carbohydrates (g)', key:'carbs'  },
                { label:'Fats (g)',          key:'fats'   },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                    marginBottom:'5px', display:'block' }}>{label.toUpperCase()}</label>
                  <input type="number" min={0} value={overrideForm[key]}
                    onChange={e => {
                      const val = e.target.value;
                      setOverrideForm(f => {
                        const p  = parseFloat(key === 'protein' ? val : f.protein) || 0;
                        const c  = parseFloat(key === 'carbs'   ? val : f.carbs)   || 0;
                        const fa = parseFloat(key === 'fats'    ? val : f.fats)    || 0;
                        return { ...f, [key]: val, calories: String(Math.round(p * 4 + c * 4 + fa * 9)) };
                      });
                    }}
                    style={{ width:'100%', background:'rgba(255,255,255,0.06)',
                      border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                      color:'#f1f5f9', fontSize:'15px', padding:'10px 12px', boxSizing:'border-box' }} />
                </div>
              ))}
              {/* Calories — derived from macros, still editable */}
              <div>
                <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                  marginBottom:'5px', display:'block' }}>
                  DAILY CALORIES (KCAL)
                  <span style={{ color:'#22c55e', fontWeight:500, marginLeft:6, textTransform:'none', letterSpacing:0 }}>
                    ← auto-calculated
                  </span>
                </label>
                <input type="number" min={0} value={overrideForm.calories}
                  onChange={e => setOverrideForm(f => ({ ...f, calories: e.target.value }))}
                  style={{ width:'100%', background:'rgba(34,197,94,0.06)',
                    border:'1px solid rgba(34,197,94,0.25)', borderRadius:'8px',
                    color:'#f1f5f9', fontSize:'15px', fontWeight:600, padding:'10px 12px', boxSizing:'border-box' }} />
                <div style={{ fontSize:'11px', color:'#475569', marginTop:'4px' }}>
                  Protein × 4 + Carbs × 4 + Fats × 9
                </div>
              </div>
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

                  // Build updated client row — write to both column-name conventions
                  // so the client app (DailyCalories/ProteinTarget/CarbTarget/FatTarget)
                  // and trainer display (TargetCalories/TargetProtein/TargetCarbs/TargetFats)
                  // both see the updated values.
                  const updatedClient = {
                    ...Object.fromEntries(Object.entries(client)),
                    DailyCalories:  overrideForm.calories,
                    ProteinTarget:  overrideForm.protein,
                    CarbTarget:     overrideForm.carbs,
                    FatTarget:      overrideForm.fats,
                    TargetCalories: overrideForm.calories,
                    TargetProtein:  overrideForm.protein,
                    TargetCarbs:    overrideForm.carbs,
                    TargetFats:     overrideForm.fats,
                    AutoAdjustPausedUntil: pauseUntilISO,
                  };

                  // Write to Clients sheet via proxy
                  await upsertRow('Clients', 'ClientID', client.ClientID, updatedClient);

                  // Log to MacroAdjustments — best-effort, don't fail if tab missing
                  appendToSheet('MacroAdjustments', {
                    AdjustmentID: `adj-manual-${Date.now()}`,
                    ClientID: client.ClientID,
                    AdjustedAt: today,
                    Goal: client.Goal,
                    OldCalories: client.DailyCalories || client.TargetCalories || '',
                    OldProtein:  client.ProteinTarget || client.TargetProtein  || '',
                    OldCarbs:    client.CarbTarget    || client.TargetCarbs    || '',
                    OldFats:     client.FatTarget     || client.TargetFats     || '',
                    NewCalories: overrideForm.calories,
                    NewProtein:  overrideForm.protein,
                    NewCarbs:    overrideForm.carbs,
                    NewFats:     overrideForm.fats,
                    Reason: `Manual override by trainer. Auto-adjust paused until ${pauseUntilISO}.`,
                    WeightTrendKgPerWeek: '', NutritionCompliance: '', TrainingCompliance: '',
                  }).catch(err => console.warn('MacroAdjustments log skipped:', err));

                  // Optimistic local update
                  setClient(updatedClient);
                  setMacroHistory(prev => [{
                    AdjustmentID: `adj-manual-${Date.now()}`,
                    ClientID: client.ClientID, AdjustedAt: today, Goal: client.Goal,
                    OldCalories: client.DailyCalories || client.TargetCalories,
                    OldProtein:  client.ProteinTarget || client.TargetProtein,
                    OldCarbs:    client.CarbTarget    || client.TargetCarbs,
                    OldFats:     client.FatTarget     || client.TargetFats,
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


      {/* Profile Edit Modal */}
      {showProfileEdit && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000,
          display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div style={{ background:'#1e293b', borderRadius:'14px', width:'100%', maxWidth:'420px',
            display:'flex', flexDirection:'column', overflow:'hidden', maxHeight:'90vh' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)',
              display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:'15px' }}>Edit Client Profile</div>
              <button onClick={() => setShowProfileEdit(false)}
                style={{ background:'none', border:'none', color:'#64748b', fontSize:'22px',
                  cursor:'pointer', lineHeight:1, padding:'4px' }}>×</button>
            </div>
            <div style={{ padding:'20px', display:'flex', flexDirection:'column', gap:'14px', overflowY:'auto' }}>
              {/* Age */}
              <div>
                <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                  marginBottom:'5px', display:'block' }}>AGE (YEARS)</label>
                <input type='number' min={1} max={120} value={profileEditForm.age}
                  onChange={e => setProfileEditForm(f => ({ ...f, age: e.target.value }))}
                  style={{ width:'100%', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                    color:'#f1f5f9', fontSize:'15px', padding:'10px 12px', boxSizing:'border-box' }} />
              </div>
              {/* Target Weight */}
              <div>
                <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                  marginBottom:'5px', display:'block' }}>TARGET WEIGHT (KG)</label>
                <input type='number' min={30} max={300} step={0.1} value={profileEditForm.targetWeight}
                  onChange={e => setProfileEditForm(f => ({ ...f, targetWeight: e.target.value }))}
                  style={{ width:'100%', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                    color:'#f1f5f9', fontSize:'15px', padding:'10px 12px', boxSizing:'border-box' }} />
              </div>
              {/* Training days per week */}
              <div>
                <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                  marginBottom:'5px', display:'block' }}>TRAINING DAYS PER WEEK</label>
                <input type='number' min={1} max={7} value={profileEditForm.trainingDaysPerWeek}
                  onChange={e => setProfileEditForm(f => ({ ...f, trainingDaysPerWeek: e.target.value }))}
                  style={{ width:'100%', background:'rgba(255,255,255,0.06)',
                    border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
                    color:'#f1f5f9', fontSize:'15px', padding:'10px 12px', boxSizing:'border-box' }} />
              </div>
              {/* Specific training days */}
              <div>
                <label style={{ color:'#64748b', fontSize:'11px', letterSpacing:'0.05em',
                  marginBottom:'8px', display:'block' }}>TRAINING DAYS</label>
                <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                  {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => {
                    const active = profileEditForm.trainingDays.includes(day);
                    return (
                      <button key={day} onClick={() => setProfileEditForm(f => ({
                        ...f,
                        trainingDays: active
                          ? f.trainingDays.filter(d => d !== day)
                          : [...f.trainingDays, day],
                      }))}
                      style={{ padding:'8px 12px', borderRadius:'8px', border:'none', cursor:'pointer',
                        background: active ? '#f97316' : 'rgba(255,255,255,0.06)',
                        color: active ? '#fff' : '#64748b',
                        fontSize:'13px', fontWeight: active ? 700 : 400,
                        transition:'background 0.15s, color 0.15s' }}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize:'11px', color:'#475569', marginTop:'6px' }}>
                  {profileEditForm.trainingDays.length > 0
                    ? `${profileEditForm.trainingDays.length} day${profileEditForm.trainingDays.length !== 1 ? 's' : ''} selected`
                    : 'No specific days set'}
                </div>
              </div>
            </div>
            <div style={{ padding:'14px 20px', borderTop:'1px solid rgba(255,255,255,0.08)',
              display:'flex', gap:'10px' }}>
              <button onClick={() => setShowProfileEdit(false)}
                style={{ flex:1, padding:'11px', background:'rgba(255,255,255,0.06)',
                  border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
                  color:'#94a3b8', fontSize:'14px', cursor:'pointer' }}>Cancel</button>
              <button disabled={profileEditSaving} onClick={async () => {
                setProfileEditSaving(true);
                try {
                  const updatedClient = {
                    ...Object.fromEntries(Object.entries(client)),
                    Age: profileEditForm.age,
                    TargetWeight: profileEditForm.targetWeight,
                    TrainingDaysPerWeek: profileEditForm.trainingDaysPerWeek,
                    TrainingDays: profileEditForm.trainingDays.join(','),
                  };
                  await upsertRow('Clients', 'ClientID', client.ClientID, updatedClient);
                  setClient(updatedClient);
                  setShowProfileEdit(false);
                } catch (e) {
                  alert('Save failed: ' + e.message);
                } finally {
                  setProfileEditSaving(false);
                }
              }}
              style={{ flex:2, padding:'11px',
                background: profileEditSaving ? 'rgba(249,115,22,0.4)' : '#f97316',
                border:'none', borderRadius:'10px', color:'#fff',
                fontSize:'14px', fontWeight:600, cursor: profileEditSaving ? 'default' : 'pointer' }}>
                {profileEditSaving ? 'Saving…' : '✓ Save Changes'}
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
