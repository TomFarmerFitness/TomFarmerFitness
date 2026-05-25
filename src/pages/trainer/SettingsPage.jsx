export default function SettingsPage() {
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
                  <span style={{ color: '#475569', fontSize: '12px' }}>Coming soon →</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
