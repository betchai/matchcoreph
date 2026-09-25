import { Component, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { useAuth } from './store/auth.js';
import { Spinner } from './components/ui.js';
import Shell from './components/Shell.js';
import LoginPage from './pages/LoginPage.js';
import OrgsPage from './pages/OrgsPage.js';
import MatchesPage from './pages/MatchesPage.js';
import MatchPage from './pages/MatchPage.js';
import StagesPage from './pages/StagesPage.js';
import UsersPage from './pages/UsersPage.js';
import ShootersPage from './pages/ShootersPage.js';
import AuditPage from './pages/AuditPage.js';
import ConfigurePage from './pages/ConfigurePage.js';
import ScoringPage from './pages/ScoringPage.js';
import ControlPage from './pages/ControlPage.js';
import ResultsPage from './pages/ResultsPage.js';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-app p-8">
          <div className="mx-auto max-w-xl rounded-card border border-line bg-panel p-6 shadow-card">
            <p className="text-sm font-bold text-red-400">Something went wrong rendering this page.</p>
            <pre className="mt-3 overflow-auto text-xs text-muted">{String(this.state.error?.message ?? this.state.error)}</pre>
            <button
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[#17181a]"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="text-4xl font-extrabold text-ink">404</p>
      <p className="text-sm text-muted">That page doesn't exist.</p>
      <Link to="/" className="mt-2 text-sm font-semibold text-brand hover:underline">Back to organizations</Link>
    </div>
  );
}

export default function App() {
  const { ready, user, restore } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready) return;
    void restore().then((ok) => { if (!ok) navigate('/login'); });
  }, [ready, restore, navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <Spinner />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={user ? null : <Navigate to="/login" replace />}>
          <Route path="/" element={<Shell title="Dashboard"><OrgsPage /></Shell>} />
          <Route path="/platform/shooters" element={<Shell title="Shooters"><ShootersPage /></Shell>} />
          <Route path="/platform/audit" element={<Shell title="Audit log"><AuditPage /></Shell>} />
          <Route path="/orgs/:orgId" element={<Shell title="Matches"><MatchesPage /></Shell>} />
          <Route path="/orgs/:orgId/users" element={<Shell title="Users"><UsersPage /></Shell>} />
          <Route path="/orgs/:orgId/shooters" element={<Shell title="Shooters"><ShootersPage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId" element={<Shell title="Match"><MatchPage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId/stages" element={<Shell title="Stages"><StagesPage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId/configure" element={<Shell title="Match setup"><ConfigurePage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId/scoring" element={<Shell title="Score entry"><ScoringPage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId/control" element={<Shell title="Control center"><ControlPage /></Shell>} />
          <Route path="/orgs/:orgId/matches/:matchId/results" element={<Shell title="Live results"><ResultsPage /></Shell>} />
          <Route path="*" element={<Shell title="Not found"><NotFound /></Shell>} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}