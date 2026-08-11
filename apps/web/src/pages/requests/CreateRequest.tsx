import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useAuth } from '../../lib/auth.js';
import { useToast } from '../../lib/toast.js';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '../../components/ui.js';
import { SuggestSubjectModal } from '../../components/SuggestSubjectModal.js';
import { COUNTRY_OPTIONS } from '../../lib/countries.js';

type LevelTrack = 'ACADEMIC' | 'PROFESSIONAL';
interface Category { id: number; name: string; levelTracks: LevelTrack[]; subjects: Array<{ id: number; name: string }> }
interface Level { id: number; name: string; track: LevelTrack }

export function CreateRequest() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  // Under-18 accounts can arrange online lessons only, so in-person is not
  // offered rather than offered and then rejected. The API enforces the same
  // rule -- a hidden option is not a control.
  const onlineOnly = !!user?.isMinor;
  const { data: cats, reload: reloadCats } = useApi<{ categories: Category[] }>('/taxonomy/categories');
  const { data: lvls } = useApi<{ levels: Level[] }>('/taxonomy/levels');
  const [form, setForm] = useState({ kind: 'LEARNING', subjectId: '', levelId: '', title: '', description: '', deliveryMode: 'BOTH', country: '', city: '', budgetMin: '', budgetMax: '', timing: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Only offer levels that mean something for the chosen subject. Asking
  // someone looking for SEO help whether they want NCEA Level 2 is the same
  // mismatch tutors hit on their own profile.
  const levelOptions = useMemo(() => {
    const all = lvls?.levels ?? [];
    if (!form.subjectId) return all;
    const owner = (cats?.categories ?? []).find(
      (c) => c.subjects.some((sub) => String(sub.id) === form.subjectId),
    );
    if (!owner) return all;
    return all.filter((l) => owner.levelTracks.includes(l.track));
  }, [lvls, cats, form.subjectId]);

  const submit = async (publish: boolean) => {
    setError(null); setBusy(true);
    try {
      const body = {
        kind: form.kind,
        subjectId: Number(form.subjectId),
        levelId: form.levelId ? Number(form.levelId) : null,
        title: form.title,
        description: form.description,
        deliveryMode: onlineOnly ? 'ONLINE' : form.deliveryMode,
        country: form.country || undefined,
        city: form.city || undefined,
        budgetMinCents: form.budgetMin ? Math.round(Number(form.budgetMin) * 100) : null,
        budgetMaxCents: form.budgetMax ? Math.round(Number(form.budgetMax) * 100) : null,
        currency: form.country === 'Australia' ? 'AUD' : 'NZD',
        timing: form.timing || undefined,
        publish,
      };
      const { request } = await api.post<{ request: { id: number } }>('/requests', body);
      toast(publish ? 'Request published' : 'Draft saved', 'success');
      navigate(`/requests/${request.id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to create request.'); }
    finally { setBusy(false); }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(true); };

  const isLearning = form.kind === 'LEARNING';

  return (
    <div className="container-narrow" style={{ margin: '0 auto' }}>
      <h1>{isLearning ? 'Post what you want to learn' : 'Post a service request'}</h1>
      <Card><div className="card-body">
        {error && <Alert type="error">{error}</Alert>}
        <form onSubmit={onSubmit}>
          <Field label="What type of request?">
            <Select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="LEARNING">Learning: I want to learn something (find someone to teach me)</option>
              <option value="SERVICE">Service: I need someone to do something for me</option>
            </Select>
          </Field>
          {form.kind === 'LEARNING' && (
            <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 16 }}>You're looking for a teacher or coach who can help you learn.</p>
          )}
          {form.kind === 'SERVICE' && (
            <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 16 }}>You're looking for someone with a specific skill to provide a service or help you with a project.</p>
          )}
          <Field label="Subject or skill">
            <Select value={form.subjectId} onChange={(e) => set({ subjectId: e.target.value, levelId: '' })} required>
              <option value="">Choose a subject or skill…</option>
              {cats?.categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </Select>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6, padding: '2px 0' }} onClick={() => setSuggesting(true)}>
              Can't find your subject? Suggest one
            </button>
          </Field>
          {suggesting && (
            <SuggestSubjectModal
              initialName=""
              categories={(cats?.categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
              onClose={() => setSuggesting(false)}
              onResolved={(subject) => {
                setSuggesting(false);
                set({ subjectId: String(subject.id), levelId: '' });
                reloadCats();
              }}
            />
          )}
          <Field label="Level (optional)">
            <Select value={form.levelId} onChange={(e) => set({ levelId: e.target.value })}>
              <option value="">Any level</option>
              {levelOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Title"><Input value={form.title} onChange={(e) => set({ title: e.target.value })} required minLength={4} placeholder={isLearning ? "e.g. Help with NCEA Level 3 calculus, or beginner saxophone lessons" : "e.g. I need help painting my living room, or website design for my small business"} /></Field>
          <Field label={isLearning ? "What help do you need?" : "What would you like help with?"}><Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} required minLength={10} placeholder={isLearning ? "Describe what you want to learn..." : "Describe the task or project in detail..."} /></Field>
          <Field
            label="Format"
            hint={onlineOnly
              ? 'Your account is set to under 18, so lessons you arrange yourself are online. For an in-person lesson, ask a parent or guardian to post it from their own account.'
              : undefined}
          >
            <Select
              value={onlineOnly ? 'ONLINE' : form.deliveryMode}
              disabled={onlineOnly}
              onChange={(e) => set({ deliveryMode: e.target.value })}
            >
              {!onlineOnly && <option value="BOTH">Online or in person</option>}
              <option value="ONLINE">Online</option>
              {!onlineOnly && <option value="IN_PERSON">In person</option>}
            </Select>
          </Field>
          {!onlineOnly && form.deliveryMode !== 'ONLINE' && (
            <div className="grid grid-2">
              <Field label="Country">
                <Select value={form.country} onChange={(e) => set({ country: e.target.value })}>
                  <option value="">—</option>
                  {COUNTRY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="City"><Input value={form.city} onChange={(e) => set({ city: e.target.value })} /></Field>
            </div>
          )}
          <div className="grid grid-2">
            <Field label="Budget min / hr (optional)"><Input type="number" min={0} value={form.budgetMin} onChange={(e) => set({ budgetMin: e.target.value })} /></Field>
            <Field label="Budget max / hr (optional)"><Input type="number" min={0} value={form.budgetMax} onChange={(e) => set({ budgetMax: e.target.value })} /></Field>
          </div>
          <Field label="Timing (optional)"><Input value={form.timing} onChange={(e) => set({ timing: e.target.value })} placeholder="e.g. Weekday evenings" /></Field>
          <div className="row">
            <Button type="submit" variant="primary" loading={busy}>Publish request</Button>
            <Button type="button" onClick={() => submit(false)} loading={busy}>Save as draft</Button>
          </div>
        </form>
      </div></Card>
    </div>
  );
}
