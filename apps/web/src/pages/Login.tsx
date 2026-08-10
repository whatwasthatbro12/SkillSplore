import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import type { SelfUser } from '../lib/types.js';
import { Alert, Button, Card, Field, Input } from '../components/ui.js';
import { GoogleButton, OAUTH_ERRORS } from '../components/GoogleButton.js';

export function Login() {
  const { setUser, config } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  // The Google callback redirects here with ?error=... when it cannot finish.
  const [params] = useSearchParams();
  const oauthError = OAUTH_ERRORS[params.get('error') ?? ''] ?? null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = (user: SelfUser) => { setUser(user); navigate(from, { replace: true }); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { user } = await api.post<{ user: SelfUser }>('/auth/login', { email, password });
      finish(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.');
    } finally { setBusy(false); }
  };

  const demoLogin = async (role: string) => {
    setBusy(true); setError(null);
    try {
      const { user } = await api.post<{ user: SelfUser }>('/auth/demo-login', { role });
      finish(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demo login failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="container-narrow" style={{ margin: '0 auto' }}>
      <Card>
        <div className="card-body">
          <h1>Log in</h1>
          {error && <Alert type="error">{error}</Alert>}
          {oauthError && <Alert type="error">{oauthError}</Alert>}
          <GoogleButton label="Continue with Google" />
          <form onSubmit={submit}>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Button type="submit" variant="primary" className="btn-block" loading={busy}>Log in</Button>
          </form>
          <div className="row-wrap" style={{ marginTop: 12, justifyContent: 'space-between' }}>
            <Link to="/forgot-password">Forgot password?</Link>
            <span className="muted">No account? <Link to="/register">Sign up</Link></span>
          </div>
        </div>
      </Card>

      {config?.demoLoginEnabled && (
        <Card className="mt-0" >
          <div className="card-body">
            <h3>Demo login shortcuts</h3>
            <p className="muted" style={{ fontSize: '0.88rem' }}>These one-click logins exist only in the demonstration environment.</p>
            <div className="row-wrap">
              <Button onClick={() => demoLogin('admin')} disabled={busy}>Administrator</Button>
              <Button onClick={() => demoLogin('student')} disabled={busy}>Student</Button>
              <Button onClick={() => demoLogin('tutor')} disabled={busy}>Approved tutor</Button>
              <Button onClick={() => demoLogin('pending_tutor')} disabled={busy}>Pending tutor</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
