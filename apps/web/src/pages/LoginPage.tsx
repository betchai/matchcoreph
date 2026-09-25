import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, LogIn, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { api } from '../lib/api.js';
import { Spinner } from '../components/ui.js';

type Stage = 'login' | 'change';

const inputBase =
  'w-full rounded-lg border bg-panel text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 disabled:opacity-60';
const inputOk = 'border-line focus:border-brand focus:ring-brand/20';
const inputBad = 'border-red/60 focus:border-red focus:ring-red/20';

export default function LoginPage() {
  const { user, ready, login, logout, setUser } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [changeErrors, setChangeErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const newPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && user && stage === 'login') navigate('/', { replace: true });
  }, [ready, user, stage, navigate]);

  useEffect(() => {
    if (stage === 'change') newPasswordRef.current?.focus();
  }, [stage]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <Spinner />
      </div>
    );
  }
  if (user && stage === 'login') return <Navigate to="/" replace />;

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrors = {};
    if (!username.trim()) errs.username = 'Enter your username or email.';
    if (!password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    setServerError('');
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const me = await login(username.trim(), password);
      if (me.mustChangePassword) {
        setStage('change');
        setNotice(`Welcome${me.displayName ? `, ${me.displayName}` : ''}. Set a new password to continue.`);
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function submitChange(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof changeErrors = {};
    if (newPassword.length < 8) errs.newPassword = 'Use at least 8 characters.';
    if (newPassword !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    setChangeErrors(errs);
    setServerError('');
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await api('/api/auth/password', { method: 'POST', json: { currentPassword: password, newPassword } });
      if (user) setUser({ ...user, mustChangePassword: false });
      navigate('/', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not update your password.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelChange() {
    await logout();
    setStage('login');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setServerError('');
  }

  const passwordToggler = (open: boolean, setOpen: (v: boolean) => void) => (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? 'Hide password' : 'Show password'}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
    >
      {open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <a href="/landing" className="flex items-center gap-2.5">
            <img src="/ico.png" alt="MatchCorePH logo" className="h-12 w-12 rounded-2xl object-cover shadow-card" />
            <span className="text-xl font-black tracking-tight text-ink">MatchCore<span className="text-[#ff7ab0]">PH</span></span>
          </a>
          <p className="mt-2 text-sm text-muted">by BLink Services</p>
        </div>

        <div className="rounded-card border border-line bg-panel p-6 shadow-card sm:p-8">
          {stage === 'login' ? (
            <form className="space-y-5" onSubmit={submitLogin} noValidate>
              <div className="space-y-1.5">
                <h2 className="text-lg font-bold text-ink">Welcome back</h2>
                <p className="text-sm text-muted">Sign in to manage your matches.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="username" className="block text-xs font-bold text-muted">Username or email</label>
                  <div className="relative mt-1.5">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id="username"
                      name="username"
                      autoComplete="username"
                      autoFocus
                      placeholder="you@club.org"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.username)}
                      className={`${inputBase} py-2.5 pl-9 pr-3 ${inputOk} ${fieldErrors.username ? inputBad : ''}`}
                    />
                  </div>
                  {fieldErrors.username ? <p className="mt-1 text-xs text-red">{fieldErrors.username}</p> : null}
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-bold text-muted">Password</label>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={Boolean(fieldErrors.password)}
                      className={`${inputBase} py-2.5 pl-9 pr-10 ${inputOk} ${fieldErrors.password ? inputBad : ''}`}
                    />
                    {passwordToggler(showPassword, setShowPassword)}
                  </div>
                  {fieldErrors.password ? <p className="mt-1 text-xs text-red">{fieldErrors.password}</p> : null}
                </div>
              </div>

              {serverError ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#5a3030] bg-[#3a2626] px-3 py-2.5 text-sm text-[#ff9b9b]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{serverError}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold text-[#17181a] transition hover:bg-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-60"
              >
                {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={submitChange} noValidate>
              <div className="space-y-1.5">
                <h2 className="text-lg font-bold text-ink">Set a new password</h2>
                <p className="text-sm text-muted">{notice || 'Your first sign-in requires a new password.'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="newPassword" className="block text-xs font-bold text-muted">New password</label>
                  <div className="relative mt-1.5">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      ref={newPasswordRef}
                      id="newPassword"
                      name="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      aria-invalid={Boolean(changeErrors.newPassword)}
                      className={`${inputBase} py-2.5 pl-9 pr-10 ${inputOk} ${changeErrors.newPassword ? inputBad : ''}`}
                    />
                    {passwordToggler(showNewPassword, setShowNewPassword)}
                  </div>
                  {changeErrors.newPassword ? <p className="mt-1 text-xs text-red">{changeErrors.newPassword}</p> : null}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-xs font-bold text-muted">Confirm new password</label>
                  <div className="relative mt-1.5">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      aria-invalid={Boolean(changeErrors.confirmPassword)}
                      className={`${inputBase} py-2.5 pl-9 pr-10 ${inputOk} ${changeErrors.confirmPassword ? inputBad : ''}`}
                    />
                  </div>
                  {changeErrors.confirmPassword ? <p className="mt-1 text-xs text-red">{changeErrors.confirmPassword}</p> : null}
                </div>
              </div>

              {serverError ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#5a3030] bg-[#3a2626] px-3 py-2.5 text-sm text-[#ff9b9b]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{serverError}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold text-[#17181a] transition hover:bg-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-60"
              >
                {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? 'Updating…' : 'Set new password'}
              </button>

              <div className="text-center">
                <button type="button" onClick={() => void cancelChange()} className="text-xs font-semibold text-muted transition hover:text-ink">
                  Use a different account
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}