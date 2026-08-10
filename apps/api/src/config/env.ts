import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the repository root regardless of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../../../.env') });
loadDotenv(); // also allow a local .env next to cwd

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === '1' || v.toLowerCase() === 'true'));

const schema = z.object({
  APP_ENV: z.enum(['development', 'demo', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Canonical public URL, used for canonical/Open Graph tags in the crawler
  // shell. Separate from WEB_ORIGIN, which is the CORS origin -- they are the
  // same in most deployments but not necessarily.
  PUBLIC_SITE_URL: z.string().default(''),
  // Google Search Console ownership token, the `content` value from the
  // "HTML tag" verification method. Set as an env var rather than a file in
  // apps/web/public because Render's free tier has no persistent disk -- an
  // uploaded verification file disappears on the next redeploy and the
  // property silently loses its verified status.
  GOOGLE_SITE_VERIFICATION: z.string().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  FORCE_SECURE_COOKIES: bool(false),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_SECURE: bool(false),
  MAIL_FROM: z.string().default('SkillSplore <no-reply@skillsplore.local>'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage-data'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('skillsplore'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),

  SHOW_DEMO_BANNER: bool(true),
  ENABLE_DEMO_LOGIN: bool(true),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // Per-account brute-force lockout. Distinct from AUTH_RATE_LIMIT_MAX (which
  // is per-IP): this catches a distributed attack against one specific
  // account from many IPs, which IP-based rate limiting alone would miss.
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(8),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // -------------------------------------------------------------------------
  // Data monetisation kill switches.
  //
  // Every one of these defaults to false and stays false unless somebody
  // deliberately sets it. They are declared here rather than being implicit so
  // that "are we selling user data?" is answerable by reading one file, and so
  // that the production guard below can refuse to boot on an unsafe
  // combination instead of leaving it to a code path nobody tests.
  //
  // SELL_PERSONAL_DATA and SELL_CHILD_DATA have no supporting implementation
  // at all -- nothing reads them to enable a feature. They exist so that
  // enabling data selling is an explicit, greppable, test-failing act rather
  // than something that can be quietly added later.
  // -------------------------------------------------------------------------
  SELL_PERSONAL_DATA: bool(false),
  SELL_CHILD_DATA: bool(false),
  BEHAVIOURAL_ADVERTISING_ENABLED: bool(false),
  USE_MESSAGES_FOR_ADVERTISING: bool(false),

  // The optional Data Insights Programme (aggregated/de-identified statistical
  // reports only). Disabled pending the legal review recorded in
  // docs/LEGAL_REVIEW_REQUIRED.md. Even when enabled it never authorises
  // user-level disclosure; see DATA_INSIGHTS_PRECONDITIONS below.
  DATA_INSIGHTS_PROGRAM_ENABLED: bool(false),
  // Set only once a qualified lawyer has signed off. Recorded as free text
  // (name + date) so the value itself is the evidence.
  DATA_INSIGHTS_LEGAL_REVIEW_REF: z.string().default(''),

  // -------------------------------------------------------------------------
  // Tutor signup fee.
  //
  // Off by default. When disabled, nothing in the product mentions a fee and
  // no payment record is ever created -- the platform behaves exactly as it
  // did before this feature existed.
  //
  // SkillSplore never handles card numbers. The provider adapters use hosted
  // checkout, so card data goes from the payer's browser to the processor and
  // never touches this server or this database. See src/lib/payments/.
  // -------------------------------------------------------------------------
  PAYMENTS_ENABLED: bool(false),
  // 1299 = NZD 12.99. Stored in cents to avoid float rounding on money.
  SIGNUP_FEE_CENTS: z.coerce.number().int().min(0).default(1299),
  SIGNUP_FEE_CURRENCY: z.enum(['NZD', 'AUD']).default('NZD'),
  // The first N approved tutors pay nothing. Allocation is atomic -- see
  // claimFreeTierSlot in src/lib/payments/freeTier.ts.
  FREE_SIGNUP_LIMIT: z.coerce.number().int().min(0).default(50),

  // 'none' is a real, safe provider: it refuses to create a checkout. It is
  // the default so that turning PAYMENTS_ENABLED on without choosing a
  // processor fails loudly rather than appearing to charge people.
  PAYMENT_PROVIDER: z.enum(['none', 'stripe', 'windcave']).default('none'),
  PAYMENT_PUBLIC_KEY: z.string().default(''),
  PAYMENT_SECRET_KEY: z.string().default(''),
  // Shared secret used to verify that a webhook genuinely came from the
  // processor. Without it, anyone who learns the URL can mark an order paid.
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

const isProduction = raw.APP_ENV === 'production';
const isDemo = raw.APP_ENV === 'demo';
const isDevelopment = raw.APP_ENV === 'development';

// ---------------------------------------------------------------------------
// Production safety guards. Production must never boot with demo shortcuts or
// insecure secrets. Safety is derived from APP_ENV, never from the hostname.
// ---------------------------------------------------------------------------
const INSECURE_SESSION_SECRETS = new Set([
  'dev-only-insecure-session-secret-change-me',
  'demo-compose-session-secret-change-for-any-real-use',
  'changeme',
  'secret',
]);

if (isProduction) {
  const failures: string[] = [];
  if (raw.ENABLE_DEMO_LOGIN) failures.push('ENABLE_DEMO_LOGIN must be off in production.');
  if (raw.SHOW_DEMO_BANNER) {
    // Not fatal, but forced off below. Warn loudly.
    console.warn('SHOW_DEMO_BANNER is ignored in production and forced off.');
  }
  if (INSECURE_SESSION_SECRETS.has(raw.SESSION_SECRET) || raw.SESSION_SECRET.length < 32) {
    failures.push('SESSION_SECRET must be a unique random string of at least 32 characters in production.');
  }
  if (raw.STORAGE_DRIVER === 's3' && (!raw.S3_ACCESS_KEY || !raw.S3_SECRET_KEY || !raw.S3_ENDPOINT)) {
    failures.push('S3 storage in production requires S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY.');
  }

  // Without a real mail server nobody can verify an email address, and email
  // verification gates messaging -- so the marketplace does not function. A
  // forgotten password also becomes a permanent lockout. A production
  // deployment that cannot send email is not a working deployment.
  const smtpHost = raw.SMTP_HOST.trim().toLowerCase();
  if (smtpHost === '' || smtpHost === 'localhost' || smtpHost === '127.0.0.1' || smtpHost === '::1') {
    failures.push(
      `SMTP_HOST is "${raw.SMTP_HOST}", which is the local development default. Production needs a real `
      + 'mail provider: without one, email verification and password reset both fail silently.',
    );
  }
  // A .local address is not deliverable and most providers will reject it
  // outright, so mail would fail even with a correct SMTP host.
  if (/@[^\s>]*\.local\b/i.test(raw.MAIL_FROM)) {
    failures.push(`MAIL_FROM is "${raw.MAIL_FROM}". A .local address is not a real domain and will be rejected.`);
  }

  // Data monetisation guards. These are hard failures rather than warnings:
  // the cost of booting with one of them silently on is a privacy breach and
  // a regulator complaint, which is not recoverable by fixing the config
  // afterwards. See docs/LEGAL_REVIEW_REQUIRED.md.
  if (raw.SELL_PERSONAL_DATA) {
    failures.push(
      'SELL_PERSONAL_DATA must be false. Selling personal information or user-level behavioural '
      + 'profiles is not implemented and must not be enabled without legal review, separate '
      + 'consent, recipient contracts and a withdrawal path.',
    );
  }
  if (raw.SELL_CHILD_DATA) {
    failures.push("SELL_CHILD_DATA must be false. Children's information is never included in any data programme.");
  }
  if (raw.USE_MESSAGES_FOR_ADVERTISING) {
    failures.push('USE_MESSAGES_FOR_ADVERTISING must be false. Private message content is not used for profiling or advertising.');
  }
  if (raw.BEHAVIOURAL_ADVERTISING_ENABLED) {
    failures.push('BEHAVIOURAL_ADVERTISING_ENABLED must be false. Behavioural advertising is not implemented and requires legal review first.');
  }
  // The insights programme is aggregate-only, but still must not run in
  // production before a lawyer has actually looked at it.
  if (raw.DATA_INSIGHTS_PROGRAM_ENABLED && !raw.DATA_INSIGHTS_LEGAL_REVIEW_REF.trim()) {
    failures.push(
      'DATA_INSIGHTS_PROGRAM_ENABLED requires DATA_INSIGHTS_LEGAL_REVIEW_REF to record who reviewed it and when.',
    );
  }

  // Charging real money with a half-configured processor is worse than not
  // charging at all: it produces users who believe they have paid and records
  // that cannot be reconciled. Fail the boot instead.
  if (raw.PAYMENTS_ENABLED) {
    if (raw.PAYMENT_PROVIDER === 'none') {
      failures.push('PAYMENTS_ENABLED requires PAYMENT_PROVIDER to be a real processor, not "none".');
    }
    if (!raw.PAYMENT_SECRET_KEY.trim()) {
      failures.push('PAYMENTS_ENABLED requires PAYMENT_SECRET_KEY.');
    }
    if (!raw.PAYMENT_WEBHOOK_SECRET.trim()) {
      failures.push(
        'PAYMENTS_ENABLED requires PAYMENT_WEBHOOK_SECRET. Without it, webhook signatures cannot be '
        + 'verified and anyone who learns the endpoint URL could mark an order as paid.',
      );
    }
    if (raw.SIGNUP_FEE_CENTS <= 0) {
      failures.push('PAYMENTS_ENABLED with SIGNUP_FEE_CENTS of 0 would create zero-value charges. Set a real amount or disable payments.');
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nRefusing to start in production with insecure demonstration settings:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        `\n`,
    );
    process.exit(1);
  }
}

export const env = {
  ...raw,
  // Derived, safety-corrected flags. Demo tooling is impossible in production.
  isProduction,
  isDemo,
  isDevelopment,
  demoLoginEnabled: raw.ENABLE_DEMO_LOGIN && !isProduction,
  demoToolsEnabled: !isProduction,
  showDemoBanner: raw.SHOW_DEMO_BANNER && !isProduction,
  secureCookies: isProduction || raw.FORCE_SECURE_COOKIES,

  // Derived, safety-corrected monetisation flags. Read these, never the raw
  // values: outside production the guard above does not run, so the raw flags
  // could be anything a developer put in their .env. Forcing them false here
  // means no code path can act on user-level data selling by accident in any
  // environment.
  sellPersonalData: false as const,
  sellChildData: false as const,
  useMessagesForAdvertising: false as const,
  behaviouralAdvertisingEnabled: false as const,
  // The one flag that can genuinely be on, and only for aggregate reports.
  dataInsightsProgramEnabled: raw.DATA_INSIGHTS_PROGRAM_ENABLED && !!raw.DATA_INSIGHTS_LEGAL_REVIEW_REF.trim(),

  // Payments are only "on" when a real processor is configured. Outside
  // production the guard above does not run, so this derived value is what
  // every code path must read -- it cannot be true with PAYMENT_PROVIDER
  // 'none' in any environment.
  paymentsEnabled: raw.PAYMENTS_ENABLED && raw.PAYMENT_PROVIDER !== 'none',
};

export type Env = typeof env;
