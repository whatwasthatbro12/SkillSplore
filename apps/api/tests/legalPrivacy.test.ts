import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { app, prisma, resetDb } from './helpers.js';
import { syncLegalDocuments } from '../src/lib/legalSync.js';
import { scanPlaceholders, assertPublishable, LEGAL_PLACEHOLDERS } from '../src/lib/legalPlaceholders.js';
import { publishVersion } from '../src/lib/legalSync.js';
import { logModeratorMessageAccess, ACCESS_GROUNDS } from '../src/lib/moderatorAccess.js';
import { assertInsightsCategoriesSafe, ALWAYS_EXCLUDED_FROM_INSIGHTS } from '../src/content/legal/consents.js';
import { LEGAL_DOCUMENTS } from '../src/content/legal/index.js';
import { env } from '../src/config/env.js';

const anon = () => supertest(app);

async function registerUser(email: string, extra: Record<string, unknown> = {}) {
  const res = await anon().post('/api/auth/register').send({
    email,
    password: 'password12345',
    displayName: 'Test Person',
    acceptTerms: true,
    isAdult: true,
    ...extra,
  });
  return res;
}

describe('data monetisation is disabled', () => {
  it('reports that no personal data is sold', async () => {
    const res = await anon().get('/api/legal/data-practices');
    expect(res.status).toBe(200);
    expect(res.body.sellsPersonalData).toBe(false);
    expect(res.body.sellsChildData).toBe(false);
    expect(res.body.behaviouralAdvertising).toBe(false);
    expect(res.body.usesMessagesForAdvertising).toBe(false);
  });

  it('forces the monetisation flags off regardless of environment configuration', () => {
    // These are `false as const` in env.ts. If somebody makes them
    // configurable, this test is the thing that notices.
    expect(env.sellPersonalData).toBe(false);
    expect(env.sellChildData).toBe(false);
    expect(env.behaviouralAdvertisingEnabled).toBe(false);
    expect(env.useMessagesForAdvertising).toBe(false);
  });

  it('has the Data Insights Programme disabled by default', () => {
    expect(env.dataInsightsProgramEnabled).toBe(false);
  });
});

describe('sensitive categories are excluded from insights', () => {
  it('refuses to build a dataset containing private messages', () => {
    expect(() => assertInsightsCategoriesSafe(['broad_region', 'private_messages']))
      .toThrow(/private_messages/);
  });

  it("refuses to build a dataset containing children's information", () => {
    expect(() => assertInsightsCategoriesSafe(['children_information'])).toThrow(/children_information/);
  });

  it('allows a genuinely aggregate category set', () => {
    expect(() => assertInsightsCategoriesSafe(['broad_region', 'season_of_activity'])).not.toThrow();
  });

  it('excludes every sensitive category named in the policy', () => {
    for (const category of ALWAYS_EXCLUDED_FROM_INSIGHTS) {
      expect(() => assertInsightsCategoriesSafe([category])).toThrow();
    }
  });
});

describe('legal document placeholders', () => {
  it('detects unresolved placeholders', () => {
    const scan = scanPlaceholders('Operated by [[LEGAL_ENTITY_NAME]] at [[REGISTERED_ADDRESS]].');
    expect(scan.unresolved).toEqual(['LEGAL_ENTITY_NAME', 'REGISTERED_ADDRESS']);
    expect(scan.occurrences).toBe(2);
    expect(scan.unknown).toEqual([]);
  });

  it('flags a misspelled placeholder as unknown but still unresolved', () => {
    const scan = scanPlaceholders('Write to [[PRIVACY_EMIAL]].');
    expect(scan.unresolved).toEqual(['PRIVACY_EMIAL']);
    expect(scan.unknown).toEqual(['PRIVACY_EMIAL']);
  });

  it('refuses to publish a document with placeholders remaining', () => {
    expect(() => assertPublishable('Governed by [[GOVERNING_JURISDICTION]].')).toThrow(/cannot be marked production ready/);
  });

  it('allows a fully filled-in document', () => {
    expect(() => assertPublishable('Governed by the laws of New Zealand.')).not.toThrow();
  });

  it('ships no document with an unfilled placeholder', () => {
    // This assertion is the inverse of what it used to be. The drafts
    // deliberately shipped incomplete, as a tripwire forcing someone to fill
    // the blanks before launch. That job is done: the site is live, and
    // "Effective date: [[EFFECTIVE_DATE]]" was being served to readers and
    // indexed by search engines. Publishing is now gated at publishVersion
    // instead, which is the check that actually protects a reader.
    for (const doc of LEGAL_DOCUMENTS) {
      const scan = scanPlaceholders(doc.body);
      expect(scan.unresolved, `${doc.slug} still has an unfilled placeholder`).toEqual([]);
      // Every placeholder token used must be a known one -- catches typos.
      expect(scan.unknown, `${doc.slug} has unknown placeholder tokens`).toEqual([]);
    }
  });

  it('documents every placeholder it defines', () => {
    for (const p of LEGAL_PLACEHOLDERS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.note.length).toBeGreaterThan(0);
    }
  });
});

describe('legal document sync and versioning', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('seeds all documents unpublished', async () => {
    await syncLegalDocuments(prisma);
    const docs = await prisma.legalDocument.findMany({ include: { versions: true } });
    expect(docs).toHaveLength(LEGAL_DOCUMENTS.length);
    for (const doc of docs) {
      expect(doc.currentVersionId, `${doc.slug} must not auto-publish`).toBeNull();
      expect(doc.versions).toHaveLength(1);
      expect(doc.versions[0]!.legalReviewedAt).toBeNull();
    }
  });

  it('is idempotent', async () => {
    await syncLegalDocuments(prisma);
    const second = await syncLegalDocuments(prisma);
    expect(second.documentsCreated).toBe(0);
    expect(second.versionsCreated).toBe(0);
    expect(second.consentVersionsCreated).toBe(0);
  });

  it('refuses to publish a version that still has placeholders', async () => {
    await syncLegalDocuments(prisma);
    const version = await prisma.legalDocumentVersion.findFirstOrThrow();
    // Placeholder injected here rather than relying on the shipped drafts
    // containing one. The shipped documents are now complete, and this test is
    // about the gate, not about the state of the current policy text -- it
    // should keep protecting readers no matter what the drafts happen to say.
    await prisma.legalDocumentVersion.update({
      where: { id: version.id },
      data: { body: 'Effective date: [[EFFECTIVE_DATE]]' },
    });
    await expect(publishVersion(prisma, version.id)).rejects.toThrow(/cannot be marked production ready/);
  });

  it('publishes a version once the placeholders are filled in', async () => {
    await syncLegalDocuments(prisma);
    const version = await prisma.legalDocumentVersion.findFirstOrThrow();
    await prisma.legalDocumentVersion.update({
      where: { id: version.id },
      data: { body: 'A complete policy with no placeholders.' },
    });

    await publishVersion(prisma, version.id);

    const doc = await prisma.legalDocument.findUniqueOrThrow({ where: { id: version.documentId } });
    expect(doc.currentVersionId).toBe(version.id);
  });

  it('preserves an existing version when the source body changes', async () => {
    await syncLegalDocuments(prisma);
    const before = await prisma.legalDocumentVersion.findMany();

    // Simulate a reworded policy by mutating the stored body, then re-syncing:
    // the sync should add a new version rather than overwrite the old one.
    const target = before[0]!;
    await prisma.legalDocumentVersion.update({
      where: { id: target.id },
      data: { body: 'An older wording that must survive.' },
    });

    await syncLegalDocuments(prisma);

    const survivor = await prisma.legalDocumentVersion.findUnique({ where: { id: target.id } });
    expect(survivor?.body).toBe('An older wording that must survive.');
    const after = await prisma.legalDocumentVersion.count({ where: { documentId: target.documentId } });
    expect(after).toBe(2);
  });
});

describe('registration, age gate and consent', () => {
  beforeEach(async () => {
    await resetDb();
    await syncLegalDocuments(prisma);
  });

  it('lets an under-18 register and marks the account as a minor', async () => {
    // The age gate was removed deliberately: a young person can hold a full
    // account. What changes is what they can arrange -- see the request tests
    // below.
    const res = await anon().post('/api/auth/register').send({
      email: 'young@test.local',
      password: 'password12345',
      displayName: 'Younger Person',
      acceptTerms: true,
      isAdult: false,
    });
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'young@test.local' } });
    expect(user.isMinor).toBe(true);
  });

  it('marks an adult account as not a minor', async () => {
    await registerUser('grownup@test.local');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'grownup@test.local' } });
    expect(user.isMinor).toBe(false);
  });

  it('still requires the age question to be answered', async () => {
    // Omitting it entirely is a malformed request, not an implicit "no".
    const res = await anon().post('/api/auth/register').send({
      email: 'missing@test.local',
      password: 'password12345',
      displayName: 'No Answer',
      acceptTerms: true,
    });
    expect(res.status).toBe(400);
  });

  it('records which document versions were accepted at registration', async () => {
    const res = await registerUser('accepts@test.local');
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'accepts@test.local' } });
    const acceptances = await prisma.userLegalAcceptance.findMany({
      where: { userId: user.id },
      include: { version: { include: { document: true } } },
    });

    const slugs = acceptances.map((a) => a.version.document.slug).sort();
    expect(slugs).toEqual(['PRIVACY', 'TERMS']);
    for (const a of acceptances) expect(a.method).toBe('registration');
  });

  it('does not create a marketing consent unless the user opted in', async () => {
    await registerUser('nomarketing@test.local');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'nomarketing@test.local' } });
    const consents = await prisma.userConsent.findMany({ where: { userId: user.id } });
    expect(consents).toHaveLength(0);
  });

  it('records a marketing consent only when explicitly opted in', async () => {
    await registerUser('marketing@test.local', { marketingOptIn: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'marketing@test.local' } });
    const consents = await prisma.userConsent.findMany({ where: { userId: user.id } });

    expect(consents).toHaveLength(1);
    expect(consents[0]!.kind).toBe('MARKETING_EMAIL');
    // The exact wording is copied onto the consent, not merely referenced.
    expect(consents[0]!.grantedWording).toContain('optional');
    expect(consents[0]!.withdrawnAt).toBeNull();
  });
});

describe('consent API', () => {
  let agent: ReturnType<typeof supertest.agent>;

  beforeEach(async () => {
    await resetDb();
    await syncLegalDocuments(prisma);
    agent = supertest.agent(app);
    await agent.post('/api/auth/register').send({
      email: 'consent@test.local',
      password: 'password12345',
      displayName: 'Consent Tester',
      acceptTerms: true,
      isAdult: true,
    });
  });

  it('returns every consent ungranted by default', async () => {
    const res = await agent.get('/api/consents');
    expect(res.status).toBe(200);
    for (const c of res.body.consents) {
      expect(c.granted, `${c.kind} must not be granted by default`).toBe(false);
    }
  });

  it('never exposes a pre-ticked default in the payload', async () => {
    const res = await agent.get('/api/consents');
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain('defaultChecked');
    expect(serialised).not.toContain('preselected');
  });

  it('shows the Data Insights Programme as unavailable while disabled', async () => {
    const res = await agent.get('/api/consents');
    const insights = res.body.consents.find((c: { kind: string }) => c.kind === 'DATA_INSIGHTS');
    expect(insights.available).toBe(false);
  });

  it('refuses to grant Data Insights consent while the programme is disabled', async () => {
    const list = await agent.get('/api/consents');
    const insights = list.body.consents.find((c: { kind: string }) => c.kind === 'DATA_INSIGHTS');

    const res = await agent.post('/api/consents').send({
      kind: 'DATA_INSIGHTS',
      versionId: insights.versionId,
      confirmed: true,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a consent grant that does not explicitly confirm', async () => {
    const list = await agent.get('/api/consents');
    const marketing = list.body.consents.find((c: { kind: string }) => c.kind === 'MARKETING_EMAIL');

    const res = await agent.post('/api/consents').send({
      kind: 'MARKETING_EMAIL',
      versionId: marketing.versionId,
      confirmed: false,
    });
    expect(res.status).toBe(400);
  });

  it('grants and withdraws marketing consent, keeping both records', async () => {
    const list = await agent.get('/api/consents');
    const marketing = list.body.consents.find((c: { kind: string }) => c.kind === 'MARKETING_EMAIL');

    const grant = await agent.post('/api/consents').send({
      kind: 'MARKETING_EMAIL',
      versionId: marketing.versionId,
      confirmed: true,
    });
    expect(grant.status).toBe(201);

    const withdraw = await agent.post('/api/consents/withdraw').send({ kind: 'MARKETING_EMAIL' });
    expect(withdraw.status).toBe(200);

    // The grant is not deleted -- it is timestamped as withdrawn, and a
    // separate withdrawal record exists. Both are needed to show what was
    // agreed and when it stopped.
    const consents = await prisma.userConsent.findMany({ include: { withdrawals: true } });
    expect(consents).toHaveLength(1);
    expect(consents[0]!.withdrawnAt).not.toBeNull();
    expect(consents[0]!.grantedWording.length).toBeGreaterThan(0);
    expect(consents[0]!.withdrawals).toHaveLength(1);
  });

  it('reports honestly that withdrawal does not reverse a prior disclosure', async () => {
    const list = await agent.get('/api/consents');
    const marketing = list.body.consents.find((c: { kind: string }) => c.kind === 'MARKETING_EMAIL');
    await agent.post('/api/consents').send({ kind: 'MARKETING_EMAIL', versionId: marketing.versionId, confirmed: true });

    const withdraw = await agent.post('/api/consents/withdraw').send({ kind: 'MARKETING_EMAIL' });
    expect(withdraw.body.priorDisclosuresReversible).toBe(false);
  });

  it('requires authentication', async () => {
    const res = await anon().get('/api/consents');
    expect(res.status).toBe(401);
  });
});

describe('privacy requests', () => {
  beforeEach(async () => {
    await resetDb();
    await syncLegalDocuments(prisma);
  });

  it('accepts a request from someone who is not signed in', async () => {
    const res = await anon().post('/api/privacy-requests').send({
      type: 'ACCESS',
      contactEmail: 'former.user@test.local',
      details: 'Please send me a copy of everything you hold about me.',
    });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('RECEIVED');
  });

  it('records an opening event for every request', async () => {
    await anon().post('/api/privacy-requests').send({
      type: 'DELETION',
      contactEmail: 'delete.me@test.local',
      details: 'Please delete my account and personal information.',
    });

    const request = await prisma.privacyRequest.findFirstOrThrow({ include: { events: true } });
    expect(request.events).toHaveLength(1);
    expect(request.events[0]!.action).toBe('RECEIVED');
  });

  it('rejects a request with no detail', async () => {
    const res = await anon().post('/api/privacy-requests').send({
      type: 'ACCESS',
      contactEmail: 'vague@test.local',
      details: 'hi',
    });
    expect(res.status).toBe(400);
  });

  it('does not let an ordinary user list everyone’s requests', async () => {
    const agent = supertest.agent(app);
    await agent.post('/api/auth/register').send({
      email: 'nosy@test.local',
      password: 'password12345',
      displayName: 'Nosy',
      acceptTerms: true,
      isAdult: true,
    });

    const res = await agent.get('/api/privacy-requests');
    expect(res.status).toBe(403);
  });
});

describe('moderator access to private messages', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('records the moderator, the ground and the written reason', async () => {
    const id = await logModeratorMessageAccess(prisma, {
      moderatorId: 1,
      ground: 'report',
      reason: 'Investigating report #42 about harassment in this conversation.',
      conversationId: 7,
    });

    const row = await prisma.moderatorAccessLog.findUniqueOrThrow({ where: { id } });
    expect(row.moderatorId).toBe(1);
    expect(row.ground).toBe('report');
    expect(row.conversationId).toBe(7);
    expect(row.reason).toContain('report #42');
  });

  it('refuses an unrecognised ground', async () => {
    await expect(
      logModeratorMessageAccess(prisma, {
        moderatorId: 1,
        ground: 'curiosity',
        reason: 'I just wanted to have a look at this conversation.',
      }),
    ).rejects.toThrow(/not a permitted ground/);
  });

  it('refuses an empty or token reason', async () => {
    await expect(
      logModeratorMessageAccess(prisma, { moderatorId: 1, ground: 'support', reason: 'because' }),
    ).rejects.toThrow(/written reason/);

    expect(await prisma.moderatorAccessLog.count()).toBe(0);
  });

  it('only permits the grounds published in the privacy policy', () => {
    expect([...ACCESS_GROUNDS].sort()).toEqual(
      ['fraud', 'legal', 'report', 'rules', 'security', 'serious-harm', 'support'],
    );
  });
});

describe('public policy documents', () => {
  beforeAll(async () => {
    await syncLegalDocuments(prisma);
  });

  it('serves every policy document', async () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const path = doc.path.replace(/^\//, '');
      const res = await anon().get(`/api/legal/documents/${path}`);
      expect(res.status, `${doc.slug} should be served at ${doc.path}`).toBe(200);
      expect(res.body.body.length).toBeGreaterThan(100);
    }
  });

  it('marks an unpublished document as a draft', async () => {
    const res = await anon().get('/api/legal/documents/privacy');
    // Unpublished and unreviewed still show the draft banner. The placeholder
    // count is no longer part of it: the text is complete, and what makes it a
    // draft now is that nobody has brought it into force.
    expect(res.body.isPublished).toBe(false);
    expect(res.body.isLegallyReviewed).toBe(false);
    expect(res.body.unresolvedPlaceholders).toEqual([]);
  });

  it('rejects an unknown document path', async () => {
    const res = await anon().get('/api/legal/documents/not-a-policy');
    expect(res.status).toBe(404);
  });

  it('states the no-sale position in the privacy policy body', async () => {
    const res = await anon().get('/api/legal/documents/privacy');
    expect(res.body.body).toContain('does not sell personal information');
  });
});

describe('migrations are non-destructive', () => {
  // `prisma migrate diff` repeatedly proposes dropping things that exist in the
  // database but cannot be expressed in schema.prisma -- the pg_trgm GIN
  // indexes, and the `user_sessions` table that connect-pg-simple creates at
  // runtime. Two of those drops were caught by review; one reached a committed
  // migration and would have signed out every logged-in user on deploy.
  //
  // This test is the thing that catches the next one.
  it('contains no DROP, DELETE or TRUNCATE in any migration', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const root = join(process.cwd(), 'prisma', 'migrations');
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    expect(dirs.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const dir of dirs) {
      const sql = await readFile(join(root, dir, 'migration.sql'), 'utf8');
      for (const line of sql.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('--')) continue; // commented-out drops are fine
        if (/^(DROP|DELETE\s+FROM|TRUNCATE)\b/i.test(trimmed)) {
          offenders.push(`${dir}: ${trimmed}`);
        }
      }
    }

    expect(offenders, `Destructive statements found:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('under-18 accounts are limited to online lessons', () => {
  let minor: ReturnType<typeof supertest.agent>;
  let adult: ReturnType<typeof supertest.agent>;
  let subjectId: number;

  beforeEach(async () => {
    await resetDb();
    await syncLegalDocuments(prisma);

    const category = await prisma.category.create({
      data: { name: 'Test Category', normalizedName: 'test category', slug: 'test-category' },
    });
    const subject = await prisma.subject.create({
      data: { name: 'Test Subject', normalizedName: 'test subject', slug: 'test-subject', categoryId: category.id },
    });
    subjectId = subject.id;

    minor = supertest.agent(app);
    await minor.post('/api/auth/register').send({
      email: 'minor.poster@test.local',
      password: 'password12345',
      displayName: 'Minor Poster',
      acceptTerms: true,
      isAdult: false,
    });

    adult = supertest.agent(app);
    await adult.post('/api/auth/register').send({
      email: 'adult.poster@test.local',
      password: 'password12345',
      displayName: 'Adult Poster',
      acceptTerms: true,
      isAdult: true,
    });
  });

  const body = (deliveryMode: string) => ({
    subjectId,
    title: 'Help me with this',
    description: 'I would like some help learning this subject, please.',
    deliveryMode,
  });

  it('lets a minor post an online request', async () => {
    const res = await minor.post('/api/requests').send(body('ONLINE'));
    expect(res.status).toBe(201);
  });

  it('refuses an in-person request from a minor', async () => {
    const res = await minor.post('/api/requests').send(body('IN_PERSON'));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/online lessons only/i);
  });

  it('refuses a "both" request from a minor, since that includes in person', async () => {
    const res = await minor.post('/api/requests').send(body('BOTH'));
    expect(res.status).toBe(400);
  });

  it('lets an adult post an in-person request', async () => {
    const res = await adult.post('/api/requests').send(body('IN_PERSON'));
    expect(res.status).toBe(201);
  });
});
