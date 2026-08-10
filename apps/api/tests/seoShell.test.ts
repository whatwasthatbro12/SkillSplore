import { describe, it, expect, beforeAll } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from './helpers.js';
import { renderShell } from '../src/lib/seoShell.js';

// A minimal stand-in for the built index.html.
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>SkillSplore | Find Someone to Learn From</title>
    <meta name="description" content="original" />
    <meta property="og:title" content="original" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

function rootContent(html: string): string {
  const m = /<div id="root">([\s\S]*)<\/div>/.exec(html);
  return m ? m[1]! : '';
}

describe('crawler shell', () => {
  // Creates its own catalogue rather than relying on seed state, so the
  // assertions mean the same thing on any database.
  beforeAll(async () => {
    const existing = await prisma.category.findUnique({ where: { normalizedName: 'seo fixture' } });
    if (existing) return;
    await prisma.category.create({
      data: {
        name: 'SEO Fixture',
        normalizedName: 'seo fixture',
        slug: 'seo-fixture',
        isFeatured: true,
        subjects: {
          create: Array.from({ length: 30 }, (_, i) => ({
            name: `Fixture Subject ${i}`,
            normalizedName: `fixture subject ${i}`,
            slug: `fixture-subject-${i}`,
          })),
        },
      },
    });
  });

  it('injects readable content on the homepage', async () => {
    const { html } = await renderShell(prisma, '/', SHELL);
    const body = rootContent(html);
    expect(body).toContain('<h1>');
    // The featured fixture category must appear, proving live data reaches
    // the shell rather than only static copy.
    expect(body).toContain('SEO Fixture');
  });

  it('lists the catalogue on /categories', async () => {
    const { html } = await renderShell(prisma, '/categories', SHELL);
    const body = rootContent(html);
    expect(body).toContain('SEO Fixture');
    expect(body).toContain('Fixture Subject 0');
    expect(body).toContain('Fixture Subject 29');
  });

  it('renders policy text for a policy route', async () => {
    const { html } = await renderShell(prisma, '/privacy', SHELL);
    const body = rootContent(html);
    expect(body).toContain('Privacy Policy');
    // The no-sale statement is the sentence most worth being crawlable.
    expect(body).toContain('does not sell personal information');
  });

  it('leaves app routes completely untouched', async () => {
    // Dashboard, messages and admin are behind a login and must not be
    // described to a crawler at all.
    for (const route of ['/dashboard', '/messages', '/admin', '/account']) {
      const { html, status } = await renderShell(prisma, route, SHELL);
      expect(html, `${route} should be served unchanged`).toBe(SHELL);
      expect(status).toBe(200);
    }
  });

  it('sets a route-specific title and canonical', async () => {
    const { html } = await renderShell(prisma, '/categories', SHELL);
    expect(html).toMatch(/<title>Everything you can learn/);
    expect(html).toMatch(/rel="canonical"/);
  });

  it('does not leave duplicate titles or descriptions', async () => {
    const { html } = await renderShell(prisma, '/', SHELL);
    expect(html.match(/<title>/g) ?? []).toHaveLength(1);
    expect(html.match(/name="description"/g) ?? []).toHaveLength(1);
    // The original og:title must be replaced, not appended to.
    expect(html.match(/property="og:title"/g) ?? []).toHaveLength(1);
  });

  it('escapes content rather than injecting raw HTML', async () => {
    const { html } = await renderShell(prisma, '/privacy', SHELL);
    const body = rootContent(html);
    // Policy text contains markdown and angle-bracket-ish characters; none of
    // it should become live markup beyond the tags we emit ourselves -- the
    // inline-styled wrapper div, and the elements the content builders use.
    const allowed = body.replace(/<\/?(main|section|nav|div|p|h1|h2|ul|li|a|strong)\b[^>]*>/g, '');
    expect(allowed).not.toMatch(/<script/i);
    expect(allowed).not.toMatch(/<[a-z]+\s/i);
  });
});

describe('crawler shell: dynamic routes', () => {
  let approvedId: number;
  let draftId: number;

  beforeAll(async () => {
    const mk = async (email: string, status: 'APPROVED' | 'DRAFT') => {
      const user = await prisma.user.create({
        data: { email, passwordHash: 'x', displayName: `Teacher ${status}` },
      });
      const profile = await prisma.tutorProfile.create({
        data: {
          userId: user.id,
          status,
          headline: `I teach ${status.toLowerCase()} things`,
          city: 'Auckland',
          country: 'New Zealand',
          deliveryMode: 'ONLINE',
        },
      });
      return profile.id;
    };
    approvedId = await mk(`seo.approved.${Date.now()}@test.local`, 'APPROVED');
    draftId = await mk(`seo.draft.${Date.now()}@test.local`, 'DRAFT');
  });

  it('describes an approved tutor profile', async () => {
    const { html, status } = await renderShell(prisma, `/tutors/${approvedId}`, SHELL);
    expect(status).toBe(200);
    expect(html).toContain('Teacher APPROVED');
    expect(html).toContain('I teach approved things');
    expect(html).toMatch(/"@type":\s*"Person"/);
  });

  it('404s an unapproved profile instead of publishing it', async () => {
    // A draft profile is one its owner has not published. Serving it to a
    // crawler would publish it on their behalf.
    const { html, status } = await renderShell(prisma, `/tutors/${draftId}`, SHELL);
    expect(status).toBe(404);
    expect(html).not.toContain('I teach draft things');
    expect(html).toContain('noindex');
  });

  it('404s a profile that does not exist', async () => {
    const { status } = await renderShell(prisma, '/tutors/99999999', SHELL);
    expect(status).toBe(404);
  });

  it('ignores a non-numeric profile id', async () => {
    const { html } = await renderShell(prisma, '/tutors/not-a-number', SHELL);
    expect(html).toBe(SHELL);
  });

  it('indexes a single-facet subject search as a landing page', async () => {
    const subject = await prisma.subject.findFirstOrThrow({ where: { isActive: true } });
    const { html } = await renderShell(
      prisma, '/search', SHELL, new URLSearchParams({ subjectId: String(subject.id) }),
    );
    expect(html).toContain(subject.name);
    expect(html).not.toContain('noindex');
  });

  it('marks a multi-facet search as noindex', async () => {
    // Near-duplicates of each other; indexing them dilutes the pages that
    // are actually worth ranking.
    const subject = await prisma.subject.findFirstOrThrow({ where: { isActive: true } });
    const { html } = await renderShell(
      prisma, '/search', SHELL,
      new URLSearchParams({ subjectId: String(subject.id), city: 'Auckland', mode: 'online' }),
    );
    expect(html).toContain('noindex');
  });

  it('indexes a bare /search', async () => {
    const { html } = await renderShell(prisma, '/search', SHELL);
    expect(html).not.toContain('noindex');
  });
});

describe('search engine verification', () => {
  it('omits the verification tag when no token is configured', async () => {
    const { html } = await renderShell(prisma, '/', SHELL);
    expect(html).not.toContain('google-site-verification');
  });

  it('emits the verification tag when a token is set', async () => {
    // Set on the frozen env object the shell reads, then restored -- the whole
    // point of the env-var approach is that the token survives a redeploy,
    // which a file in apps/web/public would not on a host with no disk.
    const original = env.GOOGLE_SITE_VERIFICATION;
    (env as { GOOGLE_SITE_VERIFICATION: string }).GOOGLE_SITE_VERIFICATION = 'test-token-abc123';
    try {
      const { html } = await renderShell(prisma, '/', SHELL);
      expect(html).toContain('<meta name="google-site-verification" content="test-token-abc123" />');
    } finally {
      (env as { GOOGLE_SITE_VERIFICATION: string }).GOOGLE_SITE_VERIFICATION = original;
    }
  });

  it('escapes the token rather than injecting raw markup', async () => {
    const original = env.GOOGLE_SITE_VERIFICATION;
    (env as { GOOGLE_SITE_VERIFICATION: string }).GOOGLE_SITE_VERIFICATION = '"><script>alert(1)</script>';
    try {
      const { html } = await renderShell(prisma, '/', SHELL);
      expect(html).not.toContain('<script>alert(1)</script>');
    } finally {
      (env as { GOOGLE_SITE_VERIFICATION: string }).GOOGLE_SITE_VERIFICATION = original;
    }
  });
});

describe('document structure', () => {
  it('wraps injected content in a main landmark', async () => {
    // Without a landmark, the version of the page that crawlers and screen
    // readers actually receive is an unstructured pile of text.
    const { html } = await renderShell(prisma, '/', SHELL);
    expect(html).toContain('<main');
    expect(html).toContain('</main>');
  });

  it('labels the category list as navigation', async () => {
    const { html } = await renderShell(prisma, '/', SHELL);
    expect(html).toContain('<nav aria-label="Popular categories">');
  });

  it('gives each category its own section on /categories', async () => {
    const { html } = await renderShell(prisma, '/categories', SHELL);
    expect(html).toContain('<section><h2>');
  });

  it('has exactly one h1 per described page', async () => {
    // More than one h1 leaves the page with no single subject; none leaves it
    // with no subject at all.
    for (const route of ['/', '/categories', '/privacy', '/about']) {
      const { html } = await renderShell(prisma, route, SHELL);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${route} should have one h1`).toBe(1);
    }
  });
});
