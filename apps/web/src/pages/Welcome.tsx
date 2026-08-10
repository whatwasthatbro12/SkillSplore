import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Alert, Button, Card } from '../components/ui.js';

/**
 * The one question Google cannot answer.
 *
 * A password signup asks whether the person is 18 or over, because that
 * decides whether in-person lessons are offered to them at all. Google returns
 * a name and an email address and nothing about age, so an account created
 * through it would otherwise silently take the default.
 *
 * Defaulting either way is wrong. Assuming adult would offer a 14-year-old
 * in-person meetings with strangers; assuming minor would quietly restrict
 * adults with no explanation. So it is asked once, immediately, with no
 * pre-selected answer and no way to skip past it.
 */
export function Welcome() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (isAdult: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ user: typeof user }>('/auth/me/age-declaration', { isAdult });
      if (res.user) setUser(res.user);
      navigate('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="container-narrow" style={{ margin: '0 auto' }}>
      <Card><div className="card-body">
        <h1 className="mt-0">Welcome{user?.displayName ? `, ${user.displayName}` : ''}</h1>
        <p className="muted">
          One question before you start. Your answer decides whether in-person lessons are
          offered to you — under-18 accounts arrange lessons online only.
        </p>

        {error && <Alert type="error">{error}</Alert>}

        <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Are you 18 or over?</h2>
        <div className="row-wrap" style={{ gap: 10 }}>
          <Button variant="primary" loading={busy} onClick={() => choose(true)}>
            Yes, I am 18 or over
          </Button>
          <Button loading={busy} onClick={() => choose(false)}>
            No, I am under 18
          </Button>
        </div>

        <p className="hint" style={{ marginTop: 18 }}>
          Under-18 accounts can do everything else on SkillSplore — browse, post what you want
          to learn, message people and arrange online lessons. Only in-person meetings are
          unavailable.
        </p>
      </div></Card>
    </div>
  );
}
