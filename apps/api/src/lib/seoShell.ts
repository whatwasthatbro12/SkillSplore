/**
 * Server-rendered HTML for crawlers.
 *
 * The client is a Vite SPA, so the built index.html body is just
 * `<div id="root"></div>`. Anything that does not execute JavaScript -- most
 * AI crawlers, and Google unreliably -- sees an empty page. For a marketplace
 * that depends on being found, that is a real problem, and it was never
 * recorded as a tradeoff when the stack was chosen (see TECHNICAL_DEBT.md).
 *
 * Rather than adding a prerender build step or a headless browser, this hooks
 * the place the API already serves index.html and injects:
 *
 *   - a route-specific <title> and meta description
 *   - canonical and Open Graph tags
 *   - JSON-LD describing the organisation
 *   - real readable content inside #root
 *
 * The content inside #root matters: React's createRoot replaces the
 * container's children on mount, so a person with JavaScript never sees it,
 * and a crawler without JavaScript gets the whole thing. No duplicate-content
 * problem, no separate rendering path to keep in sync with the app.
 *
 * This deliberately does NOT try to render the React tree server-side. That
 * would mean a second rendering path that drifts from the client. What it
 * renders is a plain, honest summary of the page -- which is what a crawler
 * actually wants.
 */
import type { PrismaClient } from '@prisma/client';
import { LEGAL_DOCUMENTS } from '../content/legal/index.js';
import { env } from '../config/env.js';

function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Canonical public origin. Falls back to WEB_ORIGIN in non-production. */
function siteOrigin(): string {
  return env.PUBLIC_SITE_URL || env.WEB_ORIGIN;
}

export interface ShellContent {
  title: string;
  description: string;
  /** HTML placed inside #root. Already escaped by the builder. */
  body: string;
  /**
   * HTTP status to send. A missing or unpublished tutor profile must be a
   * genuine 404, not a 200 with an apologetic page -- otherwise crawlers index
   * dead URLs and treat the whole site as full of soft-404s.
   */
  status?: number;
  /**
   * False for pages that should be crawled but not indexed. Filtered search
   * results are the case that matters: they are near-duplicates of each other
   * and dilute the pages that are actually worth ranking.
   */
  indexable?: boolean;
  /** Page-specific JSON-LD, in addition to the site-wide Organization block. */
  jsonLd?: Record<string, unknown>;
}

export interface ShellResult {
  html: string;
  status: number;
}

const SITE_NAME = 'SkillSplore';
const DEFAULT_DESCRIPTION =
  'A moderated noticeboard for finding someone who can teach you a subject or skill. '
  + 'Learn online or in person, or post what you want to learn.';

/**
 * Strips the markdown a policy body is written in down to readable text.
 *
 * Crude on purpose -- a crawler wants the words, not the formatting, and a
 * real markdown renderer here would be a dependency for no benefit.
 */
function policyToText(markdown: string, maxChars = 12000): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')     // italic
    .replace(/`([^`]+)`/g, '$1')       // code
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> label
    .replace(/^\s*[->|]\s?/gm, '')     // quotes, bullets, table pipes
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n');
}

/** Routes that are public and worth describing. */
const STATIC_ROUTES: Record<string, { title: string; description: string; body: string }> = {
  '/about': {
    title: `About ${SITE_NAME}`,
    description: `What ${SITE_NAME} is, how it works, and what it deliberately does not do.`,
    body: `<h1>About ${SITE_NAME}</h1>
<p>${SITE_NAME} is a moderated noticeboard that helps people find someone who may be able to teach them a subject or skill.</p>
<p>We provide the platform: profiles, search, learning requests, responses, messaging, reporting, reviews and moderation. We do not employ the people listed, do not guarantee anyone's qualifications or safety, and are not a party to the arrangement two users make. Lessons and payment are arranged directly between them.</p>`,
  },
  '/contact': {
    title: `Contact ${SITE_NAME}`,
    description: `How to contact ${SITE_NAME} about support, privacy, security or a dispute.`,
    body: `<h1>Contact ${SITE_NAME}</h1>
<p>SkillSplore Limited, a New Zealand registered company, company number 9449842.</p>
<p>Support, privacy, security and disputes: admin@skillsplore.org</p>`,
  },
  '/search': {
    title: `Find someone to learn from | ${SITE_NAME}`,
    description: 'Search people who teach academic subjects, music, languages, trades, creative skills and more.',
    body: `<h1>Find someone to learn from</h1>
<p>Search by subject, category, location and format. Every profile is reviewed before it is published.</p>`,
  },
  '/requests/new': {
    title: `Post what you want to learn | ${SITE_NAME}`,
    description: 'Describe what you want to learn and let people who teach it come to you.',
    body: `<h1>Post what you want to learn</h1>
<p>Describe what you want to learn, in your own words. You can post anything, even if it is not in our catalogue.</p>`,
  },
};

async function homeContent(prisma: PrismaClient): Promise<ShellContent> {
  const categories = await prisma.category.findMany({
    where: { isFeatured: true, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    select: { name: true, slug: true, _count: { select: { subjects: true } } },
  });

  const list = categories
    .map((c) => `<li><a href="/search">${esc(c.name)}</a> — ${c._count.subjects} subjects</li>`)
    .join('\n');

  return {
    title: `${SITE_NAME} | Find Someone to Learn From`,
    description: DEFAULT_DESCRIPTION,
    body: `<h1>Find someone to learn from</h1>
<p>${esc(DEFAULT_DESCRIPTION)}</p>
<nav aria-label="Popular categories">
<h2>Popular categories</h2>
<ul>${list}</ul>
</nav>
<p><a href="/categories">See every category</a> · <a href="/requests/new">Post what you want to learn</a></p>`,
  };
}

async function categoriesContent(prisma: PrismaClient): Promise<ShellContent> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    select: {
      name: true,
      subjects: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { name: true } },
    },
  });

  const totalSubjects = categories.reduce((n, c) => n + c.subjects.length, 0);
  const sections = categories
    // One <section> per category, each owning its heading, so the page has a
    // real outline rather than a flat run of h2s a reader must infer from.
    .map((c) => `<section><h2>${esc(c.name)}</h2>\n<p>${c.subjects.map((s) => esc(s.name)).join(', ')}</p></section>`)
    .join('\n');

  return {
    title: `Everything you can learn | ${SITE_NAME}`,
    description: `Browse ${categories.length} categories and ${totalSubjects} subjects you can learn on ${SITE_NAME}.`,
    body: `<h1>Everything you can learn here</h1>
<p>${categories.length} categories, ${totalSubjects} subjects.</p>
${sections}`,
  };
}

function policyContent(path: string): ShellContent | null {
  const doc = LEGAL_DOCUMENTS.find((d) => d.path === path);
  if (!doc) return null;
  const text = policyToText(doc.body);
  return {
    title: `${doc.title} | ${SITE_NAME}`,
    description: `${doc.title} for ${SITE_NAME}.`,
    // policyToText strips markdown headings, so without this the document's
    // own title arrived as an ordinary paragraph and the page had no heading
    // at all -- a wall of <p> with nothing naming what it is.
    body: `<h1>${esc(doc.title)}</h1>\n${paragraphs(text)}`,
  };
}


/**
 * A published tutor profile.
 *
 * Only APPROVED profiles are described. A draft, pending, rejected, paused or
 * suspended profile returns a real 404 -- exposing one to a crawler would
 * publish a page its owner has not published, and returning 200 for a profile
 * that is not there teaches crawlers the site is full of soft-404s.
 *
 * Everything rendered here is already public on the profile page. No email, no
 * exact address, no qualification documents.
 */
async function tutorProfileContent(prisma: PrismaClient, id: number): Promise<ShellContent> {
  const profile = await prisma.tutorProfile.findFirst({
    where: { id, status: 'APPROVED' },
    include: {
      user: { select: { displayName: true } },
      subjects: { include: { subject: { select: { name: true } } } },
    },
  });

  if (!profile) {
    return {
      title: `Not found | ${SITE_NAME}`,
      description: 'This page could not be found.',
      body: `<h1>Not found</h1><p>This profile is not available. <a href="/search">Browse people who teach</a>.</p>`,
      status: 404,
      indexable: false,
    };
  }

  const name = profile.user.displayName;
  const subjects = profile.subjects.map((s) => s.subject.name);
  const place = [profile.city, profile.country].filter(Boolean).join(', ');
  const mode = profile.deliveryMode === 'ONLINE'
    ? 'Online'
    : profile.deliveryMode === 'IN_PERSON' ? 'In person' : 'Online or in person';

  const description = [
    `${name} teaches ${subjects.slice(0, 4).join(', ') || 'on SkillSplore'}`,
    place ? `in ${place}` : null,
    `(${mode.toLowerCase()}).`,
  ].filter(Boolean).join(' ');

  const parts = [`<h1>${esc(name)}</h1>`];
  if (profile.headline) parts.push(`<p>${esc(profile.headline)}</p>`);
  if (subjects.length) parts.push(`<h2>Teaches</h2><p>${subjects.map(esc).join(', ')}</p>`);
  parts.push(`<p>Format: ${esc(mode)}${place ? ` · ${esc(place)}` : ''}</p>`);
  if (profile.yearsExperience) parts.push(`<p>${profile.yearsExperience} years of experience.</p>`);
  if (profile.experience) parts.push(`<h2>Experience</h2><p>${esc(profile.experience)}</p>`);
  if (profile.teachingStyle) parts.push(`<h2>Teaching approach</h2><p>${esc(profile.teachingStyle)}</p>`);
  if (profile.ratingCount > 0) {
    parts.push(`<p>Rated ${profile.averageRating.toFixed(1)} from ${profile.ratingCount} review${profile.ratingCount === 1 ? '' : 's'}.</p>`);
  }

  // Person rather than a commercial Offer: SkillSplore does not sell the
  // lesson and does not set the price, so describing it as a purchasable
  // product would misrepresent what the page is.
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    description: profile.headline ?? description,
    knowsAbout: subjects,
    url: `${siteOrigin().replace(/\/$/, '')}/tutors/${profile.id}`,
  };
  if (place) jsonLd.homeLocation = { '@type': 'Place', name: place };
  if (profile.ratingCount > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: profile.averageRating,
      reviewCount: profile.ratingCount,
    };
  }

  return {
    title: `${name} — ${subjects[0] ?? 'teaching'} | ${SITE_NAME}`,
    description,
    body: parts.join('\n'),
    jsonLd,
  };
}

/**
 * Search, optionally filtered by a single category or subject.
 *
 * A bare /search and a single-facet filter are genuine landing pages worth
 * indexing -- "maths tutors" is what somebody actually searches for. Anything
 * with a free-text query or several facets is marked noindex: those pages are
 * near-duplicates of one another and dilute the ones worth ranking.
 */
async function searchContent(prisma: PrismaClient, query: URLSearchParams): Promise<ShellContent> {
  const subjectId = Number(query.get('subjectId'));
  const categoryId = Number(query.get('categoryId'));
  const facets = [...query.keys()].filter((k) => query.get(k));
  const singleFacet = facets.length === 1;

  if (Number.isInteger(subjectId) && subjectId > 0) {
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, isActive: true },
      select: { name: true, category: { select: { name: true } } },
    });
    if (subject) {
      const count = await prisma.tutorSubject.count({
        where: { subjectId, tutorProfile: { status: 'APPROVED' } },
      });
      return {
        title: `${subject.name} — find someone to teach you | ${SITE_NAME}`,
        description: `People who teach ${subject.name}${subject.category ? ` (${subject.category.name})` : ''} on ${SITE_NAME}.`,
        body: `<h1>${esc(subject.name)}</h1>
<p>Find someone to teach you ${esc(subject.name)}${subject.category ? ` — part of ${esc(subject.category.name)}` : ''}.</p>
${count > 0 ? `<p>${count} ${count === 1 ? 'person teaches' : 'people teach'} this.</p>` : '<p>Nobody is listed for this yet. <a href="/requests/new">Post what you want to learn</a> and let someone come to you.</p>'}`,
        indexable: singleFacet,
      };
    }
  }

  if (Number.isInteger(categoryId) && categoryId > 0) {
    const category = await prisma.category.findFirst({
      where: { id: categoryId, isActive: true },
      select: {
        name: true,
        subjects: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { name: true } },
      },
    });
    if (category) {
      return {
        title: `${category.name} — find someone to teach you | ${SITE_NAME}`,
        description: `People who teach ${category.name} on ${SITE_NAME}. ${category.subjects.length} subjects.`,
        body: `<h1>${esc(category.name)}</h1>
<p>${category.subjects.length} subjects in this category.</p>
<p>${category.subjects.map((x) => esc(x.name)).join(', ')}</p>`,
        indexable: singleFacet,
      };
    }
  }

  const base = STATIC_ROUTES['/search']!;
  // A bare /search is indexable; any filtered variant that got here did not
  // resolve to a real facet, so it is not worth indexing.
  return { ...base, indexable: facets.length === 0 };
}

async function contentFor(
  prisma: PrismaClient,
  path: string,
  query: URLSearchParams,
): Promise<ShellContent | null> {
  if (path === '/') return homeContent(prisma);
  if (path === '/categories') return categoriesContent(prisma);
  if (path === '/search') return searchContent(prisma, query);

  const tutor = /^\/tutors\/(\d+)$/.exec(path);
  if (tutor) return tutorProfileContent(prisma, Number(tutor[1]));

  const staticRoute = STATIC_ROUTES[path];
  if (staticRoute) return staticRoute;

  return policyContent(path);
}

function organisationJsonLd(): string {
  const origin = siteOrigin();
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    legalName: 'SkillSplore Limited',
    url: origin,
    email: 'admin@skillsplore.org',
    description: DEFAULT_DESCRIPTION,
    areaServed: ['NZ', 'AU'],
  });
}

/**
 * Rewrites the built index.html for one request.
 *
 * Returns the original html untouched when the route is not one we describe,
 * so anything app-shaped (dashboard, messages, admin) is unaffected.
 */
export async function renderShell(
  prisma: PrismaClient,
  path: string,
  html: string,
  query: URLSearchParams = new URLSearchParams(),
): Promise<ShellResult> {
  let content: ShellContent | null = null;
  try {
    content = await contentFor(prisma, path, query);
  } catch {
    // A crawler getting the plain SPA shell is a far better outcome than a
    // 500, so a database hiccup here must never break page delivery.
    return { html, status: 200 };
  }
  if (!content) return { html, status: 200 };

  const origin = siteOrigin();
  const canonical = `${origin.replace(/\/$/, '')}${path}`;

  const head = `
    <title>${esc(content.title)}</title>
    <meta name="description" content="${esc(content.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:title" content="${esc(content.title)}" />
    <meta property="og:description" content="${esc(content.description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta name="twitter:card" content="summary" />
    ${content.indexable === false ? '<meta name="robots" content="noindex,follow" />' : ''}
    ${env.GOOGLE_SITE_VERIFICATION
      ? `<meta name="google-site-verification" content="${esc(env.GOOGLE_SITE_VERIFICATION)}" />`
      : ''}
    <script type="application/ld+json">${organisationJsonLd()}</script>
    ${content.jsonLd ? `<script type="application/ld+json">${JSON.stringify(content.jsonLd)}</script>` : ''}
  `.trim();

  // Replace the static title/description/canonical/OG that index.html ships
  // with, so a crawler does not see two of each.
  let out = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/i, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="robots"[^>]*>\s*/gi, '');

  out = out.replace('</head>', `${head}\n  </head>`);

  // React's createRoot clears the container on mount, so this is invisible to
  // anyone running JavaScript and is the whole page to anyone who is not.
  //
  // The wrapper carries INLINE styles rather than class names on purpose. The
  // browser paints this markup before the stylesheet has loaded and before
  // React has mounted, so anything depending on styles.css would flash as raw
  // unstyled HTML -- worst on mobile, where JavaScript takes longest to parse.
  // Inline styles cannot arrive late.
  //
  // Deliberately NOT hidden with display:none. Showing crawlers content that
  // users cannot see is cloaking, and search engines treat it as such. This
  // renders the same words a person would read, just plainer.
  const wrapper =
    'max-width:46rem;margin:0 auto;padding:2rem 1.25rem;'
    + "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;"
    + 'line-height:1.6;color:#1a1a1a;';

  // <main>, not <div>. This markup IS the page for anything that does not run
  // JavaScript -- most AI crawlers, and Google unreliably -- and a document
  // with no landmark has no structure for them to read. The React app already
  // renders header/nav/main/footer correctly; this is the half that crawlers
  // and screen readers actually receive, and it was a bare div.
  out = out.replace(
    '<div id="root"></div>',
    `<div id="root"><main style="${wrapper}">${content.body}</main></div>`,
  );

  return { html: out, status: content.status ?? 200 };
}
