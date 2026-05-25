import { useAuth } from '../../context/AuthContext';

export default function ClientDashboard() {
  const { user } = useAuth();

  return (
    <div>
      <h1 style={{ color: '#f8fafc', fontSize: '26px', fontWeight: '700', margin: '0 0 8px' }}>
        Hey {user?.name?.split(' ')[0]} 👊
      </h1>
      <p style={{ color: '#94a3b8', marginTop: 0, marginBottom: '32px' }}>
        Ready to crush today's session?
      </p>

      {/* Placeholder stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: "Today's Workout", value: '—', icon: '🏋️' },
          { label: 'Calories',        value: '—', icon: '🔥' },
          { label: 'This Week',       value: '—', icon: '📅' },
          { label: 'Weight',          value: '—', icon: '⚖️' },
        ].map(card => (
          <div key={card.label} style={{
            background: '#1e293b', borderRadius: '12px', padding: '20px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>{card.icon}</div>
            <div style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{card.label}</div>
            <div style={{ color: '#f8fafc', fontSize: '28px', fontWeight: '700', marginTop: '4px' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: '#1e293b', borderRadius: '12px', padding: '24px',
        border: '1px solid rgba(249,115,22,0.15)',
      }}>
        <p style={{ color: '#f97316', fontWeight: '600', margin: '0 0 8px' }}>🚀 Coming soon</p>
        <p style={{ color: '#94a3b8', margin: 0, fontSize: '14px' }}>
          Your workout plans, nutrition logs, progress photos and AI coach will appear here.
        </p>
      </div>
    </div>
  );
}
