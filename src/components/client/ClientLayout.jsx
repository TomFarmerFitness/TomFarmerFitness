import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { readSheet } from '../../utils/sheets';

function SunIcon() {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function DumbbellIcon() {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <rect x="2" y="9" width="3" height="6" rx="1"/>
      <rect x="5" y="10.5" width="2" height="3" rx="0.5"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
      <rect x="17" y="10.5" width="2" height="3" rx="0.5"/>
      <rect x="19" y="9" width="3" height="6" rx="1"/>
    </svg>
  );
}
function NutritionIcon() {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
      <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
    </svg>
  );
}
function TrendingUpIcon() {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  );
}

const TABS = [
  { path: '/client/today',     label: 'Today',     Icon: SunIcon },
  { path: '/client/training',  label: 'Training',  Icon: DumbbellIcon },
  { path: '/client/nutrition', label: 'Nutrition', Icon: NutritionIcon },
  { path: '/client/progress',  label: 'Progress',  Icon: TrendingUpIcon },
  { path: '/client/ask',       label: 'Ask',       Icon: ChatIcon },
];

export default function ClientLayout() {
  const { user } = useAuth();
  const location  = useLocation();
  const navigate  = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  const firstName = (user?.name || 'there').split(' ')[0];

  useEffect(() => {
    if (!user?.clientID) return;
    readSheet('AIQuestions').then(rows => {
      const lastSeen = parseInt(localStorage.getItem('tff_ask_last_seen') || '0', 10);
      const unread = rows.filter(r =>
        r.ClientID === user.clientID &&
        r.AnsweredAt &&
        new Date(r.AnsweredAt).getTime() > lastSeen
      );
      setUnreadCount(unread.length);
    }).catch(() => {});
  }, [user?.clientID]);

  useEffect(() => {
    if (location.pathname === '/client/ask') {
      localStorage.setItem('tff_ask_last_seen', Date.now().toString());
      setUnreadCount(0);
    }
  }, [location.pathname]);

  return (
    <>
      <div style={{ minHeight: '100dvh', background: '#070c14' }}>

        {/* Fixed Header */}
        <header style={{
          position: 'fixed', top: 0, zIndex: 200,
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '430px', height: '56px',
          background: 'rgba(15,23,42,0.96)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div style={{
              width: '30px', height: '30px', borderRadius: '8px',
              background: 'linear-gradient(135deg,#f97316,#ea580c)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', flexShrink: 0,
            }}>&#x1F4AA;</div>
            <div>
              <div style={{ fontSize: '11.5px', fontWeight: '700', color: '#f8fafc', letterSpacing: '0.2px', lineHeight: 1.15 }}>Tom Farmer</div>
              <div style={{ fontSize: '9px', fontWeight: '700', color: '#f97316', letterSpacing: '1.8px', textTransform: 'uppercase' }}>Fitness</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '500' }}>Hey, {firstName} &#x1F44B;</span>
            <button
              onClick={() => navigate('/client/ask')}
              style={{
                position: 'relative', background: 'none', border: 'none',
                cursor: 'pointer', padding: '6px', lineHeight: 0,
                color: unreadCount > 0 ? '#f97316' : '#64748b',
                borderRadius: '8px', transition: 'color 0.15s',
              }}
            >
              <BellIcon />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '2px', right: '2px',
                  minWidth: '16px', height: '16px', borderRadius: '8px',
                  background: '#f97316', color: '#fff',
                  fontSize: '9px', fontWeight: '700',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px', border: '2px solid #0f172a',
                }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div style={{
          position: 'fixed', zIndex: 1,
          top: '56px', bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '430px',
          overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          background: '#0f172a',
        }}>
          <div key={location.pathname} style={{ animation: 'tabFadeIn 0.18s ease', minHeight: '100%' }}>
            <Outlet />
          </div>
        </div>

        {/* Fixed Bottom Nav */}
        <nav style={{
          position: 'fixed', bottom: 0, zIndex: 200,
          left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: '430px', height: '64px',
          background: 'rgba(11,17,30,0.97)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'stretch',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}>
          {TABS.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path} style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: '3px', textDecoration: 'none',
              color: isActive ? '#f97316' : '#475569',
              fontSize: '10px', fontWeight: isActive ? '600' : '500',
              transition: 'color 0.15s', position: 'relative',
            })}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span style={{
                      position: 'absolute', top: 0,
                      left: '50%', transform: 'translateX(-50%)',
                      width: '28px', height: '2px',
                      background: '#f97316', borderRadius: '0 0 3px 3px',
                    }} />
                  )}
                  <span style={{ position: 'relative', lineHeight: 0 }}>
                    <Icon />
                    {label === 'Ask' && unreadCount > 0 && (
                      <span style={{
                        position: 'absolute', top: '-1px', right: '-3px',
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: '#f97316', border: '1.5px solid #0b111e',
                      }} />
                    )}
                  </span>
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

      </div>
    </>
  );
}
