import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../lib/validate.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { selfUser } from '../../lib/serializers.js';
import { env } from '../../config/env.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import {
  registerSchema,
  loginSchema,
  requestResetSchema,
  resetSchema,
  tokenSchema,
  demoLoginSchema,
} from './auth.schemas.js';
import * as auth from './auth.service.js';

import * as oauth from './oauth.service.js';
import { logger } from '../../lib/logger.js';

export const authRouter = Router();

// Regenerate the session on privilege change to prevent session fixation.
function loginSession(req: Request, userId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { user, emailDelivered } = await auth.register({
      ...req.body,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    await loginSession(req, user.id);
    // The account exists either way. `emailDelivered` lets the interface say
    // so honestly instead of telling someone to check an inbox that will
    // never receive anything.
    res.status(201).json({ user: selfUser(user), emailDelivered });
  }),
);

authRouter.post(
  '/verify-email',
  validate({ body: tokenSchema }),
  asyncHandler(async (req, res) => {
    await auth.verifyEmail(req.body.token);
    res.json({ ok: true });
  }),
);

// Rate limited: this sends an email on demand, so it must not be usable to
// flood someone's inbox.
authRouter.post(
  '/resend-verification',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { emailDelivered } = await auth.resendVerification(req.user!.id);
    res.json({ ok: true, emailDelivered });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await auth.authenticate(req.body.email, req.body.password);
    await loginSession(req, user.id);
    res.json({ user: selfUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie('skillsplore.sid');
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/request-password-reset',
  authLimiter,
  validate({ body: requestResetSchema }),
  asyncHandler(async (req, res) => {
    const { mailConfigured } = await auth.requestPasswordReset(req.body.email);
    // Deployment-wide fact, identical for every address, so returning it
    // cannot be used to discover whether an account exists. Lets the page warn
    // that no reset email can arrive rather than leaving someone waiting.
    res.json({ ok: true, mailConfigured });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetSchema }),
  asyncHandler(async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ user: req.user ? selfUser(req.user) : null });
  }),
);

// Demo-only login shortcut. Hard-disabled in production.
authRouter.post(
  '/demo-login',
  validate({ body: demoLoginSchema }),
  asyncHandler(async (req, res) => {
    if (!env.demoLoginEnabled) throw forbidden('Demo login is disabled.');
    const user = await auth.findDemoUser(req.body.role);
    await loginSession(req, user.id);
    res.json({ user: selfUser(user) });
  }),
);

authRouter.get('/session-check', requireAuth, (req, res) => {
  res.json({ user: selfUser(req.user!) });
});

// ---------------------------------------------------------------------------
// Sign in with Google
// ---------------------------------------------------------------------------
//
// Browser redirects rather than JSON, because the flow leaves our origin and
// comes back. Errors therefore end at a page with a message in the query
// string, never a JSON body the person would see as raw text.

/** Where to send someone back to when the flow ends, with a short reason. */
function backToLogin(reason: string): string {
  const origin = (env.PUBLIC_SITE_URL || env.WEB_ORIGIN).replace(/\/$/, '');
  return `${origin}/login?error=${encodeURIComponent(reason)}`;
}

authRouter.get(
  '/google',
  authLimiter,
  asyncHandler(async (req, res) => {
    if (!oauth.googleConfigured()) return res.redirect(backToLogin('google-not-configured'));

    const state = oauth.newState();
    req.session.oauthState = state;
    // Saved explicitly: the redirect leaves immediately, and without this the
    // store write can lose the race, making every callback fail state checking.
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())));

    res.redirect(oauth.buildAuthUrl(state));
  }),
);

authRouter.get(
  '/google/callback',
  authLimiter,
  asyncHandler(async (req, res) => {
    if (!oauth.googleConfigured()) return res.redirect(backToLogin('google-not-configured'));

    const expected = req.session.oauthState;
    // Consumed whatever happens, so a state value is never replayable.
    delete req.session.oauthState;

    const { code, state, error } = req.query as Record<string, string | undefined>;
    // The person pressed Cancel on Google's consent screen. Not an error worth
    // shouting about -- send them back quietly.
    if (error) return res.redirect(backToLogin('google-cancelled'));
    if (!code || !state || !expected || state !== expected) {
      return res.redirect(backToLogin('google-state-mismatch'));
    }

    let result;
    try {
      const claims = await oauth.exchangeCode(code);
      result = await oauth.signInWithGoogle(claims, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
    } catch (err) {
      logger.error({ err }, 'google sign-in failed');
      // Includes the deliberate refusal to link an unverified address to an
      // existing account, which is a real answer rather than a fault.
      return res.redirect(backToLogin('google-failed'));
    }

    await loginSession(req, result.user.id);

    const origin = (env.PUBLIC_SITE_URL || env.WEB_ORIGIN).replace(/\/$/, '');
    // A new account has not been asked whether they are under 18, which the
    // password signup form does ask. That question decides whether in-person
    // lessons are offered, so it cannot be skipped -- it is asked once, after
    // the account exists.
    res.redirect(result.isNew ? `${origin}/welcome` : `${origin}/dashboard`);
  }),
);

/** Lets the login page decide whether to render the Google button at all. */
authRouter.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({ google: oauth.googleConfigured() });
  }),
);

/**
 * Records the age declaration a Google signup could not be asked for.
 *
 * Deliberately one-way: it can move an account from the default (adult) to
 * minor, but not back. Someone who has declared themselves under 18 must not
 * be able to lift their own restriction by re-answering -- that would make the
 * question decorative. An adult who mis-taps contacts support, which is the
 * rarer and safer direction to make awkward.
 */
authRouter.patch(
  '/me/age-declaration',
  requireAuth,
  validate({ body: z.object({ isAdult: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (current.isMinor && req.body.isAdult) {
      throw badRequest(
        'This account is set to under 18. Please contact us at admin@skillsplore.org to change that.',
      );
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { isMinor: !req.body.isAdult },
    });
    res.json({ user: selfUser(user) });
  }),
);
