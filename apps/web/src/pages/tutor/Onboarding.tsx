import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/toast.js';
import type { Money } from '../../lib/types.js';
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, StatusBadge, Textarea } from '../../components/ui.js';
import { SuggestSubjectModal } from '../../components/SuggestSubjectModal.js';
import { CREDENTIALS_SELF_DECLARED } from '../../lib/trustCopy.js';
import { slotLabel } from '../../lib/format.js';

interface OwnProfile {
  id: number; status: string; headline: string | null; experience: string | null; teachingStyle: string | null;
  deliveryMode: string; country: string | null; city: string | null; locationNote: string | null; travelRadiusKm: number | null;
  availabilityNote: string | null; hourlyRateCents: number | null; currency: string; yearsExperience: number | null; changeRequestNote: string | null;
  subjects: Array<{ subjectId: number; name: string; priceCents: number | null; price: Money | null }>;
  levels: Array<{ id: number; name: string }>;
  availability: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  qualifications: Array<{ id: number; title: string; institution: string | null; year: number | null; documentName: string | null; hasDocument: boolean; documentUrl: string | null; verified: boolean }>;
}
type LevelTrack = 'ACADEMIC' | 'PROFESSIONAL';
interface Subject { id: number; name: string; category: { name: string; levelTracks: LevelTrack[] } | null }
interface Level { id: number; name: string; track: LevelTrack }

// Mirrors applicableLevelTracks in the API. A tutor is shown only the ladders
// their chosen subjects actually use, and the union when they teach across
// both -- so someone who teaches NCEA calculus and SEO sees school levels for
// the first and experience levels for the second.
const TRACK_LABEL: Record<LevelTrack, string> = {
  ACADEMIC: 'School & university levels',
  PROFESSIONAL: 'Experience levels',
};
const TRACK_HINT: Record<LevelTrack, string> = {
  ACADEMIC: 'For subjects that follow a school or university curriculum.',
  PROFESSIONAL: 'How much experience your learners start with.',
};

const STEPS = ['Profile', 'Subjects & levels', 'Availability', 'Qualifications', 'Review'];

export function Onboarding() {
  const { data, loading, reload } = useApi<{ profile: OwnProfile | null }>('/tutors/me');
  const [step, setStep] = useState(0);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const startProfile = async () => {
    setBusy(true);
    try { await api.post('/tutors/apply'); toast('Teaching profile started', 'success'); reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  const profile = data?.profile;

  if (!profile) {
    return (
      <div className="container-narrow" style={{ margin: '0 auto' }}>
        <Card><div className="card-body center">
          <h1>Create a teaching profile</h1>
          <p className="muted">Introduce what you can teach, get approved by our team, and start appearing in search and matching requests. You set your own rates.</p>
          <Button variant="primary" loading={busy} onClick={startProfile}>Start my teaching profile</Button>
        </div></Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread"><h1 className="mt-0">Teaching profile</h1><StatusBadge status={profile.status} /></div>
      {profile.status === 'CHANGES_REQUESTED' && profile.changeRequestNote && (
        <Alert type="info"><strong>Changes requested:</strong> {profile.changeRequestNote}</Alert>
      )}
      {profile.status === 'APPROVED' && <Alert type="success">Your profile is live and searchable. <Link to={`/tutors/${profile.id}`}>View public profile</Link></Alert>}

      <div className="stepper" role="tablist" aria-label="Onboarding steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={i === step}
            className={`step ${i === step ? 'active' : ''}`}
            onClick={() => setStep(i)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {step === 0 && <ProfileStep profile={profile} onSaved={reload} />}
      {step === 1 && <SubjectsStep profile={profile} onSaved={reload} />}
      {step === 2 && <AvailabilityStep profile={profile} onSaved={reload} />}
      {step === 3 && <QualificationsStep profile={profile} onSaved={reload} />}
      {step === 4 && <ReviewStep profile={profile} onSaved={reload} />}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← Back</Button>
        {step < STEPS.length - 1 && <Button variant="primary" onClick={() => setStep((s) => s + 1)}>Next →</Button>}
      </div>
    </div>
  );
}

function ProfileStep({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    headline: profile.headline ?? '', experience: profile.experience ?? '', teachingStyle: profile.teachingStyle ?? '',
    yearsExperience: profile.yearsExperience?.toString() ?? '', deliveryMode: profile.deliveryMode,
    country: profile.country ?? '', city: profile.city ?? '', locationNote: profile.locationNote ?? '',
    travelRadiusKm: profile.travelRadiusKm?.toString() ?? '', hourlyRate: profile.hourlyRateCents ? String(profile.hourlyRateCents / 100) : '',
    currency: profile.currency, availabilityNote: profile.availabilityNote ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/tutors/me', {
        headline: f.headline, experience: f.experience, teachingStyle: f.teachingStyle,
        yearsExperience: f.yearsExperience ? Number(f.yearsExperience) : null,
        deliveryMode: f.deliveryMode, country: f.country || undefined, city: f.city || undefined,
        locationNote: f.locationNote || undefined, travelRadiusKm: f.travelRadiusKm ? Number(f.travelRadiusKm) : null,
        hourlyRateCents: f.hourlyRate ? Math.round(Number(f.hourlyRate) * 100) : null, currency: f.currency,
        availabilityNote: f.availabilityNote || undefined,
      });
      toast('Saved', 'success'); onSaved();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Card><div className="card-body">
      <Field label="Headline"><Input value={f.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="e.g. Experienced maths & physics tutor, or jazz guitar teacher" /></Field>
      <Field label="Experience"><Textarea value={f.experience} onChange={(e) => set({ experience: e.target.value })} /></Field>
      <Field label="Teaching style"><Textarea value={f.teachingStyle} onChange={(e) => set({ teachingStyle: e.target.value })} /></Field>
      <div className="grid grid-2">
        <Field label="Years of experience"><Input type="number" min={0} value={f.yearsExperience} onChange={(e) => set({ yearsExperience: e.target.value })} /></Field>
        <Field label="Delivery">
          <Select value={f.deliveryMode} onChange={(e) => set({ deliveryMode: e.target.value })}>
            <option value="ONLINE">Online only</option><option value="IN_PERSON">In person only</option><option value="BOTH">Online or in person</option>
          </Select>
        </Field>
      </div>
      {f.deliveryMode !== 'ONLINE' && (
        <div className="grid grid-2">
          <Field label="Country"><Select value={f.country} onChange={(e) => set({ country: e.target.value })}><option value="">—</option><option>New Zealand</option><option>Australia</option></Select></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <Field label="Location note"><Input value={f.locationNote} onChange={(e) => set({ locationNote: e.target.value })} placeholder="e.g. Central suburbs" /></Field>
          <Field label="Travel radius (km)"><Input type="number" min={0} value={f.travelRadiusKm} onChange={(e) => set({ travelRadiusKm: e.target.value })} /></Field>
        </div>
      )}
      <div className="grid grid-2">
        <Field label="Default hourly rate"><Input type="number" min={0} value={f.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value })} /></Field>
        <Field label="Currency"><Select value={f.currency} onChange={(e) => set({ currency: e.target.value })}><option>NZD</option><option>AUD</option></Select></Field>
      </div>
      <Field label="Availability note"><Input value={f.availabilityNote} onChange={(e) => set({ availabilityNote: e.target.value })} placeholder="e.g. Weekday evenings and weekends" /></Field>
      <Button variant="primary" loading={busy} onClick={save}>Save progress</Button>
    </div></Card>
  );
}

function SubjectsStep({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const toast = useToast();
  const { data: subs, reload: reloadSubjects } = useApi<{ subjects: Subject[] }>('/taxonomy/subjects');
  const { data: lvls } = useApi<{ levels: Level[] }>('/taxonomy/levels');
  const { data: cats } = useApi<{ categories: Array<{ id: number; name: string }> }>('/taxonomy/categories');
  const [selected, setSelected] = useState<Record<number, string>>(
    Object.fromEntries(profile.subjects.map((s) => [s.subjectId, s.priceCents ? String(s.priceCents / 100) : ''])),
  );
  const [levelIds, setLevelIds] = useState<Set<number>>(new Set(profile.levels.map((l) => l.id)));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  const toggle = (id: number) => setSelected((s) => { const n = { ...s }; if (id in n) delete n[id]; else n[id] = ''; return n; });
  const toggleLevel = (id: number) => setLevelIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/tutors/me/subjects', { subjects: Object.entries(selected).map(([id, price]) => ({ subjectId: Number(id), priceCents: price ? Math.round(Number(price) * 100) : null })) });
      await api.put('/tutors/me/levels', { levelIds: [...levelIds] });
      toast('Saved', 'success'); onSaved();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  // Derived from `selected` rather than from the saved profile, so ticking a
  // subject updates the level list immediately instead of after a save.
  const activeTracks = useMemo<LevelTrack[]>(() => {
    const tracks = new Set<LevelTrack>();
    for (const s of subs?.subjects ?? []) {
      if (!(s.id in selected)) continue;
      for (const t of s.category?.levelTracks ?? []) tracks.add(t);
    }
    return (['ACADEMIC', 'PROFESSIONAL'] as const).filter((t) => tracks.has(t));
  }, [subs, selected]);

  // Ticked levels that no longer belong to any applicable track.
  const staleLevels = useMemo(
    () => (lvls?.levels ?? []).filter((l) => levelIds.has(l.id) && !activeTracks.includes(l.track)),
    [lvls, levelIds, activeTracks],
  );

  const q = filter.trim().toLowerCase();
  const visible = (subs?.subjects ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || selected[s.id] !== undefined);
  const byCategory = new Map<string, Subject[]>();
  for (const s of visible) {
    const key = s.category?.name ?? 'Other';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(s);
  }

  return (
    <Card><div className="card-body">
      <h3 className="mt-0">Subjects you teach</h3>
      <p className="muted">Tick your subjects. Leave the price blank to use your default rate, or set a subject-specific price.</p>
      <Field label="Filter subjects"><Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search subjects, e.g. “piano” or “programming”…" /></Field>
      <div className="stack">
        {[...byCategory.entries()].map(([cat, list]) => (
          <div key={cat}>
            <div className="muted" style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '10px 0 6px' }}>{cat}</div>
            <div className="stack-sm">
              {list.map((s) => (
                <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <label className="check"><input type="checkbox" checked={s.id in selected} onChange={() => toggle(s.id)} /><span>{s.name}</span></label>
                  {s.id in selected && <Input type="number" min={0} placeholder="default" value={selected[s.id]} onChange={(e) => setSelected((x) => ({ ...x, [s.id]: e.target.value }))} style={{ width: 120 }} />}
                </div>
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="muted">
            No subjects match “{filter}”.{' '}
            {filter.trim().length >= 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSuggesting(true)}>
                Suggest “{filter.trim()}”
              </button>
            )}
          </p>
        )}
      </div>
      {suggesting && (
        <SuggestSubjectModal
          initialName={filter.trim()}
          categories={cats?.categories ?? []}
          onClose={() => setSuggesting(false)}
          onResolved={(subject) => {
            setSuggesting(false);
            setFilter('');
            setSelected((s) => ({ ...s, [subject.id]: '' }));
            reloadSubjects();
          }}
        />
      )}
      <div className="divider" />
      <h3>Levels you teach</h3>
      {activeTracks.length === 0 ? (
        <p className="muted">Choose your subjects above and the relevant levels will appear here.</p>
      ) : (
        activeTracks.map((track) => {
          const levels = (lvls?.levels ?? []).filter((l) => l.track === track);
          if (levels.length === 0) return null;
          return (
            <div key={track} style={{ marginBottom: 18 }}>
              {/* Headed even when only one track applies: "Experience levels"
                  tells an SEO tutor the question is about their learners, not
                  about a school year. */}
              <h4 style={{ margin: '0 0 2px' }}>{TRACK_LABEL[track]}</h4>
              <p className="hint" style={{ marginTop: 0 }}>{TRACK_HINT[track]}</p>
              <div className="row-wrap">
                {levels.map((l) => (
                  <label key={l.id} className={`step ${levelIds.has(l.id) ? 'active' : ''}`} style={{ cursor: 'pointer' }}>
                    <input type="checkbox" hidden checked={levelIds.has(l.id)} onChange={() => toggleLevel(l.id)} />{l.name}
                  </label>
                ))}
              </div>
            </div>
          );
        })
      )}
      {staleLevels.length > 0 && (
        // Selections kept from before the academic/professional split, or from
        // a subject since removed. Hiding them would make them silently
        // unremovable, so they stay visible and deselectable until cleared.
        <div style={{ marginBottom: 18 }}>
          <h4 style={{ margin: '0 0 2px' }}>Previously selected</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            These do not match your current subjects. Untick any that no longer apply.
          </p>
          <div className="row-wrap">
            {staleLevels.map((l) => (
              <label key={l.id} className={`step ${levelIds.has(l.id) ? 'active' : ''}`} style={{ cursor: 'pointer' }}>
                <input type="checkbox" hidden checked={levelIds.has(l.id)} onChange={() => toggleLevel(l.id)} />{l.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 16 }}><Button variant="primary" loading={busy} onClick={save}>Save progress</Button></div>
    </div></Card>
  );
}

function AvailabilityStep({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const toast = useToast();
  const [slots, setSlots] = useState(profile.availability);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState('17:00');
  const [end, setEnd] = useState('20:00');
  const [busy, setBusy] = useState(false);
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h! * 60 + m!; };

  const add = () => {
    const s = toMin(start), e = toMin(end);
    if (e <= s) { toast('End must be after start', 'error'); return; }
    setSlots((sl) => [...sl, { dayOfWeek: day, startMinute: s, endMinute: e }]);
  };
  const remove = (i: number) => setSlots((sl) => sl.filter((_, idx) => idx !== i));

  const save = async () => {
    setBusy(true);
    try { await api.put('/tutors/me/availability', { slots }); toast('Saved', 'success'); onSaved(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <Card><div className="card-body">
      <h3 className="mt-0">Weekly availability</h3>
      <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
        <Field label="Day"><Select value={day} onChange={(e) => setDay(Number(e.target.value))}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</Select></Field>
        <Field label="From"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="To"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Button onClick={add}>Add slot</Button>
      </div>
      <div className="row-wrap">
        {slots.length === 0 ? <span className="muted">No slots yet.</span> : slots.map((s, i) => (
          <Badge key={i}>
            {slotLabel(s.dayOfWeek, s.startMinute, s.endMinute)}{' '}
            <button
              type="button"
              aria-label={`Remove ${slotLabel(s.dayOfWeek, s.startMinute, s.endMinute)}`}
              onClick={() => remove(i)}
              style={{ cursor: 'pointer', marginLeft: 4, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit' }}
            >
              ✕
            </button>
          </Badge>
        ))}
      </div>
      <div style={{ marginTop: 16 }}><Button variant="primary" loading={busy} onClick={save}>Save progress</Button></div>
    </div></Card>
  );
}

function QualificationsStep({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [institution, setInstitution] = useState('');
  const [year, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('title', title);
      if (institution) fd.append('institution', institution);
      if (year) fd.append('year', year);
      if (file) fd.append('document', file);
      await api.post('/tutors/me/qualifications', fd);
      toast('Qualification added', 'success');
      setTitle(''); setInstitution(''); setYear(''); setFile(null);
      onSaved();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    try { await api.del(`/tutors/me/qualifications/${id}`); toast('Removed'); onSaved(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
  };

  return (
    <Card><div className="card-body">
      <h3 className="mt-0">Your qualifications</h3>
      <p className="muted">{CREDENTIALS_SELF_DECLARED}</p>
      <p className="hint" style={{ marginTop: 0 }}>
        Uploaded documents stay private — only you and administrators can open them. Learners see
        the title, institution and year, shown as your own statement.
      </p>
      <ul className="list-reset stack-sm">
        {profile.qualifications.map((q) => (
          <li key={q.id} className="spread">
            <span>{q.title} <span className="muted">{[q.institution, q.year].filter(Boolean).join(', ')}</span> {q.hasDocument && <Badge>📎 {q.documentName}</Badge>} {q.verified && <Badge variant="success">Document checked</Badge>}</span>
            <Button className="btn-sm" onClick={() => remove(q.id)}>Remove</Button>
          </li>
        ))}
        {profile.qualifications.length === 0 && <li className="muted">None added yet.</li>}
      </ul>
      <div className="divider" />
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. BSc Mathematics" /></Field>
      <div className="grid grid-2">
        <Field label="Institution"><Input value={institution} onChange={(e) => setInstitution(e.target.value)} /></Field>
        <Field label="Year"><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
      </div>
      <Field label="Document (optional, PDF/image)"><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <Button variant="primary" loading={busy} disabled={title.trim().length < 2} onClick={add}>Add qualification</Button>
    </div></Card>
  );
}

function ReviewStep({ profile, onSaved }: { profile: OwnProfile; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const doAction = async (path: string, label: string) => {
    setBusy(true);
    try { await api.post(path); toast(label, 'success'); onSaved(); }
    catch (e) { toast(e instanceof ApiError ? (e.details?.problems?.join(' ') ?? e.message) : 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Card><div className="card-body">
      <h3 className="mt-0">Review & submit</h3>
      <ul className="list-reset stack-sm" style={{ fontSize: '0.92rem' }}>
        <li className="spread"><span className="muted">Headline</span><span>{profile.headline || <em>missing</em>}</span></li>
        <li className="spread"><span className="muted">Subjects</span><span>{profile.subjects.map((s) => s.name).join(', ') || <em>none</em>}</span></li>
        <li className="spread"><span className="muted">Levels</span><span>{profile.levels.map((l) => l.name).join(', ') || <em>none</em>}</span></li>
        <li className="spread"><span className="muted">Default rate</span><span>{profile.hourlyRateCents ? `${profile.currency} ${(profile.hourlyRateCents / 100).toFixed(2)}` : <em>not set</em>}</span></li>
        <li className="spread"><span className="muted">Qualifications</span><span>{profile.qualifications.length}</span></li>
      </ul>
      <div className="divider" />
      <div className="row-wrap">
        <Link className="btn" to={`/tutors/${profile.id}`}>Preview public profile</Link>
        {['DRAFT', 'CHANGES_REQUESTED'].includes(profile.status) && <Button variant="primary" loading={busy} onClick={() => doAction('/tutors/me/submit', 'Submitted for review')}>Submit for review</Button>}
        {profile.status === 'APPROVED' && <Button loading={busy} onClick={() => doAction('/tutors/me/pause', 'Profile paused')}>Pause profile</Button>}
        {profile.status === 'PAUSED' && <Button variant="primary" loading={busy} onClick={() => doAction('/tutors/me/resume', 'Profile resumed')}>Resume profile</Button>}
        {profile.status === 'PENDING' && <Badge variant="warning">Awaiting admin review</Badge>}
      </div>
    </div></Card>
  );
}
