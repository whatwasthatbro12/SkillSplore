import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.js';
import { useToast } from '../lib/toast.js';
import type { PublicUser } from '../lib/types.js';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, StatusBadge, Textarea } from '../components/ui.js';
import { dateStr } from '../lib/format.js';

interface Engagement {
  id: number; title: string; status: string; createdAt: string; completedAt: string | null; conversationId: number | null;
  subject: { id: number; name: string } | null; tutor: { profileId: number } & PublicUser; student: PublicUser;
  role: 'student' | 'tutor' | 'observer'; hasReview: boolean; canReview: boolean; paymentNote: string; requestKind?: string;
}

export function Engagements() {
  const { data, loading, reload } = useApi<{ engagements: Engagement[] }>('/engagements');
  const toast = useToast();
  const [reviewing, setReviewing] = useState<Engagement | null>(null);
  const [completing, setCompleting] = useState<Engagement | null>(null);
  const { config } = useAuth();
  const commission = config?.commission;

  const act = async (id: number, action: 'complete' | 'cancel', body?: unknown) => {
    try { await api.post(`/engagements/${id}/${action}`, body ?? {}); toast('Updated', 'success'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
  };

  // Only the tutor is asked what they were paid, and only while commission is
  // switched on. A learner marking a lesson complete has no fee to report, and
  // asking anyone for income figures the platform does not use would be
  // collecting data for no stated purpose.
  const askForFee = (e: Engagement) => commission?.enabled && e.role === 'tutor';

  if (loading) return <Spinner />;
  const list = data?.engagements ?? [];

  return (
    <div className="stack">
      <h1>Engagements</h1>
      <p className="muted">Record and track learning and service arrangements you’ve made. Payment is handled directly between both people.</p>
      {list.length === 0 ? <EmptyState emoji="🤝" title="No engagements yet">Arrange one from a conversation once you’ve agreed to work together.</EmptyState> : (
        <div className="grid grid-cards">
          {list.map((e) => (
            <Card key={e.id}><div className="card-body stack-sm">
              <div className="spread"><strong>{e.title}</strong><StatusBadge status={e.status} /></div>
              <div className="muted" style={{ fontSize: '0.86rem' }}>
                {e.subject && <Badge>{e.subject.name}</Badge>}{' '}
                {e.role === 'student' ? `with ${e.tutor.displayName}` : `for ${e.student.displayName}`} · {dateStr(e.createdAt)}
              </div>
              <div className="row-wrap">
                {e.conversationId && <Link className="btn btn-sm" to={`/messages/${e.conversationId}`}>Open chat</Link>}
                {e.status === 'ARRANGED' && (
                  <Button
                    className="btn-sm"
                    variant="primary"
                    onClick={() => (askForFee(e) ? setCompleting(e) : act(e.id, 'complete'))}
                  >
                    Mark completed
                  </Button>
                )}
                {e.status === 'ARRANGED' && <Button className="btn-sm" onClick={() => act(e.id, 'cancel')}>Cancel</Button>}
                {e.canReview && <Button className="btn-sm" variant="accent" onClick={() => setReviewing(e)}>Leave a review</Button>}
                {e.hasReview && <Badge variant="success">Reviewed</Badge>}
              </div>
            </div></Card>
          ))}
        </div>
      )}
      {reviewing && <ReviewModal engagement={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); reload(); }} />}
      {completing && commission && (
        <CompleteModal
          engagement={completing}
          ratePercent={commission.ratePercent}
          onClose={() => setCompleting(null)}
          onConfirm={async (paidCents) => {
            await act(completing.id, 'complete', { paidCents });
            setCompleting(null);
          }}
        />
      )}
    </div>
  );
}

function ReviewModal({ engagement, onClose, onDone }: { engagement: Engagement; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/reviews', { engagementId: engagement.id, rating, title: title || undefined, body });
      toast('Review published', 'success');
      onDone();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Review ${engagement.tutor.displayName}`} onClose={onClose}>
      <Field label="Rating">
        <div className="stars" role="radiogroup" aria-label="Rating out of 5 stars" style={{ fontSize: '1.6rem' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === rating}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className={n <= rating ? '' : 'empty'}
              style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </div>
      </Field>
      <Field label="Title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Your review"><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share your experience and feedback." /></Field>
      <Button variant="primary" className="btn-block" loading={busy} disabled={body.trim().length < 4} onClick={submit}>Publish review</Button>
    </Modal>
  );
}

/**
 * Asks the tutor what they were actually paid.
 *
 * SkillSplore never sees the payment, so this number is the only basis a
 * percentage fee can be calculated from. That makes honesty about it part of
 * the interface rather than something buried in the Terms: the fee is shown
 * live as the amount is typed, so nobody discovers what they owe afterwards.
 *
 * Zero is a legitimate answer -- a free trial lesson, a favour, a session the
 * learner never paid for. Forcing a positive number would push people toward
 * inventing one.
 */
function CompleteModal({
  engagement, ratePercent, onClose, onConfirm,
}: {
  engagement: Engagement;
  ratePercent: number;
  onClose: () => void;
  onConfirm: (paidCents: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const paidCents = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const valid = paidCents !== null && Number.isFinite(paidCents) && paidCents >= 0;
  const feeCents = valid ? Math.round((paidCents * ratePercent) / 100) : 0;

  return (
    <Modal title={`Mark "${engagement.title}" completed`} onClose={onClose}>
      <p className="muted">
        What were you paid for this? SkillSplore does not handle the payment, so this is the only
        way we know — and it is what our {ratePercent}% fee is calculated from.
      </p>
      <Field label="Amount you were paid">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
      </Field>
      {valid && (
        <p className="hint">
          SkillSplore fee: <strong>${(feeCents / 100).toFixed(2)}</strong> ({ratePercent}% of $
          {(paidCents / 100).toFixed(2)}). Nothing is charged yet — this is recorded so you can
          see it building up.
        </p>
      )}
      <p className="hint">
        Enter 0 if this was a free or trial session. Nothing is owed on a lesson you were not
        paid for.
      </p>
      <div className="row-wrap" style={{ marginTop: 14 }}>
        <Button
          variant="primary"
          loading={busy}
          disabled={!valid}
          onClick={async () => { setBusy(true); try { await onConfirm(paidCents!); } finally { setBusy(false); } }}
        >
          Confirm completed
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
