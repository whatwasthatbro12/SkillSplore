import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Email adapter over generic SMTP. In local/demo this points at Mailpit, which
// captures mail without sending it anywhere. In production it points at any
// standard SMTP provider. No proprietary email service is required.
let transporter: Transporter | null = null;

function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,

      // Without these, a mail server that accepts the TCP connection but never
      // answers leaves the send waiting on the operating system's timeout.
      // Requests that send mail -- registration, password reset -- are awaited
      // inline so the interface can honestly report whether the message went
      // out, which means an unbounded wait becomes an unbounded HTTP request.
      // Observed in production: the site answered in 0.3s while
      // /request-password-reset hung past two minutes.
      //
      // A bounded failure is far more useful than a slow success. If the
      // provider cannot be reached in ten seconds it is not going to be, and
      // the caller would rather be told than left hanging.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/**
 * Whether the SMTP settings look like the local-development default rather
 * than a real provider.
 *
 * A deployment pointing at localhost:1025 has no mail server, so every send
 * fails. That matters more than it sounds: nobody can verify an email address
 * (and verification gates messaging), and a forgotten password becomes a
 * permanent lockout.
 *
 * Deliberately a heuristic on the host. There is no way to know a remote SMTP
 * server actually works without sending to it, and doing that at boot would
 * make startup depend on a third party being reachable.
 */
export function mailLooksUnconfigured(): boolean {
  const host = env.SMTP_HOST.trim().toLowerCase();
  return host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  /** Set when delivery failed. Never shown to an end user verbatim. */
  error?: string;
}

/**
 * Sends a message and reports whether it actually went out.
 *
 * Still does not throw: a mail failure must not roll back an account that was
 * otherwise created successfully. But it no longer swallows the outcome
 * either. Callers need to know, so the interface can tell the user the truth
 * rather than "check your inbox" for a message that was never sent.
 */
export async function sendMail(mail: Mail): Promise<SendResult> {
  // Short-circuit rather than waiting for a connection refusal. On a host with
  // nothing on port 25/1025 this otherwise blocks the request for the length
  // of the TCP timeout.
  if (mailLooksUnconfigured()) {
    logger.error(
      { to: mail.to, subject: mail.subject, smtpHost: env.SMTP_HOST },
      'email NOT sent: no SMTP server configured (SMTP_HOST is still the local default)',
    );
    return { delivered: false, error: 'no-smtp-configured' };
  }

  try {
    const info = await getTransport().sendMail({ from: env.MAIL_FROM, ...mail });
    logger.info({ to: mail.to, subject: mail.subject, messageId: info.messageId }, 'email sent');
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to: mail.to, subject: mail.subject }, 'email send failed');
    return { delivered: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export function verificationEmail(name: string, link: string): Mail['text'] {
  return `Hi ${name},\n\nConfirm your SkillSplore email address:\n${link}\n\nIf you did not create this account you can ignore this message.`;
}
