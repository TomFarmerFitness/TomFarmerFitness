import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { readSheet } from '../../utils/sheets';

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients,     setClients]     = useState([]);
  const [workoutLogs, setWorkoutLogs] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('All');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [c, l] = await Promise.all([readSheet('Clients'), readSheet('WorkoutLogs')]);
        setClients(c);
        setWorkoutLogs(l);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function complianceRate(clientId, trainingDaysPerWeek) {
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const expected = Number(trainingDaysPerWeek || 3) * 4;
    const completed = workoutLogs.filter(l => {
      const d = parseDate(l.Date);
      return l.ClientID === clientId && d && d >= fourWeeksAgo && d <= now && l.Status === 'Completed';
    }).length;
    return expected > 0 ? Math.round((completed / expected) * 100) : 0;
  }

  function lastWorkout(clientId) {
    const dates = workoutLogs
      .filter(l => l.ClientID === clientId && l.Status === 'Completed')
      .map(l => parseDate(l.Date))
      .filter(Boolean)
      .sort((a, b) => b - a);
    return dates[0] || null;
  }

  const filtered = clients.filter(c => {
    const matchSearch = !search || c.Name?.toLowerCase().includes(search.toLowerCase()) || c.Email?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || c.Status === filter;
    return matchSearch && matchFilter;
  });

  const statusOptions = ['All', 'Active', 'Inactive', 'Paused'];

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: '700', margin: 0 }}>Clients</h1>
        <div style={{ fontSize: '13px', color: '#64748b' }}>{filtered.length} client{filtered.length !== 1 ? 's' : ''}</div>
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '200px', position: 'relative' }}>
          <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#475569' }} width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            style={{
              width: '100%', padding: '9px 12px 9px 36px', boxSizing: 'border-box',
              background: '#1e293b', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px', color: '#f1f5f9', fontSize: '13.5px', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {statusOptions.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
                cursor: 'pointer', transition: 'all 0.12s', border: '1px solid',
                background: filter === s ? 'rgba(249,115,22,0.12)' : 'transparent',
                borderColor: filter === s ? '#f97316' : 'rgba(255,255,255,0.08)',
                color: filter === s ? '#f97316' : '#64748b',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '14px 18px', color: '#fca5a5', fontSize: '13px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b', fontSize: '14px' }}>
          <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading clients...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: '#475569' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>👥</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#94a3b8', marginBottom: '6px' }}>No clients found</div>
          <div style={{ fontSize: '13px' }}>{search ? 'Try a different search term.' : 'No clients match the selected filter.'}</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Client', 'Goal', 'Weight', 'Compliance (4wk)', 'Last Workout', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => {
                const cr   = complianceRate(client.ClientID, client.TrainingDaysPerWeek);
                const lw   = lastWorkout(client.ClientID);
                const dotC = cr >= 80 ? '#22c55e' : cr >= 50 ? '#f59e0b' : '#ef4444';
                return (
                  <tr
                    key={client.ClientID}
                    onClick={() => navigate(`/trainer/clients/${client.ClientID}`)}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'linear-gradient(135deg, #1e40af, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: '#fff', flexShrink: 0 }}>
                          {(client.Name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: '13.5px', fontWeight: '600', color: '#f1f5f9' }}>{client.Name}</div>
                          <div style={{ fontSize: '11.5px', color: '#475569' }}>{client.Email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '13px', color: '#94a3b8' }}>{client.Goal || '—'}</td>
                    <td style={{ padding: '13px 16px', fontSize: '13px', color: '#94a3b8' }}>
                      {client.CurrentWeight ? `${client.CurrentWeight} → ${client.TargetWeight || '?'} kg` : '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotC, flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{cr}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: '13px', color: '#94a3b8' }}>
                      {lw ? formatDistanceToNow(lw, { addSuffix: true }) : 'Not started'}
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '600',
                        background: client.Status === 'Active' ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.15)',
                        color: client.Status === 'Active' ? '#4ade80' : '#94a3b8',
                      }}>
                        {client.Status || 'Unknown'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
