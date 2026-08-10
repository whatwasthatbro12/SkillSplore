import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useApi } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.js';
import { useToast } from '../lib/toast.js';
import type { Money, PublicUser, Verification } from '../lib/types.js';
import { Avatar, Badge, Button, Card, EmptyState, Field, Modal, Spinner, Stars, Textarea } from '../components/ui.js';
import { deliveryLabel, money, slotLabel, dateStr } from '../lib/format.js';
import { PAYMENT_DISCLAIMER } from '../lib/pricingCopy.js';
import { DUE_DILIGENCE_NOTICE, QUALIFICATIONS_UNCHECKED } from '../lib/trustCopy.js';
import { VerifyEmailNotice } from '../components/VerifyEmailNotice.js';
import { ReportButton } from '../components/ReportButton.js';

interface Review { id: number; rating: number; title: string | null; body: string; createdAt: string; student: PublicUser; tutorResponse: string | null; tutorRespondedAt: string | null; categoryRatings: Record<string, number> | null }
interface Profile {
  id: number; userId: number; displayName: string; avatarUrl: string | null; headline: string | null;
  experience: string | null; teachingStyle: string | null; deliveryMode: string; country: string | null; city: string | null;
  locationNote: string | null; travelRadiusKm: number | null; availabilityNote: string | null; yearsExperience: number | null;
  hourlyRate: Money | null; averageRating: number; ratingCount: number;
  subjects: Array<{ subjectId: number; name: string; category: string | null; price: Money | null }>;
  levels: Array<{ id: number; name: string }>;
  availability: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  qualifications: Array<{ id: number; title: string; institution: string | null; year: number | null; verified: boolean }>;
  verifications: Verification[];
  trustIndicators: { verifiedQualifications: number; completedEngagements: number; reviewCount: number; memberSince: string };
  reviews: Review[];
  isSaved: boolean;
}

export function TutorProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, setData } = useApi<{ profile: Profile }>(`/tutors/${id}`);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;
  if (error || !data) return <EmptyState emoji="🚫" title="Profile not found">This profile may not be public.</EmptyState>;
  const p = data.profile;

  const requireLogin = () => { navigate('/login', { state: { from: `/tutors/${id}` } }); };

  const toggleSave = async () => {
    if (!user) return requireLogin();
    try {
      if (p.isSaved) { await api.del(`/tutors/${p.id}/save`); toast('Removed from saved'); }
      else { await api.post(`/tutors/${p.id}/save`); toast('Saved', 'success'); }
      setData({ profile: { ...p, isSaved: !p.isSaved } });
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed', 'error'); }
  };

  const sendContact = async () => {
    if (!user) return requireLogin();
    setBusy(true);
    try {
      const { conversationId } = await api.post<{ conversationId: number }>('/conversations/contact', { tutorProfileId: p.id, message });
      toast('Message sent', 'success');
      navigate(`/messages/${conversationId}`);
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed to send', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }} className="profile-layout">
      <div className="stack">
        <Card><div className="card-body">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Avatar name={p.displayName} url={p.avatarUrl} size={72} />
            <div className="grow">
              <div className="row-wrap">
                <h1 className="mt-0" style={{ marginBottom: 4 }}>{p.displayName}</h1>
              </div>
              <p className="muted" style={{ margin: 0 }}>{p.headline}</p>
              <div className="row-wrap" style={{ marginTop: 8 }}>
                {p.ratingCount > 0 ? <Stars rating={p.averageRating} count={p.ratingCount} /> : <span className="muted">No reviews yet</span>}
                <span className="muted">· {[p.city, p.country].filter(Boolean).join(', ')} · {deliveryLabel(p.deliveryMode)}</span>
              </div>
              {p.verifications.length > 0 && (
                <div className="row-wrap" style={{ marginTop: 10 }}>
                  {p.verifications.map((v, i) => (
                    <Badge key={i} variant="accent" title={`Checked ${dateStr(v.checkedAt)}${v.expiresAt ? ` · expires ${dateStr(v.expiresAt)}` : ''}`}>
                      ✓ {v.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div></Card>

        {p.experience && <Card><div className="card-body"><h3 className="mt-0">Experience</h3><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.experience}</p></div></Card>}
        {p.teachingStyle && <Card><div className="card-body"><h3 className="mt-0">Teaching style</h3><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.teachingStyle}</p></div></Card>}

        <Card><div className="card-body">
          <h3 className="mt-0">Subjects & rates</h3>
          <table className="table"><tbody>
            {p.subjects.map((s) => (
              <tr key={s.subjectId}><td>{s.name} {s.category && <span className="muted">· {s.category}</span>}</td><td style={{ textAlign: 'right' }}><strong>{money(s.price)}</strong>/hr</td></tr>
            ))}
          </tbody></table>
          {p.levels.length > 0 && <div className="row-wrap" style={{ marginTop: 12 }}><span className="muted">Levels:</span>{p.levels.map((l) => <Badge key={l.id}>{l.name}</Badge>)}</div>}
        </div></Card>

        {(p.availability.length > 0 || p.availabilityNote) && (
          <Card><div className="card-body">
            <h3 className="mt-0">Availability</h3>
            {p.availabilityNote && <p className="muted">{p.availabilityNote}</p>}
            <div className="row-wrap">{p.availability.map((a, i) => <Badge key={i}>{slotLabel(a.dayOfWeek, a.startMinute, a.endMinute)}</Badge>)}</div>
          </div></Card>
        )}

        {p.qualifications.length > 0 && (
          <Card><div className="card-body">
            {/* Headed "stated by" rather than "Qualifications" on purpose. The
                heading is the claim: a bare "Qualifications" heading on a
                platform reads as though the platform stands behind the list,
                and SkillSplore does not check any of it. */}
            <h3 className="mt-0">Qualifications stated by {p.displayName}</h3>
            <p className="hint" style={{ marginTop: 0 }}>{QUALIFICATIONS_UNCHECKED}</p>
            <ul className="list-reset stack-sm">
              {p.qualifications.map((q) => (
                <li key={q.id} className="row-wrap">
                  <strong>{q.title}</strong>
                  <span className="muted">{[q.institution, q.year].filter(Boolean).join(', ')}</span>
                  {/* Only ever appears if someone actually checked the
                      document. Absence means "not checked", never "failed". */}
                  {q.verified && <Badge variant="success">Document checked</Badge>}
                </li>
              ))}
            </ul>
          </div></Card>
        )}

        <Card><div className="card-body">
          <h3 className="mt-0">Reviews ({p.ratingCount})</h3>
          {p.reviews.length === 0 ? <p className="muted">No reviews yet.</p> : (
            <ul className="list-reset stack">
              {p.reviews.map((r) => (
                <li key={r.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                  <div className="row-wrap"><Stars rating={r.rating} /><strong>{r.title}</strong></div>
                  <div className="muted" style={{ fontSize: '0.82rem' }}>{r.student.displayName} · {dateStr(r.createdAt)}</div>
                  <p style={{ margin: '6px 0 0' }}>{r.body}</p>
                  {r.tutorResponse && <div className="alert alert-info" style={{ marginTop: 8 }}><strong>Response from {p.displayName}:</strong> {r.tutorResponse}</div>}
                  <div style={{ marginTop: 6 }}>
                    <ReportButton entityType="REVIEW" entityId={r.id} label="Report review" what="this review" className="btn-sm btn-ghost" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div></Card>
      </div>

      <aside className="stack" style={{ position: 'sticky', top: 76 }}>
        <Card><div className="card-body stack">
          <div className="center">
            <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{money(p.hourlyRate)}<span className="muted" style={{ fontSize: '1rem', fontWeight: 400 }}>/hr</span></div>
            <span className="muted" style={{ fontSize: '0.82rem' }}>from</span>
          </div>
          <Button variant="primary" className="btn-block" onClick={() => (user ? setContactOpen(true) : requireLogin())}>Contact</Button>
          <Button className="btn-block" onClick={toggleSave}>{p.isSaved ? '★ Saved' : '☆ Save profile'}</Button>
          <div className="alert alert-info" style={{ fontSize: '0.8rem', margin: 0 }}>Learning is arranged and paid directly between you and this person. {PAYMENT_DISCLAIMER}</div>
          {/* Sits directly under Contact, where the decision is actually made.
              The same words in the Terms would be true and useless -- nobody
              reads them at the moment they matter. */}
          <div className="alert alert-warning" style={{ fontSize: '0.8rem', margin: 0 }}>{DUE_DILIGENCE_NOTICE}</div>
        </div></Card>

        <Card><div className="card-body">
          {/* "About this account", not "Trust". These are counts of things
              that happened on the platform -- facts we can actually stand
              behind -- not a judgement about whether this person is
              trustworthy, which we are in no position to make. */}
          <h3 className="mt-0">About this account</h3>
          <ul className="list-reset stack-sm" style={{ fontSize: '0.9rem' }}>
            {/* "Verified qualifications" used to sit here as a count. Since
                nobody verifies documents, it read 0 on every profile -- which
                looks like a finding against the tutor rather than what it
                actually was: a statement about what SkillSplore does not do.
                Removed rather than left showing a permanent zero. */}
            <li className="spread"><span className="muted">Completed engagements</span><strong>{p.trustIndicators.completedEngagements}</strong></li>
            <li className="spread"><span className="muted">Reviews</span><strong>{p.trustIndicators.reviewCount}</strong></li>
            <li className="spread"><span className="muted">Member since</span><strong>{dateStr(p.trustIndicators.memberSince)}</strong></li>
          </ul>
          <div style={{ marginTop: 12 }}>
            <ReportButton entityType="TUTOR_PROFILE" entityId={p.id} label="Report profile" what="this profile" className="btn-sm btn-block" />
          </div>
        </div></Card>
      </aside>

      {contactOpen && (
        <Modal title={`Message ${p.displayName}`} onClose={() => setContactOpen(false)}>
          <VerifyEmailNotice action="message people" />
          <Field label="Your message">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Introduce yourself and what you need help with…"
              disabled={!user?.emailVerified}
            />
          </Field>
          <Button variant="primary" className="btn-block" loading={busy} disabled={!user?.emailVerified || message.trim().length < 1} onClick={sendContact}>Send message</Button>
        </Modal>
      )}
    </div>
  );
}
