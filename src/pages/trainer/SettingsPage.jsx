import { useState } from 'react';

const PROXY_URL = import.meta.env.VITE_APPS_SCRIPT_URL;

async function callProxy(body) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    redirect: 'follow',
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function SettingsPage() {
  const [seedStatus, setSeedStatus] = useState(null);
  const [seedMsg,    setSeedMsg]    = useState('');

  const handleSeed = async () => {
    setSeedStatus('loading');
    setSeedMsg('');
    try {
      const result = await callProxy({ action: 'seedExercises' });
      if (result.success && result.seeded) {
        setSeedStatus('ok');
        setSeedMsg(`Seeded ${result.count} exercises into your Exercises sheet.`);
      } else if (result.success && result.seeded === false) {
        setSeedStatus('skip');
        setSeedMsg(result.reason);
      } else {
        setSeedStatus('error');
        setSeedMsg(result.error || 'Unknown error from Apps Script.');
      }
    } catch (err) {
      setSeedStatus('error');
      setSeedMsg('Network error — check your VITE_APPS_SCRIPT_URL in .env.');
    }
  };

  return (
    <div>
      <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>Settings</h1>
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '32px' }}>Configure your account and preferences.</p>

      <div style={{ maxWidth: '600px' }}>
        {[
          { section: 'Account', items: ['Profile details', 'Change password', 'Email notifications'] },
          { section: 'App',     items: ['Google Sheets connection', 'Macro formula preferences', 'Branding'] },
        ].map(({ section, items }) => (
          <div key={section} style={{ marginBottom: '28px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#f97316', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>{section}</div>
            <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
              {items.map((item, i) => (
                <div key={item} style={{
                  padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  cursor: 'pointer', transition: 'background 0.12s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: '13.5px', color: '#cbd5e1' }}>{item}</span>
                  <span style={{ color: '#475569', fontSize: '12px' }}>Coming soon</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#f97316', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>Data Management</div>
          <div style={{ background: '#1e293b', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: seedMsg ? '10px' : '0' }}>
                <div>
                  <div style={{ fontSize: '13.5px', color: '#cbd5e1', fontWeight: '600' }}>Seed Exercise Database</div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    Populate the Exercises sheet with 66 starter exercises and YouTube links.
                    Only runs if the sheet has fewer than 5 rows.
                  </div>
                </div>
                <button onClick={handleSeed} disabled={seedStatus === 'loading'} style={{
                  marginLeft: '14px', flexShrink: 0, padding: '9px 16px',
                  background: seedStatus === 'ok' ? 'rgba(34,197,94,0.15)' : seedStatus === 'error' ? 'rgba(239,68,68,0.15)' : seedStatus === 'loading' ? 'rgba(255,255,255,0.06)' : '#f97316',
                  border: seedStatus === 'ok' ? '1px solid rgba(34,197,94,0.3)' : seedStatus === 'error' ? '1px solid rgba(239,68,68,0.3)' : seedStatus === 'loading' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  borderRadius: '9px',
                  color: seedStatus === 'ok' ? '#22c55e' : seedStatus === 'error' ? '#f87171' : seedStatus === 'loading' ? '#64748b' : '#fff',
                  fontSize: '13px', fontWeight: '700',
                  cursor: seedStatus === 'loading' ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                }}>
                  {seedStatus === 'loading' ? 'Seeding...' : 'Seed Now'}
                </button>
              </div>
              {seedMsg && (
                <div style={{
                  fontSize: '12px', lineHeight: 1.5, padding: '8px 10px', borderRadius: '8px',
                  background: seedStatus === 'ok' ? 'rgba(34,197,94,0.08)' : seedStatus === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)',
                  color: seedStatus === 'ok' ? '#86efac' : seedStatus === 'error' ? '#fca5a5' : '#93c5fd',
                  border: seedStatus === 'ok' ? '1px solid rgba(34,197,94,0.2)' : seedStatus === 'error' ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(59,130,246,0.2)',
                }}>{seedMsg}</div>
              )}
            </div>
            <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '13.5px', color: '#cbd5e1' }}>Export client data</span>
              <span style={{ color: '#475569', fontSize: '12px' }}>Coming soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
