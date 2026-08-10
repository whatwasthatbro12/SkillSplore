import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword, assertPasswordStrength } from '../../lib/password.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { sendMail, verificationEmail, mailLooksUnconfigured } from '../../lib/mailer.js';
import { writeAudit } from '../../lib/audit.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import type { User } from '@prisma/client';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function link(pathname: string, token: string): string {
  const url = new URL(pathname, env.WEB_ORIGIN);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Records acceptance of the newest version of each document that requires it.
 *
 * Best-effort by design: a registration must not fail because the legal sync
 * has not run yet on a fresh database. The account is still created and
 * `termsAcceptedAt` is still set -- what is lost is the finer-grained record
 * of which version, which is recoverable by re-prompting, unlike a failed
 * signup.
 */
export async function recordRegistrationAcceptances(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  try {
    const documents = await prisma.legalDocument.findMany({
      where: { slug: { in: ['TERMS', 'PRIVACY'] } },
      include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    for (const doc of documents) {
      const version = doc.currentVersionId
        ? { id: doc.currentVersionId }
        : doc.versions[0];
      if (!version) continue;

      await prisma.userLegalAcceptance.upsert({
        where: { userId_versionId: { userId, versionId: version.id } },
        create: { userId, versionId: version.id, method: 'registration', ipAddress, userAgent },
        update: {},
      });
    }
  } catch (err) {
    console.error('[auth] could not record legal acceptance for user', userId, err);
  }
}

/** Same best-effort reasoning as above. */
async function recordMarketingConsent(
  userId: number,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  try {
    const version = await prisma.consentVersion.findFirst({
      where: { kind: 'MARKETING_EMAIL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!version) return;

    await prisma.userConsent.create({
      data: {
        userId,
        kind: 'MARKETING_EMAIL',
        versionId: version.id,
        grantedWording: version.wording,
        method: 'registration-checkbox',
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    console.error('[auth] could not record marketing consent for user', userId, err);
  }
}

export async function register(input: {
  email: string;
  password: string;
  displayName: string;
  isAdult: boolean;
  marketingOptIn?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ user: User; emailDelivered: boolean }> {
  assertPasswordStrength(input.password);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('An account with that email already exists.');

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      roles: ['STUDENT'],
      isMinor: !input.isAdult,
      termsAcceptedAt: new Date(),
    },
  });

  // Record exactly which version of the Terms and Privacy Policy this person
  // agreed to. `termsAcceptedAt` above only records that they agreed to
  // something at some point, which is not much use if the wording is later
  // disputed.
  await recordRegistrationAcceptances(user.id, input.ipAddress ?? null, input.userAgent ?? null);

  // Marketing is a separate, optional consent. Nothing is written unless the
  // user actively opted in, so an omitted field can never become a consent.
  if (input.marketingOptIn) {
    await recordMarketingConsent(user.id, input.ipAddress ?? null, input.userAgent ?? null);
  }

  const { token, tokenHash } = generateToken();
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      type: 'VERIFY_EMAIL',
      tokenHash,
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  // Reported back to the caller so the interface can tell the truth rather
  // than saying "check your inbox" for a message that was never sent.
  const sent = await sendMail({
    to: user.email,
    subject: 'Confirm your SkillSplore email',
    text: verificationEmail(user.displayName, link('/verify-email', token)),
  });
  await writeAudit({ actorId: user.id, action: 'user.register', entityType: 'User', entityId: user.id });
  return { user, emailDelivered: sent.delivered };
}

// Verification tokens expire after 24 hours, and messaging is gated behind a
// confirmed address. Without a resend, anyone who loses or outlasts that first
// email is permanently unable to message anybody, with no way back.
export async function resendVerification(userId: number): Promise<{ emailDelivered: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw badRequest('Account not found.');
  if (user.emailVerifiedAt) throw badRequest('Your email address is already confirmed.');

  // Retire any outstanding tokens so an old link in an older email can't be
  // used after this point.
  await prisma.emailToken.updateMany({
    where: { userId: user.id, type: 'VERIFY_EMAIL', usedAt: null },
    data: { usedAt: new Date() },
  });

  const { token, tokenHash } = generateToken();
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      type: 'VERIFY_EMAIL',
      tokenHash,
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  const sent = await sendMail({
    to: user.email,
    subject: 'Confirm your SkillSplore email',
    text: verificationEmail(user.displayName, link('/verify-email', token)),
  });
  await writeAudit({ actorId: user.id, action: 'user.verification_resent', entityType: 'User', entityId: user.id });
  return { emailDelivered: sent.delivered };
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.type !== 'VERIFY_EMAIL' || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('This confirmation link is invalid or has expired.');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await writeAudit({ actorId: record.userId, action: 'user.email_verified', entityType: 'User', entityId: record.userId });
}

export async function authenticate(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  // Uniform failure to avoid revealing which accounts exist -- this same
  // response also covers an account that's temporarily locked out (below):
  // a distinguishable "account locked" message would itself leak that the
  // account exists, so it deliberately looks identical to a wrong password.
  const invalid = unauthorized('Incorrect email or password.');
  if (!user || user.deletedAt) throw invalid;

  // Per-account lockout: reject without even checking the password while
  // locked, and without extending the lock further on repeated attempts.
  if (user.lockedUntil && user.lockedUntil > new Date()) throw invalid;

  // An account created through Google has no password here. Reusing the
  // generic "Incorrect email or password" would send that person round in
  // circles resetting a password they never had -- and there is no secret to
  // protect, since the sign-in button is on the page already.
  if (user.passwordHash === null) {
    throw unauthorized('That account signs in with Google. Use the Google button instead.');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= env.LOGIN_LOCKOUT_THRESHOLD ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60 * 1000) : null;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil } });
    throw invalid;
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  if (user.status === 'SUSPENDED') {
    throw unauthorized('This account is suspended. Contact support.');
  }
  return user;
}

/**
 * Reports whether mail is configured at all -- deliberately NOT whether this
 * particular message was delivered.
 *
 * `mailConfigured` is a property of the deployment and is identical for every
 * address, so it cannot be used to work out whether an account exists.
 * Reporting per-message delivery here would leak precisely that, which is the
 * enumeration hole the silent-success behaviour below exists to avoid.
 */
export async function requestPasswordReset(email: string): Promise<{ mailConfigured: boolean }> {
  const mailConfigured = !mailLooksUnconfigured();
  const user = await prisma.user.findUnique({ where: { email } });
  // Always succeed silently to prevent account enumeration.
  if (!user || user.deletedAt) return { mailConfigured };
  const { token, tokenHash } = generateToken();
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      type: 'RESET_PASSWORD',
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  await sendMail({
    to: user.email,
    subject: 'Reset your SkillSplore password',
    text: `Reset your password using this link (valid for one hour):\n${link('/reset-password', token)}\n\nIf you did not request this, you can ignore it.`,
  });
  return { mailConfigured };
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  assertPasswordStrength(newPassword);
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.type !== 'RESET_PASSWORD' || record.usedAt || record.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    // Proving ownership via emailed reset link is a stronger signal than a
    // login attempt, so this also clears any brute-force lockout -- a
    // locked-out user isn't stuck waiting out the timer if they can reset.
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } }),
    prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Invalidate any other outstanding reset tokens for this user.
    prisma.emailToken.updateMany({
      where: { userId: record.userId, type: 'RESET_PASSWORD', usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
  await writeAudit({ actorId: record.userId, action: 'user.password_reset', entityType: 'User', entityId: record.userId });
}

// Demo-only shortcut: returns the pre-seeded demo account for a role.
// Guarded by env.demoLoginEnabled at the route layer (off in production).
export async function findDemoUser(role: 'admin' | 'student' | 'tutor' | 'pending_tutor'): Promise<User> {
  const emailByRole: Record<typeof role, string> = {
    admin: 'admin@demo.skillsplore.local',
    student: 'student@demo.skillsplore.local',
    tutor: 'tutor@demo.skillsplore.local',
    pending_tutor: 'pending.tutor@demo.skillsplore.local',
  } as const;
  const user = await prisma.user.findUnique({ where: { email: emailByRole[role] } });
  if (!user) throw badRequest('Demo accounts are not seeded. Run "npm run demo:seed".');
  return user;
}
