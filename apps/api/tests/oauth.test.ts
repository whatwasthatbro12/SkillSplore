/**
 * Google sign-in: identity, linking, and the takeover gate.
 *
 * The linking rule is the part worth testing hardest. If an existing
 * password account can be claimed by anyone who gets a provider to assert its
 * email address, the sign-in button becomes an account-takeover route -- and
 * the failure is silent, because from the outside it looks like a successful
 * login.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma, resetDb } from './helpers.js';
import { signInWithGoogle } from '../src/modules/auth/oauth.service.js';
import { syncLegalDocuments } from '../src/lib/legalSync.js';

const meta = { ipAddress: '127.0.0.1', userAgent: 'test' };
const claims = (over: Partial<Record<string, unknown>> = {}) => ({
  sub: 'google-subject-1',
  email: 'someone@gmail.com',
  email_verified: true,
  name: 'Some One',
  ...over,
} as Parameters<typeof signInWithGoogle>[0]);

describe('sign in with Google', () => {
  beforeEach(async () => {
    await resetDb();
    // The acceptance recorder is best-effort and writes nothing when no
    // document versions exist, so the policies have to be present for the
    // evidence assertion below to mean anything.
    await syncLegalDocuments(prisma);
  });

  it('creates an account on first sign-in', async () => {
    const { user, isNew } = await signInWithGoogle(claims(), meta);
    expect(isNew).toBe(true);
    expect(user.email).toBe('someone@gmail.com');
    expect(user.displayName).toBe('Some One');
    // Google verified the address, so our own verification email would be
    // asking a question that has already been answered.
    expect(user.emailVerifiedAt).not.toBeNull();
    // No password exists to be guessed, reset or stolen.
    expect(user.passwordHash).toBeNull();
  });

  it('returns the same account on a second sign-in', async () => {
    const first = await signInWithGoogle(claims(), meta);
    const second = await signInWithGoogle(claims(), meta);
    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('follows the provider id, not the email address', async () => {
    // Someone changes the address on their Google account. Same person, same
    // subject id -- they must land in the same SkillSplore account, not a new
    // one, and certainly not somebody else's.
    const first = await signInWithGoogle(claims(), meta);
    const second = await signInWithGoogle(claims({ email: 'moved@gmail.com' }), meta);
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
  });

  it('links to an existing password account when Google verified the address', async () => {
    const existing = await prisma.user.create({
      data: { email: 'someone@gmail.com', passwordHash: 'hashed', displayName: 'Existing' },
    });
    const { user, isNew } = await signInWithGoogle(claims(), meta);
    expect(isNew).toBe(false);
    expect(user.id).toBe(existing.id);
    // The password still works; the Google identity is an addition, not a
    // replacement.
    expect(user.passwordHash).toBe('hashed');
    expect(await prisma.oAuthAccount.count({ where: { userId: existing.id } })).toBe(1);
  });

  it('REFUSES to link when Google has not verified the address', async () => {
    // The takeover case. An unverified address proves nothing about who
    // controls the mailbox, so it must never attach to an account someone
    // else created.
    await prisma.user.create({
      data: { email: 'someone@gmail.com', passwordHash: 'hashed', displayName: 'Victim' },
    });
    await expect(signInWithGoogle(claims({ email_verified: false }), meta)).rejects.toThrow(
      /has not verified that address/i,
    );
    expect(await prisma.oAuthAccount.count()).toBe(0);
  });

  it('refuses a suspended account', async () => {
    await prisma.user.create({
      data: {
        email: 'someone@gmail.com',
        passwordHash: 'hashed',
        displayName: 'Suspended',
        status: 'SUSPENDED',
      },
    });
    await expect(signInWithGoogle(claims(), meta)).rejects.toThrow(/suspended/i);
  });

  it('records which legal versions a Google signup accepted', async () => {
    // Same evidence trail as a password signup. Without it, a Google account
    // would have agreed to "the Terms" with no record of which wording.
    const { user } = await signInWithGoogle(claims(), meta);
    const acceptances = await prisma.userLegalAcceptance.count({ where: { userId: user.id } });
    expect(acceptances).toBeGreaterThan(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).termsAcceptedAt)
      .not.toBeNull();
  });

  it('does not mark the address verified when Google has not', async () => {
    const { user } = await signInWithGoogle(claims({ email_verified: false }), meta);
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('falls back to the address when Google sends no name', async () => {
    const { user } = await signInWithGoogle(claims({ name: undefined }), meta);
    expect(user.displayName).toBe('someone');
  });
});
