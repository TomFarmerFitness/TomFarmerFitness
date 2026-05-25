import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, startOfWeek, isAfter, format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { readSheet } from '../../utils/sheets';
import OnboardClientForm from '../../components/trainer/OnboardClientForm';

// ─── helpers ────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getWeekStart() {
  return startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function complianceDot(clientId, trainingDaysPerWeek, workoutLogs) {
  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const days = Number(trainingDaysPerWeek) || 3;
  const expected = days * 4;

  const completed = workoutLogs.filter(log => {
    if (log.ClientID !== clientId) return false;
    const d = parseDate(log.Date);
    return d && d >= fourWeeksAgo && d <= now && log.Status === 'Completed';
  }).length;

  const rate = expected > 0 ? completed / expected : 0;

  let color, label;
  if (rate >= 0.8)      { color = '#22c55e'; label = 'On track'; }
  else if (rate >= 0.5) { color = '#f59e0b'; label = 'Needs attention'; }
  else                  { color = '#ef4444'; label = 'Low compliance'; }

  return { color, label, rate: Math.round(rate * 100), completed, expected };
}

function lastWorkoutDate(clientId, workoutLogs) {
  const dates = workoutLogs
    .filter(log => log.ClientID === clientId && log.Status === 'Completed')
    .map(log => parseDate(log.Date))
    .filter(Boolean)
    .sort((a, b) => b - a);
  return dates[0] || null;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color = '#f97316', loading }) {
  return (
    <div style={{
      background: '#1e293b', borderRadius: '12px', padding: '20px 22px',
      border: '1px solid rgba(255,255,255,0.06)', flex: '1', minWidth: '0',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>
            {label}
          </div>
          {loading ? (
            <div style={{ width: '48px', height: '32px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', animation: 'pulse 1.4s ease-in-out infinite' }} />
          ) : (
            <div style={{ fontSize: '30px', fontWeight: '700', color: '#f8fafc', lineHeight: 1 }}>{value}</div>
          )}
        </div>
        <div style={{ fontSize: '22px', opacity: 0.6 }}>{icon}</div>
      </div>
    </div>
  );
}

function GoalBadge({ goal }) {
  const map = {
    'Weight Loss':    { bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
    'Fat Loss':       { bg: 'rgba(249,115,22,0.12)',  color: '#fb923c' },
    'Muscle Gain':    { bg: 'rgba(34,197,94,0.12)',   color: '#4ade80' },
    'General Fitness':{ bg: 'rgba(99,102,241,0.12)',  color: '#818cf8' },
    'Strength':       { bg: 'rgba(234,179,8,0.12)',   color: '#facc15' },
  };
  const s = map[goal] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.3px',
      padding: '3px 8px', borderRadius: '99px',
    }}>
      {goal || 'No goal'}
    </span>
  );
}

function ClientCard({ client, workoutLogs, onClick }) {
  const dot   = complianceDot(client.ClientID, client.TrainingDaysPerWeek, workoutLogs);
  const lastWo = lastWorkoutDate(client.ClientID, workoutLogs);
  const isNew  = !lastWo;

  return (
    <div
      onClick={onClick}
      style={{
        background: '#1e293b', borderRadius: '12px', padding: '18px 20px',
        border: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer', transition: 'all 0.15s',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          {/* Avatar */}
          <div style={{
            width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #1e40af, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: '700', color: '#fff',
          }}>
            {(client.Name || '?').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {client.Name}
            </div>
            <GoalBadge goal={client.Goal} />
          </div>
        </div>

        {/* Compliance dot */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
          <div
            title={`${dot.label} — ${dot.rate}% (${dot.completed}/${dot.expected} workouts)`}
            style={{
              width: '11px', height: '11px', borderRadius: '50%',
              background: dot.color,
              boxShadow: `0 0 8px ${dot.color}60`,
            }}
          />
          <span style={{ fontSize: '9.5px', color: '#475569' }}>{dot.label}</span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current</div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#cbd5e1' }}>
            {client.CurrentWeight ? `${client.CurrentWeight} kg` : '—'}
          </div>
        </div>
        <div style={{ color: '#334155', fontSize: '12px', alignSelf: 'center', paddingTop: '10px' }}>→</div>
        <div>
          <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Target</div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#cbd5e1' }}>
            {client.TargetWeight ? `${client.TargetWeight} kg` : '—'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: '10px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last workout</div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: isNew ? '#f97316' : '#cbd5e1' }}>
            {isNew ? 'Not started' : formatDistanceToNow(lastWo, { addSuffix: true })}
          </div>
        </div>
      </div>

      {/* View details arrow */}
      <div style={{
        position: 'absolute', bottom: '16px', right: '16px',
        fontSize: '11px', color: '#f97316', opacity: 0, transition: 'opacity 0.15s',
      }}
        className="card-arrow"
      >
        View details →
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
      {[1,2,3].map(i => (
        <div key={i} style={{
          background: '#1e293b', borderRadius: '12px', padding: '20px',
          border: '1px solid rgba(255,255,255,0.06)', height: '130px',
          animation: 'pulse 1.4s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export default function TrainerDashboard() {
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [clients,      setClients]      = useState([]);
  const [workoutLogs,  setWorkoutLogs]  = useState([]);
  const [aiQuestions,  setAiQuestions]  = useState([]);
  const [programs,     setPrograms]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [showOnboard,  setShowOnboard]  = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [c, l, q, p] = await Promise.all([
        readSheet('Clients'),
        readSheet('WorkoutLogs'),
        readSheet('AIQuestions'),
        readSheet('WorkoutPrograms'),
      ]);
      setClients(c.filter(r => r.Status === 'Active'));
      setWorkoutLogs(l);
      setAiQuestions(q);
      setPrograms(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Stats
  const weekStart = getWeekStart();
  const workoutsThisWeek = workoutLogs.filter(log => {
    const d = parseDate(log.Date);
    return d && isAfter(d, weekStart) && log.Status === 'Completed';
  }).length;
  const flaggedCount = aiQuestions.filter(q =>
    q.Status === 'Pending' || q.Status === 'Flagged'
  ).length;

  const firstName = (user?.name || '').split(' ')[0];

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes spin   { to { transform: rotate(360deg); } }
      `}</style>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <h1 style={{ color: '#f8fafc', fontSize: '24px', fontWeight: '700', margin: '0 0 4px' }}>
            {getGreeting()}, {firstName} 👋
          </h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '14px' }}>
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <button
          onClick={() => setShowOnboard(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            padding: '10px 18px', borderRadius: '9px',
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            border: 'none', color: '#fff', fontSize: '13.5px',
            fontWeight: '600', cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(249,115,22,0.3)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(249,115,22,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(249,115,22,0.3)'; }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Onboard New Client
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '10px', padding: '14px 18px', marginBottom: '24px',
          color: '#fca5a5', fontSize: '13.5px', display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
          <div>
            <strong>Could not load data from Google Sheets</strong>
            <div style={{ marginTop: '4px', opacity: 0.8 }}>{error}</div>
            <button
              onClick={fetchData}
              style={{ marginTop: '8px', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#fca5a5', fontSize: '12px', padding: '4px 12px', cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' }}>
        <StatCard icon="👥" label="Active Clients"   value={loading ? '—' : clients.length}          loading={loading} />
        <StatCard icon="✅" label="Workouts This Week" value={loading ? '—' : workoutsThisWeek}       loading={loading} />
        <StatCard icon="🚩" label="Flagged Questions" value={loading ? '—' : flaggedCount}            loading={loading} color={flaggedCount > 0 ? '#ef4444' : '#f97316'} />
      </div>

      {/* Client cards */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '600', margin: 0 }}>
          Your Clients
          {!loading && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#475569', fontWeight: '400' }}>
            {clients.length} active
          </span>}
        </h2>
        {!loading && clients.length > 0 && (
          <button
            onClick={() => navigate('/trainer/clients')}
            style={{ background: 'transparent', border: 'none', color: '#f97316', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}
          >
            View all →
          </button>
        )}
      </div>

      {loading && <LoadingSkeleton />}

      {!loading && !error && clients.length === 0 && (
        <div style={{
          background: '#1e293b', borderRadius: '12px', padding: '48px 32px',
          border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👋</div>
          <div style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: '600', marginBottom: '6px' }}>No clients yet</div>
          <div style={{ color: '#475569', fontSize: '14px', marginBottom: '20px' }}>
            Get started by onboarding your first client.
          </div>
          <button
            onClick={() => setShowOnboard(true)}
            style={{
              padding: '10px 20px', borderRadius: '9px',
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              border: 'none', color: '#fff', fontSize: '13.5px',
              fontWeight: '600', cursor: 'pointer',
            }}
          >
            + Onboard New Client
          </button>
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {clients.map(client => (
            <ClientCard
              key={client.ClientID}
              client={client}
              workoutLogs={workoutLogs}
              onClick={() => navigate(`/trainer/clients/${client.ClientID}`)}
            />
          ))}
        </div>
      )}

      {/* Compliance legend */}
      {!loading && clients.length > 0 && (
        <div style={{ marginTop: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {[
            { color: '#22c55e', label: '≥80% — On track' },
            { color: '#f59e0b', label: '50–79% — Needs attention' },
            { color: '#ef4444', label: '<50% — Low compliance' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
              <span style={{ fontSize: '11.5px', color: '#475569' }}>{label}</span>
            </div>
          ))}
          <span style={{ fontSize: '11.5px', color: '#334155' }}>— based on last 4 weeks</span>
        </div>
      )}

      {/* Onboard slide-over */}
      {showOnboard && (
        <OnboardClientForm
          programs={programs}
          onClose={() => setShowOnboard(false)}
          onSuccess={() => {
            setShowOnboard(false);
            fetchData(); // refresh client list
          }}
        />
      )}
    </>
  );
}
