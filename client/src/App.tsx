import { Routes, Route, Navigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { clearAdminToken, getAdminToken } from './lib/token-store';
import Login from './pages/Login';
import Signup from './pages/Signup';
import AdminLogin from './pages/AdminLogin';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';

import AdminDashboard from './pages/AdminDashboard';
import AnalyzePage from './pages/AnalyzePage';
import AnalysisResultPage from './pages/AnalysisResultPage';
import HistoryPage from './pages/HistoryPage';
import HeuristicAnalysisPage from './pages/HeuristicAnalysis';

function AdminRoute({ children }: { children: JSX.Element }) {
  const token = getAdminToken();
  if (!token) return <Navigate to="/admin/login" replace />;

  try {
    const decoded = jwtDecode<{ accountType?: string; exp?: number }>(token);
    const isExpired = typeof decoded.exp === 'number' && decoded.exp * 1000 <= Date.now();
    const isAdmin = (decoded.accountType || '').toLowerCase() === 'admin';
    if (isExpired || !isAdmin) {
      clearAdminToken();
      return <Navigate to="/admin/login" replace />;
    }
    return children;
  } catch {
    clearAdminToken();
    return <Navigate to="/admin/login" replace />;
  }
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/dashboard" element={<Navigate to="/user/dashboard" replace />} />
      <Route path="/user-dashboard" element={<Navigate to="/user/dashboard" replace />} />
      <Route path="/user/dashboard" element={<Dashboard />} />
      <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="/analyze" element={<AnalyzePage />} />
      <Route path="/analysis/:id" element={<AnalysisResultPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/heuristic-analysis" element={<HeuristicAnalysisPage />} />
    </Routes>
  );
}

export default App;
