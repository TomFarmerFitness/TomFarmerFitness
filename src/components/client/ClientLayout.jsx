import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function SunIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
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
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
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
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
      <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
    </svg>
  );
}
function TrendingUpIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}

const TABS = [
  { path: '/client/today',     label: 'Today',     Icon: SunIcon },
  { path: '/client/training',  label: 'Training',  Icon: DumbbellIcon },
  { path: '/client/nutrition', label: 'Nutrition', Icon: NutritionIcon },
  { path: '/client/progress',  label: 'Progress',  Icon: TrendingUpIcon },
];

export default function ClientLayout() {
  const { user } = useAuth();
  const location  = useLocation();

  const firstName = (user?.name || 'there').split(' ')[0];

  return (
    <>
      <style>{`
        @keyframes tabFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        html, body, #root {
          overflow-x: hidden !important;
          max-width: 100vw !important;
          width: 100% !important;
          overscroll-behavior: none;
          position: relative;
        }
        @media (max-width: 360px) {
          .nav-label { font-size: 8px !important; }
          .nav-icon svg { width: 18px !important; height: 18px !important; }
        }
      `}</style>
      {/* NOTE: No overflow:hidden or position:relative here — those clip position:fixed
           modals and block touch events on iOS Safari. The inner clip div handles scroll. */}
      <div style={{ minHeight: '100dvh', background: '#070c14', width: '100vw', maxWidth: '100vw' }}>

        {/* Fixed Header */}
        <header style={{
          position: 'fixed', top: 0, zIndex: 200,
          left: 0, right: 0,
          width: '100%',
          background: 'rgba(15,23,42,0.96)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: '16px', paddingRight: '16px', paddingBottom: '0',
          minHeight: 'calc(56px + env(safe-area-inset-top, 0px))',
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
          </div>
        </header>

        {/* Outer clip container — iOS Safari ignores overflow-x:hidden when overflow-y:auto
             is on the SAME element, so we use a separate clip wrapper */}
        <div style={{
          position: 'fixed', zIndex: 1,
          top: 'calc(56px + env(safe-area-inset-top, 0px))', bottom: '0px',
          left: 0, right: 0,
          width: '100vw', maxWidth: '100vw',
          overflow: 'hidden',
          background: '#0f172a',
        }}>
          {/* Inner scroll container — vertical only */}
          <div style={{
            width: '100%', height: '100%',
            overflowY: 'auto', overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y',
            paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 12px))',
          }}>
            <div key={location.pathname} style={{ animation: 'tabFadeIn 0.18s ease', minHeight: '100%', width: '100%', overflowX: 'hidden' }}>
              <Outlet />
            </div>
          </div>
        </div>

        {/* Fixed Bottom Nav */}
        <nav style={{
          position: 'fixed', bottom: 0, zIndex: 200,
          left: 0, right: 0,
          width: '100%',
          height: 'auto',
          minHeight: '56px',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          background: 'rgba(11,17,30,0.97)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'stretch',
        }}>
          {TABS.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path} style={({ isActive }) => ({
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: '2px', textDecoration: 'none',
              color: isActive ? '#f97316' : '#475569',
              fontSize: '9px', fontWeight: isActive ? '600' : '500',
              transition: 'color 0.15s', position: 'relative',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
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
