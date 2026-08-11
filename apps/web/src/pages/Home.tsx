import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/useApi.js';
import { PAYMENT_DISCLAIMER } from '../lib/pricingCopy.js';

interface OverviewSubject { id: number; name: string; slug: string; tutorCount: number }
interface OverviewCategory { id: number; name: string; icon: string | null; subjectCount: number; tutorCount: number; subjects: OverviewSubject[] }
interface Overview { categories: OverviewCategory[]; totalSubjects: number; totalApprovedTutors: number }

const LEARNER_STEPS = [
  { title: 'Search or post what you want to learn', body: 'Browse people directly, or describe what you need and let suitable people respond.' },
  { title: 'Compare people, rates and availability', body: 'Look at experience, location, format and price side by side. Nothing is ranked by price alone.' },
  { title: 'Message someone who appears suitable', body: 'Ask questions, discuss availability, and see if it feels like a good fit before committing to anything.' },
  { title: 'Arrange the details directly', body: `Confirm timing, format and payment between yourselves. ${PAYMENT_DISCLAIMER}` },
];

const PROVIDER_STEPS = [
  { title: 'Create a profile', body: 'Introduce yourself and what you can teach, whether academic, creative or practical.' },
  { title: 'List subjects or skills you can teach', body: 'Be specific. The more useful your listing, the easier you are to find.' },
  { title: 'Set your own rates and availability', body: 'You decide what you charge and when you’re free. Nothing is set for you.' },
  { title: 'Respond to suitable requests', body: 'See what learners are asking for and reply to the ones that fit.' },
  { title: 'Communicate directly with learners', body: 'Message, discuss the details, and arrange things between yourselves.' },
];

const BENEFITS = [
  'Search directly, or post a request and let people come to you',
  'Academic, creative and practical skills, not just school subjects',
  'Online or in-person learning',
  'Compare profiles and rates before you decide',
  'Message people directly, no middleman',
  'Moderated profiles and requests, with reporting built in',
];

export function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data: overview } = useApi<Overview>('/taxonomy/overview');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div>
      <section className="hero">
        {/* Two different statements, because they are two different things.
            In-person lessons need both people in the same place, so those are
            NZ and Australia. Teaching online needs neither, so it is open to
            anyone anywhere -- and saying only "New Zealand and Australia"
            turned away tutors who could have taught from Manila or Manchester. */}
        <div className="eyebrow">In person across New Zealand and Australia · Online from anywhere</div>
        <h1>Post what you want to learn. Find the <span className="gradient-text">right</span> person.</h1>
        <p className="sub">
          Search by subject or skill, compare profiles, or post a request and hear from people who can help.
          Learn online or in person.
        </p>
        <div className="cta-row">
          <Link className="btn btn-primary btn-lg" to="/requests/new">Post what you want to learn</Link>
          <Link className="btn btn-outline btn-lg" to="/search">Browse people and skills</Link>
        </div>
        <form className="searchbar" onSubmit={submit}>
          <input placeholder="Try &ldquo;calculus&rdquo;, &ldquo;saxophone&rdquo;, &ldquo;painting&rdquo; or &ldquo;Python&rdquo;" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-gradient" type="submit">Search</button>
        </form>
      </section>

      <section className="section">
        <div className="section-title" style={{ display: 'block', textAlign: 'center' }}>
          <span className="kicker">Two ways to use SkillSplore</span>
          <h2 className="mt-0">Search directly, or let people come to you</h2>
        </div>
        <div className="grid grid-2">
          <div className="card"><div className="card-body">
            <h3 className="mt-0">Search directly</h3>
            <p className="muted">Browse people by subject, skill, location, lesson format and rate.</p>
            <Link className="btn btn-outline" to="/search">Browse people</Link>
          </div></div>
          <div className="card"><div className="card-body">
            <h3 className="mt-0">Post a request</h3>
            <p className="muted">Describe what you want to learn and let suitable people respond.</p>
            <Link className="btn btn-gradient" to="/requests/new">Post a request</Link>
          </div></div>
        </div>
      </section>

      <section className="section-tight">
        <div className="section-title" style={{ display: 'block', textAlign: 'center' }}>
          <span className="kicker">What could you learn?</span>
          <h2 className="mt-0">Academic subjects, creative skills, and everything between</h2>
        </div>
        <div className="cat-grid">
          {overview?.categories.map((c) => (
            <Link key={c.id} to={`/search?categoryId=${c.id}`} className="cat-tile">
              <div className="cat-head">
                {c.icon && <span className="cat-icon">{c.icon}</span>}
                <h3>{c.name}</h3>
              </div>
              <div className="cat-links">
                {c.subjects.slice(0, 5).map((s) => <span key={s.id} className="muted" style={{ fontSize: '0.9rem' }}>{s.name}</span>)}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-title" style={{ display: 'block', textAlign: 'center' }}>
          <span className="kicker">How it works</span>
          <h2 className="mt-0">For learners and people who teach</h2>
        </div>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div>
            <h3 style={{ marginBottom: 14 }}>For learners</h3>
            <div className="stack">
              {LEARNER_STEPS.map((s, i) => (
                <div key={s.title} className="step-card">
                  <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
                  <h4 style={{ marginBottom: 4 }}>{s.title}</h4>
                  <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ marginBottom: 14 }}>For people who teach</h3>
            <div className="stack">
              {PROVIDER_STEPS.map((s, i) => (
                <div key={s.title} className="step-card">
                  <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
                  <h4 style={{ marginBottom: 4 }}>{s.title}</h4>
                  <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="section-title" style={{ display: 'block', textAlign: 'center' }}>
          <span className="kicker">Why use SkillSplore</span>
          <h2 className="mt-0">Built around finding the right person</h2>
        </div>
        <div className="grid grid-cards">
          {BENEFITS.map((b) => (
            <div key={b} className="card"><div className="card-body">
              <p style={{ margin: 0 }}>{b}</p>
            </div></div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="card" style={{ textAlign: 'center', padding: '8px' }}><div className="card-body">
          <span className="kicker">Early launch</span>
          <h2 style={{ maxWidth: 560, margin: '0 auto 12px' }}>Join the early community</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 auto 24px' }}>
            SkillSplore is preparing for launch. We&rsquo;re looking for early learners and people with
            useful skills to help us test and improve the platform.
          </p>
          <div className="cta-row" style={{ marginBottom: 0 }}>
            <Link className="btn btn-primary btn-lg" to="/register">Join as a learner</Link>
            <Link className="btn btn-outline btn-lg" to="/tutor/onboarding">Create a teaching profile</Link>
          </div>
        </div></div>
      </section>
    </div>
  );
}
