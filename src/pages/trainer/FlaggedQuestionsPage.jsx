import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { readSheet } from '../../utils/sheets';

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export default function FlaggedQuestionsPage() {
  const [questions, setQuestions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [clients,   setClients]   = useState([]);

  useEffect(() => {
    Promise.all([readSheet('AIQuestions'), readSheet('Clients')])
      .then(([q, c]) => {
        setQuestions(q.filter(r => r.Status === 'Pending' || r.Status === 'Flagged' || !r.AnsweredAt));
        setClients(c);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function clientName(clientId) {
    const c = clients.find(c => c.ClientID === clientId);
    return c?.Name || clientId || 'Unknown';
  }

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>Flagged Questions</h1>
        <p style={{ color: '#64748b', fontSize: '13.5px', margin: 0 }}>AI questions from clients that need your review or a direct answer.</p>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '14px', color: '#fca5a5', fontSize: '13px', marginBottom: '20px' }}>{error}</div>}
      {loading && <div style={{ display: 'flex', gap: '10px', alignItems: 'center', color: '#64748b', fontSize: '14px' }}><span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Loading...</div>}

      {!loading && questions.length === 0 && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '48px', border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>✅</div>
          <div style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: '600', marginBottom: '6px' }}>All clear!</div>
          <div style={{ color: '#475569', fontSize: '13px' }}>No pending questions from clients right now.</div>
        </div>
      )}

      {!loading && questions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {questions.map((q, i) => {
            const asked = parseDate(q.AskedAt);
            return (
              <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '18px 20px', border: '1px solid rgba(249,115,22,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px' }}>🚩</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{clientName(q.ClientID)}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#475569' }}>{asked ? format(asked, 'MMM d, yyyy h:mm a') : ''}</span>
                </div>
                <div style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '12px', paddingLeft: '22px' }}>
                  "{q.Question}"
                </div>
                {q.Answer ? (
                  <div style={{ paddingLeft: '22px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '11px', color: '#22c55e', fontWeight: '600', marginBottom: '4px' }}>YOUR ANSWER</div>
                    <div style={{ fontSize: '13.5px', color: '#94a3b8' }}>{q.Answer}</div>
                  </div>
                ) : (
                  <div style={{ paddingLeft: '22px' }}>
                    <div style={{ fontSize: '11px', color: '#f97316', fontWeight: '600' }}>AWAITING YOUR RESPONSE</div>
                    <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>Reply functionality coming soon.</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
