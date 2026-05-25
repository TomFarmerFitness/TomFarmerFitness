import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { ToastProvider }  from './components/shared/Toast';
import ProtectedRoute     from './components/shared/ProtectedRoute';
import TrainerLayout      from './components/trainer/TrainerLayout';
import ClientLayout       from './components/client/ClientLayout';
import LoginPage          from './pages/auth/LoginPage';
import { isDataStale }    from './utils/sheets';

// ─── Lazy-loaded trainer pages ────────────────────────────────────────────────
const TrainerDashboard   = lazy(() => import('./pages/trainer/TrainerDashboard'));
const ClientsPage        = lazy(() => import('./pages/trainer/ClientsPage'));
const ClientDetailPage   = lazy(() => import('./pages/trainer/ClientDetailPage'));
const ProgramLibraryPage = lazy(() => import('./pages/trainer/ProgramLibraryPage'));
const ExercisesPage      = lazy(() => import('./pages/trainer/ExercisesPage'));
const FlaggedQuestionsPage = lazy(() => import('./pages/trainer/FlaggedQuestionsPage'));
const SettingsPage       = lazy(() => import('./pages/trainer/SettingsPage'));

// ─── Lazy-loaded client pages ─────────────────────────────────────────────────
const TodayPage     = lazy(() => import('./pages/client/TodayPage'));
const TrainingPage  = lazy(() => import('./pages/client/TrainingPage'));
const NutritionPage = lazy(() => import('./pages/client/NutritionPage'));
const ProgressPage  = lazy(() => import('./pages/client/ProgressPage'));
const AskPage       = lazy(() => import('./pages/client/AskPage'));

// ─── Suspense fallback ────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', gap: '10px', color: '#64748b', fontSize: '13px',
    }}>
      <span style={{
        display: 'inline-block', width: '18px', height: '18px',
        border: '2px solid rgba(255,255,255,0.1)',
        borderTopColor: '#f97316', borderRadius: '50%',
        animation: 'spin 0.75s linear infinite',
      }} />
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Stale data banner (shown when serving cached data after network failure) ──
function StaleBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isDataStale());
    const id = setInterval(() => setShow(isDataStale()), 10000);
    return () => clearInterval(id);
  }, []);

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 8000,
      background: 'rgba(234,179,8,0.12)', borderBottom: '1px solid rgba(234,179,8,0.3)',
      padding: '8px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
      fontSize: '12px', color: '#fbbf24',
    }}>
      <span>⚠</span>
      <span>Showing cached data — you appear to be offline</span>
      <button onClick={() => { window.location.reload(); }}
        style={{ background: 'none', border: '1px solid rgba(234,179,8,0.4)',
          borderRadius: '6px', color: '#fbbf24', fontSize: '11px',
          padding: '2px 8px', cursor: 'pointer', marginLeft: '4px',
          touchAction: 'manipulation' }}>
        Retry
      </button>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ToastProvider>
      <StaleBanner />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Trainer area */}
          <Route
            path="/trainer"
            element={
              <ProtectedRoute requiredRole="trainer">
                <TrainerLayout />
              </ProtectedRoute>
            }
          >
            <Route index                     element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard"          element={<TrainerDashboard />} />
            <Route path="clients"            element={<ClientsPage />} />
            <Route path="clients/:clientId"  element={<ClientDetailPage />} />
            <Route path="programs"           element={<ProgramLibraryPage />} />
            <Route path="exercises"          element={<ExercisesPage />} />
            <Route path="flagged"            element={<FlaggedQuestionsPage />} />
            <Route path="settings"           element={<SettingsPage />} />
          </Route>

          {/* Client area */}
          <Route
            path="/client"
            element={
              <ProtectedRoute requiredRole="client">
                <ClientLayout />
              </ProtectedRoute>
            }
          >
            <Route index             element={<Navigate to="today" replace />} />
            <Route path="today"      element={<TodayPage />} />
            <Route path="training"   element={<TrainingPage />} />
            <Route path="nutrition"  element={<NutritionPage />} />
            <Route path="progress"   element={<ProgressPage />} />
            <Route path="ask"        element={<AskPage />} />
          </Route>

          {/* Root fallback */}
          <Route path="/"  element={<Navigate to="/login" replace />} />
          <Route path="*"  element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </ToastProvider>
  );
}
