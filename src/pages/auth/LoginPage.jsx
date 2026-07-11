import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const COLORS = {
  bg:           '#0f172a',
  bgGradient:   'linear-gradient(145deg, #0f172a 0%, #1a1f35 50%, #0f172a 100%)',
  card:         '#1e293b',
  cardBorder:   'rgba(255,255,255,0.07)',
  accent:       '#f97316',
  accentHover:  '#ea580c',
  accentGlow:   'rgba(249,115,22,0.25)',
  textPrimary:  '#f8fafc',
  textSecondary:'#94a3b8',
  textMuted:    '#475569',
  inputBg:      '#0f172a',
  inputBorder:  '#334155',
  inputFocus:   '#f97316',
  error:        '#f87171',
  errorBg:      'rgba(248,113,113,0.1)',
  divider:      '#1e293b',
};

// Simple dumbbell icon SVG
function DumbbellIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="10" width="3" height="4" rx="1" fill={COLORS.accent} />
      <rect x="3" y="8" width="3" height="8" rx="1" fill={COLORS.accent} />
      <rect x="20" y="10" width="3" height="4" rx="1" fill={COLORS.accent} />
      <rect x="18" y="8" width="3" height="8" rx="1" fill={COLORS.accent} />
      <rect x="6" y="11" width="12" height="2" rx="1" fill={COLORS.accent} />
    </svg>
  );
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function LoginPage() {
  const { login, user, userType } = useAuth();
  const navigate = useNavigate();

  // Already authenticated — skip straight to their area (fixes PWA re-open login loop)
  if (user) {
    return <Navigate to={userType === 'trainer' ? '/trainer/dashboard' : '/client/today'} replace />;
  }

  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [focusedField, setFocused] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        navigate(result.userType === 'trainer' ? '/trainer/dashboard' : '/client/today', { replace: true });
      } else {
        setError(result.error || 'Invalid credentials.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = (field) => ({
    width: '100%',
    padding: '13px 16px',
    background: COLORS.inputBg,
    border: `1.5px solid ${focusedField === field ? COLORS.inputFocus : COLORS.inputBorder}`,
    borderRadius: '10px',
    color: COLORS.textPrimary,
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxSizing: 'border-box',
    boxShadow: focusedField === field ? `0 0 0 3px ${COLORS.accentGlow}` : 'none',
  });

  return (
    <div style={{
      minHeight: '100vh',
      background: COLORS.bgGradient,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>

      {/* Subtle background circles */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-20%', right: '-10%',
          width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.06) 0%, transparent 70%)',
        }}/>
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-10%',
          width: '400px', height: '400px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.04) 0%, transparent 70%)',
        }}/>
      </div>

      {/* Card */}
      <div style={{
        background: COLORS.card,
        borderRadius: '20px',
        padding: '48px 44px',
        width: '100%',
        maxWidth: '440px',
        boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        border: `1px solid ${COLORS.cardBorder}`,
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '68px', height: '68px', borderRadius: '18px',
            background: 'linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(249,115,22,0.08) 100%)',
            border: `1px solid rgba(249,115,22,0.2)`,
            marginBottom: '16px',
          }}>
            <DumbbellIcon />
          </div>
          <div>
            <div style={{
              fontSize: '22px', fontWeight: '800', letterSpacing: '0.5px',
              color: COLORS.textPrimary, textTransform: 'uppercase', lineHeight: 1.1,
            }}>
              Tom Farmer
            </div>
            <div style={{
              fontSize: '11px', fontWeight: '700', letterSpacing: '4px',
              color: COLORS.accent, textTransform: 'uppercase', marginTop: '4px',
            }}>
              Fitness
            </div>
          </div>
        </div>

        {/* Heading */}
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{
            margin: 0, fontSize: '24px', fontWeight: '700',
            color: COLORS.textPrimary, letterSpacing: '-0.3px',
          }}>
            Welcome back
          </h1>
          <p style={{
            margin: '6px 0 0', fontSize: '14px',
            color: COLORS.textSecondary, lineHeight: 1.5,
          }}>
            Sign in to your account to continue
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            background: COLORS.errorBg,
            border: `1px solid rgba(248,113,113,0.2)`,
            borderRadius: '10px', padding: '12px 14px',
            marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '10px',
          }}>
            <span style={{ fontSize: '16px', marginTop: '1px' }}>⚠️</span>
            <span style={{ color: COLORS.error, fontSize: '14px', lineHeight: 1.4 }}>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block', fontSize: '13px', fontWeight: '600',
              color: COLORS.textSecondary, marginBottom: '7px', letterSpacing: '0.3px',
            }}>
              Email address
            </label>
            <input
              type="email" inputMode="email" autoComplete="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              style={inputStyle('email')}
              disabled={loading}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block', fontSize: '13px', fontWeight: '600',
              color: COLORS.textSecondary, marginBottom: '7px', letterSpacing: '0.3px',
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                style={{ ...inputStyle('password'), paddingRight: '46px' }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={{
                  position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: COLORS.textMuted, padding: '0', display: 'flex', alignItems: 'center',
                }}
                tabIndex={-1}
              >
                <EyeIcon visible={showPass} />
              </button>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading
                ? COLORS.textMuted
                : `linear-gradient(135deg, ${COLORS.accent} 0%, ${COLORS.accentHover} 100%)`,
              border: 'none', borderRadius: '10px',
              color: '#fff', fontSize: '15px', fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.3px',
              boxShadow: loading ? 'none' : `0 4px 20px ${COLORS.accentGlow}`,
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {loading ? (
              <>
                <span style={{
                  width: '16px', height: '16px', borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  animation: 'spin 0.7s linear infinite',
                  display: 'inline-block',
                }}/>
                Signing in…
              </>
            ) : 'Sign In'}
          </button>
        </form>

        {/* Footer */}
        <div style={{
          marginTop: '24px', paddingTop: '20px',
          borderTop: `1px solid rgba(255,255,255,0.06)`,
          textAlign: 'center',
        }}>
          <a
            href="mailto:tom@tomfarmerfitness.com"
            style={{
              color: COLORS.textMuted, fontSize: '13px', textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => e.target.style.color = COLORS.textSecondary}
            onMouseLeave={e => e.target.style.color = COLORS.textMuted}
          >
            Forgot password? Contact your coach
          </a>
        </div>
      </div>

      {/* Spinner keyframe */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input::placeholder { color: #475569; }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 100px #0f172a inset !important;
          -webkit-text-fill-color: #f8fafc !important;
        }
        @media (max-width: 480px) {
          .login-card { padding: 32px 24px !important; }
        }
      `}</style>
    </div>
  );
}
