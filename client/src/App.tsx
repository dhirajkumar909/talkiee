import { Routes, Route, Navigate } from 'react-router-dom';
import { isSupabaseConfigured } from './lib/supabase';
import { SetupNotice } from './components/SetupNotice';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { OfficeRoom } from './pages/OfficeRoom';
import { OfficeEditor } from './pages/OfficeEditor';

export default function App() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/office/:id" element={<OfficeRoom />} />
        <Route path="/office/:id/edit" element={<OfficeEditor />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
