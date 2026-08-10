/**
 * Sign in with an existing Google account.
 *
 * Written against Google's endpoints directly rather than pulling in Passport
 * or a provider SDK. The authorization-code flow is about sixty lines, and the
 * project's stated aim is to stay portable and self-hostable -- an auth
 * framework is a large dependency to take on for one provider.
 *
 * Two things here carry real security weight, and both are easy to get subtly
 * wrong:
 *
 *   1. `state` is generated server-side, stored in the session, and compared on
 *      the way back. Without it, an attacker can complete a login in someone
 *      else's browser (CSRF against the callback).
 *
 *   2. An existing password account is only ever linked to a Google identity
 *      when Google says the address is verified. Linking on a bare address
 *      match is the standard way accounts get taken over: anyone who can get a
 *      provider to assert an address they do not own inherits the account.
 */
import { randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { recordRegistrationAcceptances } from './auth.service.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export function googleConfigured(): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
}

/** Must match a redirect URI registered in the Google Cloud console exactly. */
export function redirectUri(): string {
  const origin = (env.PUBLIC_SITE_URL || env.WEB_ORIGIN).replace(/\/$/, '');
  return `${origin}/api/auth/google/callback`;
}

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    // Only what is actually needed to create an account. Asking for more than
    // that is both a worse consent screen and more data to be responsible for.
    scope: 'openid email profile',
    state,
    // Keeps the account chooser predictable when several Google accounts are
    // signed in on the same browser.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

/**
 * Exchanges the one-time code for the ID token and reads its claims.
 *
 * The token's signature is deliberately not re-verified. This response comes
 * straight from Google's token endpoint over TLS in a server-to-server call
 * that included our client secret -- Google's own documentation states
 * verification is unnecessary for that path. Signature checking matters when a
 * token arrives from somewhere less trustworthy, such as a browser.
 */
export async function exchangeCode(code: string): Promise<GoogleClaims> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    // Google's body can echo request parameters, so it is logged rather than
    // returned to the browser.
    logger.error({ status: res.status }, 'google token exchange failed');
    throw badRequest('Google sign-in could not be completed. Please try again.');
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw badRequest('Google sign-in returned no identity token.');

  const payload = body.id_token.split('.')[1];
  if (!payload) throw badRequest('Google sign-in returned a malformed identity token.');

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleClaims;
  if (!claims.sub || !claims.email) throw badRequest('Google sign-in returned an incomplete profile.');
  return claims;
}

export interface OAuthResult {
  user: User;
  /** True when this call created the account, so the caller can route to the
   *  short "finish setting up" step rather than straight to the dashboard. */
  isNew: boolean;
}

export async function signInWithGoogle(
  claims: GoogleClaims,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<OAuthResult> {
  const email = claims.email.trim().toLowerCase();

  // Identity is the provider's subject id, never the address. Returning users
  // are found here even if they have since changed their Google address.
  const existingLink = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: claims.sub } },
    include: { user: true },
  });

  if (existingLink) {
    if (existingLink.user.status === 'SUSPENDED') throw forbidden('This account is suspended.');
    await prisma.oAuthAccount.update({
      where: { id: existingLink.id },
      data: { lastLoginAt: new Date(), email },
    });
    return { user: existingLink.user, isNew: false };
  }

  const byEmail = await prisma.user.findUnique({ where: { email } });

  if (byEmail) {
    // The account-takeover gate. An unverified address from a provider proves
    // nothing about who controls the mailbox, so it must not be allowed to
    // attach to an account somebody else created.
    if (!claims.email_verified) {
      throw badRequest(
        'Google has not verified that address, so it cannot be connected to an existing '
        + 'SkillSplore account. Please sign in with your password instead.',
      );
    }
    if (byEmail.status === 'SUSPENDED') throw forbidden('This account is suspended.');

    await prisma.oAuthAccount.create({
      data: { userId: byEmail.id, provider: 'GOOGLE', providerAccountId: claims.sub, email },
    });
    // Google has confirmed the mailbox, which is exactly what our own
    // verification email would have established.
    if (!byEmail.emailVerifiedAt) {
      await prisma.user.update({ where: { id: byEmail.id }, data: { emailVerifiedAt: new Date() } });
    }
    return { user: byEmail, isNew: false };
  }

  const user = await prisma.user.create({
    data: {
      email,
      // No password at all, rather than a placeholder hash -- see the schema.
      passwordHash: null,
      displayName: (claims.name ?? email.split('@')[0] ?? 'New member').slice(0, 80),
      roles: ['STUDENT'],
      // Google verifies the address before it will assert it as verified, so
      // this account starts able to message people. An unverified claim does
      // not get that, and the person is asked to confirm the address as usual.
      emailVerifiedAt: claims.email_verified ? new Date() : null,
      termsAcceptedAt: new Date(),
      oauthAccounts: {
        create: { provider: 'GOOGLE', providerAccountId: claims.sub, email },
      },
    },
  });

  // Same evidence trail as a password signup: which version of the Terms and
  // Privacy Policy this person agreed to, not merely that they agreed.
  await recordRegistrationAcceptances(user.id, meta.ipAddress ?? null, meta.userAgent ?? null);

  return { user, isNew: true };
}
