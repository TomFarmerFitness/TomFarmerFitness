import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * ProtectedRoute
 * Props:
 *   requiredRole: 'trainer' | 'client' | 'any'
 *   children: JSX to render if authorised
 */
export default function ProtectedRoute({ children, requiredRole = 'any' }) {
  const { isAuthenticated, userType } = useAuth();
  const location = useLocation();

  // Not logged in → redirect to login, preserve attempted URL
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wrong role → redirect to login (not their area)
  if (requiredRole !== 'any' && userType !== requiredRole) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
