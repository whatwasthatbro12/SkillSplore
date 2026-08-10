import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../lib/validate.js';
import { requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';
import { sendMail } from '../../lib/mailer.js';
import { money } from '../../lib/serializers.js';
import { normalizeName } from '../../lib/normalize.js';
import { DEFAULT_VERIFICATION_LABELS } from '../../lib/verification.js';
import { hideContent, loadReportContext } from './admin.moderation.js';
import { publishVersion } from '../../lib/legalSync.js';
import { LegalDocumentNotPublishableError } from '../../lib/legalPlaceholders.js';
import { LEGAL_DOCUMENTS } from '../../content/legal/index.js';
import { recomputeTutorRating } from '../reviews/reviews.service.js';
import { fullProfileInclude } from '../tutors/tutors.service.js';

export const adminRouter = Router();

// Every admin route requires the ADMIN role (central authorisation).
adminRouter.use(requireRole('ADMIN'));

// --- Dashboard statistics --------------------------------------------------

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      users,
      approvedTutors,
      pendingApplications,
      openRequests,
      engagements,
      completedEngagements,
      reviews,
      openReports,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.tutorProfile.count({ where: { status: 'APPROVED' } }),
      prisma.tutorProfile.count({ where: { status: 'PENDING' } }),
      prisma.tutoringRequest.count({ where: { status: 'OPEN' } }),
      prisma.engagement.count(),
      prisma.engagement.count({ where: { status: 'COMPLETED' } }),
      prisma.review.count(),
      prisma.report.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
    ]);
    res.json({
      stats: { users, approvedTutors, pendingApplications, openRequests, engagements, completedEngagements, reviews, openReports },
    });
  }),
);

// --- Users -----------------------------------------------------------------

adminRouter.get(
  '/users',
  validate({ query: z.object({ q: z.string().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query.q as string | undefined;
    const status = req.query.status as 'ACTIVE' | 'SUSPENDED' | undefined;
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status,
        ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, email: true, displayName: true, roles: true, status: true, createdAt: true, emailVerifiedAt: true },
    });
    res.json({ users });
  }),
);

const suspendSchema = z.object({ reason: z.string().max(500).optional() });

adminRouter.post(
  '/users/:id/suspend',
  validate({ body: suspendSchema }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: req.body.reason } });
    await writeAudit({ actorId: req.user!.id, action: 'user.suspended', entityType: 'User', entityId: id, metadata: { reason: req.body.reason } });
    await notify({ userId: id, type: 'account', title: 'Your account has been suspended', body: req.body.reason });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/users/:id/reinstate',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await prisma.user.update({ where: { id }, data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null } });
    await writeAudit({ actorId: req.user!.id, action: 'user.reinstated', entityType: 'User', entityId: id });
    res.json({ ok: true });
  }),
);

// --- Tutor applications & approved tutors ----------------------------------

adminRouter.get(
  '/applications',
  validate({ query: z.object({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string) || 'PENDING';
    const rows = await prisma.tutorProfile.findMany({
      where: { status: status as never },
      orderBy: { submittedAt: 'asc' },
      include: { user: { select: { id: true, displayName: true, email: true } }, subjects: { include: { subject: true } } },
    });
    res.json({
      applications: rows.map((p) => ({
        id: p.id,
        status: p.status,
        headline: p.headline,
        submittedAt: p.submittedAt,
        user: p.user,
        subjects: p.subjects.map((s) => s.subject.name),
      })),
    });
  }),
);

adminRouter.get(
  '/tutors',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.tutorProfile.findMany({
      where: { status: { in: ['APPROVED', 'PAUSED', 'SUSPENDED'] } },
      orderBy: { approvedAt: 'desc' },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    res.json({
      tutors: rows.map((p) => ({
        id: p.id,
        status: p.status,
        headline: p.headline,
        averageRating: p.averageRating,
        ratingCount: p.ratingCount,
        user: p.user,
      })),
    });
  }),
);

// Full application detail, including private qualification document links
// (admins may access qualification documents securely; access is audited by
// the files route when the document is actually fetched).
adminRouter.get(
  '/tutors/:id',
  asyncHandler(async (req, res) => {
    const p = await prisma.tutorProfile.findUnique({ where: { id: Number(req.params.id) }, include: fullProfileInclude });
    if (!p) throw notFound();
    res.json({
      tutor: {
        id: p.id,
        status: p.status,
        headline: p.headline,
        experience: p.experience,
        teachingStyle: p.teachingStyle,
        deliveryMode: p.deliveryMode,
        country: p.country,
        city: p.city,
        hourlyRate: money(p.hourlyRateCents, p.currency),
        changeRequestNote: p.changeRequestNote,
        submittedAt: p.submittedAt,
        user: { id: p.user.id, displayName: p.user.displayName, email: p.user.email },
        subjects: p.subjects.map((s) => ({ name: s.subject.name, price: money(s.priceCents ?? p.hourlyRateCents, p.currency) })),
        levels: p.levels.map((l) => l.name),
        qualifications: p.qualifications.map((q) => ({
          id: q.id,
          title: q.title,
          institution: q.institution,
          year: q.year,
          hasDocument: !!q.documentKey,
          documentUrl: q.documentKey ? `/api/files/qualification/${q.id}` : null,
          verified: !!q.verifiedAt,
        })),
        verifications: p.verifications.map((v) => ({
          id: v.id,
          type: v.type,
          label: v.label,
          evidenceRef: v.evidenceRef,
          checkedAt: v.checkedAt,
          expiresAt: v.expiresAt,
          revokedAt: v.revokedAt,
          revokedReason: v.revokedReason,
        })),
      },
    });
  }),
);

async function transitionTutor(
  adminId: number,
  profileId: number,
  data: Parameters<typeof prisma.tutorProfile.update>[0]['data'],
  action: string,
  emailSubject: string,
  emailBody: string,
): Promise<void> {
  const profile = await prisma.tutorProfile.update({
    where: { id: profileId },
    data,
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });
  await writeAudit({ actorId: adminId, action, entityType: 'TutorProfile', entityId: profileId });
  await notify({ userId: profile.user.id, type: 'tutor_review', title: emailSubject, body: emailBody, linkUrl: '/tutor/onboarding' });
  await sendMail({ to: profile.user.email, subject: emailSubject, text: `Hi ${profile.user.displayName},\n\n${emailBody}` });
}

adminRouter.post(
  '/tutors/:id/approve',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await transitionTutor(
      req.user!.id,
      id,
      { status: 'APPROVED', approvedAt: new Date(), reviewedById: req.user!.id, changeRequestNote: null },
      'tutor.approved',
      'Your tutor profile is approved',
      'Congratulations — your SkillSplore tutor profile is now live and searchable.',
    );
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/tutors/:id/request-changes',
  validate({ body: z.object({ note: z.string().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await transitionTutor(
      req.user!.id,
      id,
      { status: 'CHANGES_REQUESTED', changeRequestNote: req.body.note, reviewedById: req.user!.id },
      'tutor.changes_requested',
      'Changes requested on your tutor profile',
      `Please update your profile and resubmit. Reviewer note:\n\n${req.body.note}`,
    );
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/tutors/:id/reject',
  validate({ body: z.object({ note: z.string().max(1000).optional() }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await transitionTutor(
      req.user!.id,
      id,
      { status: 'REJECTED', reviewedById: req.user!.id },
      'tutor.rejected',
      'Your tutor application was not approved',
      req.body.note || 'After review, your application was not approved at this time.',
    );
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/tutors/:id/suspend',
  validate({ body: suspendSchema }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await transitionTutor(
      req.user!.id,
      id,
      { status: 'SUSPENDED' },
      'tutor.suspended',
      'Your tutor profile has been suspended',
      req.body.reason || 'Your tutor profile has been suspended pending review.',
    );
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/qualifications/:id/verify',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const qualification = await prisma.qualification.findUnique({ where: { id } });
    if (!qualification) throw notFound('Qualification not found.');
    await prisma.qualification.update({ where: { id }, data: { verifiedAt: new Date(), verifiedById: req.user!.id } });
    // The public badge comes from Verification, not the boolean above --
    // this is what actually makes "Qualification document checked" appear
    // on the tutor's profile with a real reviewer and date attached.
    await prisma.verification.create({
      data: {
        tutorProfileId: qualification.tutorProfileId,
        type: 'QUALIFICATION_DOCUMENT',
        label: DEFAULT_VERIFICATION_LABELS.QUALIFICATION_DOCUMENT,
        evidenceRef: qualification.title,
        reviewedById: req.user!.id,
      },
    });
    await writeAudit({ actorId: req.user!.id, action: 'qualification.verified', entityType: 'Qualification', entityId: id });
    res.json({ ok: true });
  }),
);

// --- Verification records ---------------------------------------------------
// Manual add covers checks with no dedicated evidence-upload flow yet (e.g.
// identity), and re-recording email confirmation for tutors who verified
// before this system existed.

adminRouter.post(
  '/tutors/:profileId/verifications',
  validate({
    body: z.object({
      type: z.enum(['IDENTITY_DOCUMENT', 'QUALIFICATION_DOCUMENT', 'EMAIL_CONFIRMED']),
      label: z.string().min(3).max(120).optional(),
      evidenceRef: z.string().max(300).optional(),
      expiresAt: z.string().datetime().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const tutorProfileId = Number(req.params.profileId);
    const profile = await prisma.tutorProfile.findUnique({ where: { id: tutorProfileId } });
    if (!profile) throw notFound('Tutor profile not found.');
    const verification = await prisma.verification.create({
      data: {
        tutorProfileId,
        type: req.body.type,
        label: req.body.label || DEFAULT_VERIFICATION_LABELS[req.body.type as keyof typeof DEFAULT_VERIFICATION_LABELS],
        evidenceRef: req.body.evidenceRef,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        reviewedById: req.user!.id,
      },
    });
    await writeAudit({ actorId: req.user!.id, action: 'verification.added', entityType: 'TutorProfile', entityId: tutorProfileId, metadata: { type: req.body.type } });
    res.status(201).json({ verification });
  }),
);

adminRouter.post(
  '/verifications/:id/revoke',
  validate({ body: z.object({ reason: z.string().min(3).max(300) }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.verification.findUnique({ where: { id } });
    if (!existing) throw notFound('Verification not found.');
    if (existing.revokedAt) throw badRequest('This verification is already revoked.');
    await prisma.verification.update({ where: { id }, data: { revokedAt: new Date(), revokedReason: req.body.reason } });
    await writeAudit({ actorId: req.user!.id, action: 'verification.revoked', entityType: 'Verification', entityId: id, metadata: { reason: req.body.reason } });
    res.json({ ok: true });
  }),
);

// --- Student requests (admin oversight) ------------------------------------

adminRouter.get(
  '/requests',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.tutoringRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { student: { select: { id: true, displayName: true } }, subject: true, _count: { select: { responses: true } } },
    });
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        hidden: !!r.hiddenAt,
        subject: r.subject.name,
        student: r.student,
        responseCount: r._count.responses,
        createdAt: r.createdAt,
      })),
    });
  }),
);

// --- Reviews moderation ----------------------------------------------------

adminRouter.get(
  '/reviews',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        student: { select: { id: true, displayName: true } },
        tutorProfile: { include: { user: { select: { id: true, displayName: true } } } },
      },
    });
    res.json({
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        status: r.status,
        createdAt: r.createdAt,
        student: r.student,
        tutor: { profileId: r.tutorProfileId, displayName: r.tutorProfile.user.displayName },
      })),
    });
  }),
);

adminRouter.post(
  '/reviews/:id/hide',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await hideContent('REVIEW', id);
    await writeAudit({ actorId: req.user!.id, action: 'review.hidden', entityType: 'Review', entityId: id });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/reviews/:id/restore',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const review = await prisma.review.update({ where: { id }, data: { status: 'PUBLISHED' }, select: { tutorProfileId: true } });
    await recomputeTutorRating(review.tutorProfileId);
    await writeAudit({ actorId: req.user!.id, action: 'review.restored', entityType: 'Review', entityId: id });
    res.json({ ok: true });
  }),
);

// --- Reports & moderation --------------------------------------------------

adminRouter.get(
  '/reports',
  validate({ query: z.object({ status: z.enum(['OPEN', 'INVESTIGATING', 'DISMISSED', 'RESOLVED']).optional() }) }),
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const rows = await prisma.report.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { reporter: { select: { id: true, displayName: true } } },
    });
    res.json({ reports: rows });
  }),
);

adminRouter.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({
      where: { id: Number(req.params.id) },
      include: { reporter: { select: { id: true, displayName: true } } },
    });
    if (!report) throw notFound();
    const context = await loadReportContext(report.entityType, report.entityId);
    const notes = await prisma.adminNote.findMany({
      where: { entityType: 'Report', entityId: report.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ report, context, notes });
  }),
);

const resolveSchema = z.object({
  action: z.enum(['investigate', 'dismiss', 'resolve']),
  note: z.string().max(1000).optional(),
  hideContent: z.boolean().optional(),
  suspendUserId: z.number().int().positive().optional(),
});

adminRouter.post(
  '/reports/:id/resolve',
  validate({ body: resolveSchema }),
  asyncHandler(async (req, res) => {
    const report = await prisma.report.findUnique({ where: { id: Number(req.params.id) } });
    if (!report) throw notFound();
    const { action, note, hideContent: doHide, suspendUserId } = req.body as z.infer<typeof resolveSchema>;

    const statusByAction = { investigate: 'INVESTIGATING', dismiss: 'DISMISSED', resolve: 'RESOLVED' } as const;

    if (doHide) await hideContent(report.entityType, report.entityId);
    if (suspendUserId) {
      await prisma.user.update({ where: { id: suspendUserId }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
      await writeAudit({ actorId: req.user!.id, action: 'user.suspended', entityType: 'User', entityId: suspendUserId, metadata: { viaReport: report.id } });
    }

    await prisma.report.update({
      where: { id: report.id },
      data: { status: statusByAction[action], resolutionNote: note, handledById: req.user!.id },
    });
    if (note) {
      await prisma.adminNote.create({ data: { authorId: req.user!.id, entityType: 'Report', entityId: report.id, body: note } });
    }
    await writeAudit({ actorId: req.user!.id, action: `report.${action}`, entityType: 'Report', entityId: report.id, metadata: { hid: !!doHide, suspended: suspendUserId ?? null } });
    res.json({ ok: true });
  }),
);

// --- Internal notes --------------------------------------------------------

adminRouter.post(
  '/notes',
  validate({ body: z.object({ entityType: z.string().max(40), entityId: z.number().int().positive(), body: z.string().min(1).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const note = await prisma.adminNote.create({
      data: { authorId: req.user!.id, entityType: req.body.entityType, entityId: req.body.entityId, body: req.body.body },
    });
    res.status(201).json({ note });
  }),
);

adminRouter.get(
  '/notes',
  validate({ query: z.object({ entityType: z.string(), entityId: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const notes = await prisma.adminNote.findMany({
      where: { entityType: req.query.entityType as string, entityId: Number(req.query.entityId) },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ notes });
  }),
);

// --- Audit log -------------------------------------------------------------

adminRouter.get(
  '/audit',
  asyncHandler(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ logs });
  }),
);

// --- Taxonomy management ---------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

adminRouter.post(
  '/categories',
  validate({
    body: z.object({
      name: z.string().min(2).max(80),
      // Which level vocabulary the category uses. Defaults to the skill ladder
      // rather than the school one: most of this catalogue is not school
      // subjects, and the failure that matters is asking a tradesperson for
      // their NCEA level, not the reverse.
      levelTracks: z.array(z.enum(['ACADEMIC', 'PROFESSIONAL'])).min(1).default(['PROFESSIONAL']),
    }),
  }),
  asyncHandler(async (req, res) => {
    const normalizedName = normalizeName(req.body.name);
    const existing = await prisma.category.findUnique({ where: { normalizedName } });
    if (existing) throw conflict(`"${existing.name}" already exists as a category.`);
    const category = await prisma.category.create({
      data: {
        name: req.body.name,
        normalizedName,
        slug: slugify(req.body.name),
        levelTracks: req.body.levelTracks,
      },
    });
    res.status(201).json({ category });
  }),
);

adminRouter.post(
  '/subjects',
  validate({ body: z.object({ name: z.string().min(2).max(80), categoryId: z.number().int().positive().nullable().optional() }) }),
  asyncHandler(async (req, res) => {
    const normalizedName = normalizeName(req.body.name);
    const existing = await prisma.subject.findUnique({ where: { normalizedName } });
    if (existing) throw conflict(`"${existing.name}" already exists as a subject.`);
    const subject = await prisma.subject.create({
      data: { name: req.body.name, normalizedName, slug: slugify(req.body.name), categoryId: req.body.categoryId ?? null },
    });
    res.status(201).json({ subject });
  }),
);

adminRouter.post(
  '/levels',
  validate({ body: z.object({ name: z.string().min(1).max(80), sortOrder: z.number().int().optional() }) }),
  asyncHandler(async (req, res) => {
    const level = await prisma.teachingLevel.create({ data: { name: req.body.name, slug: slugify(req.body.name), sortOrder: req.body.sortOrder ?? 0 } });
    res.status(201).json({ level });
  }),
);

adminRouter.delete(
  '/subjects/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inUse = await prisma.tutorSubject.count({ where: { subjectId: id } });
    if (inUse > 0) throw badRequest('This subject is in use by tutors and cannot be deleted.');
    await prisma.subject.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// --- Subject suggestion review queue ----------------------------------------
// User-submitted subjects never create a Subject row directly (see
// modules/subjects/subjects.routes.ts) -- they land here for an admin to
// either approve as new, merge into an existing subject, or reject.

adminRouter.get(
  '/subject-suggestions',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
    const suggestions = await prisma.subjectSuggestion.findMany({
      where: status === 'ALL' ? {} : { status: status as never },
      orderBy: { createdAt: 'asc' },
      include: {
        submittedBy: { select: { id: true, displayName: true, email: true } },
        suggestedCategory: { select: { id: true, name: true } },
        resolvedSubject: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, displayName: true } },
      },
    });
    res.json({ suggestions });
  }),
);

async function resolveSuggestion(
  id: number,
  adminId: number,
  update: { status: 'APPROVED' | 'MERGED' | 'REJECTED'; resolvedSubjectId?: number; reviewNote?: string },
) {
  const suggestion = await prisma.subjectSuggestion.findUnique({ where: { id } });
  if (!suggestion) throw notFound('Suggestion not found.');
  if (suggestion.status !== 'PENDING') throw badRequest('This suggestion has already been reviewed.');

  await prisma.subjectSuggestion.update({
    where: { id },
    data: { ...update, reviewedById: adminId, resolvedAt: new Date() },
  });

  const messages: Record<string, string> = {
    APPROVED: `Good news — the subject you suggested, "${suggestion.name}", has been added to SkillSplore.`,
    MERGED: `The subject you suggested, "${suggestion.name}", already existed under a slightly different name. It's ready to use.`,
    REJECTED: `The subject you suggested, "${suggestion.name}", wasn't added${update.reviewNote ? `: ${update.reviewNote}` : '.'}`,
  };
  await notify({
    userId: suggestion.submittedById,
    type: 'subject_suggestion',
    title: 'Your subject suggestion was reviewed',
    body: messages[update.status],
    linkUrl: '/search',
  });
  await writeAudit({ actorId: adminId, action: `subject_suggestion.${update.status.toLowerCase()}`, entityType: 'SubjectSuggestion', entityId: id });
}

adminRouter.post(
  '/subject-suggestions/:id/approve',
  validate({ body: z.object({ categoryId: z.number().int().positive().nullable() }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const suggestion = await prisma.subjectSuggestion.findUnique({ where: { id } });
    if (!suggestion) throw notFound('Suggestion not found.');
    if (suggestion.status !== 'PENDING') throw badRequest('This suggestion has already been reviewed.');

    const existingByName = await prisma.subject.findUnique({ where: { normalizedName: suggestion.normalizedName } });
    if (existingByName) throw conflict(`"${existingByName.name}" already exists — merge this suggestion into it instead of approving.`);

    const subject = await prisma.subject.create({
      data: {
        name: suggestion.name,
        normalizedName: suggestion.normalizedName,
        slug: slugify(suggestion.name),
        categoryId: req.body.categoryId,
      },
    });
    await resolveSuggestion(id, req.user!.id, { status: 'APPROVED', resolvedSubjectId: subject.id });
    res.json({ subject });
  }),
);

adminRouter.post(
  '/subject-suggestions/:id/merge',
  validate({ body: z.object({ subjectId: z.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const subject = await prisma.subject.findUnique({ where: { id: req.body.subjectId } });
    if (!subject) throw notFound('Target subject not found.');
    await resolveSuggestion(id, req.user!.id, { status: 'MERGED', resolvedSubjectId: subject.id });
    res.json({ subject });
  }),
);

adminRouter.post(
  '/subject-suggestions/:id/reject',
  validate({ body: z.object({ reviewNote: z.string().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await resolveSuggestion(id, req.user!.id, { status: 'REJECTED', reviewNote: req.body.reviewNote });
    res.json({ ok: true });
  }),
);

/**
 * Legal documents: inspect every version, and publish one.
 *
 * `publishVersion` existed in legalSync.ts from the start but was reachable
 * only from a shell with DATABASE_URL -- which Render's free tier does not
 * provide. The practical effect was that no policy could ever be published:
 * skillsplore.org served its Privacy Policy and Terms with a permanent
 * "Draft — not yet in force" banner, and with [[EFFECTIVE_DATE]] visible to
 * readers and to crawlers.
 *
 * Exposed to administrators rather than triggered by an env var, unlike the
 * demo cleanup: bringing a policy into force is a considered legal act that
 * should be chosen by a person looking at the text, and it is worth an audit
 * record naming who did it.
 */
adminRouter.get(
  '/legal',
  asyncHandler(async (_req, res) => {
    const docs = await prisma.legalDocument.findMany({
      include: {
        currentVersion: { select: { id: true, version: true } },
        versions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            version: true,
            publishedAt: true,
            effectiveAt: true,
            legalReviewedAt: true,
            legalReviewedBy: true,
            unresolvedPlaceholders: true,
            createdAt: true,
          },
        },
      },
      orderBy: { slug: 'asc' },
    });

    // The public URL lives in the source registry, not on the row.
    const pathBySlug = new Map(LEGAL_DOCUMENTS.map((d) => [d.slug, d.path]));

    res.json({
      documents: docs.map((d) => ({
        id: d.id,
        slug: d.slug,
        title: d.title,
        path: pathBySlug.get(d.slug) ?? null,
        // A row whose slug is no longer in the source registry -- a policy
        // that was retired. Kept in the database because acceptances point at
        // its versions, but it has no public page and must not be offered for
        // publication.
        retired: !pathBySlug.has(d.slug),
        currentVersionId: d.currentVersionId,
        versions: d.versions.map((v) => ({
          ...v,
          isCurrent: v.id === d.currentVersionId,
          // Surfaced so an administrator can see WHY a version refuses to
          // publish, rather than only being told that it did.
          blockedBy: v.unresolvedPlaceholders,
        })),
      })),
    });
  }),
);

adminRouter.post(
  '/legal/versions/:id/publish',
  validate({
    body: z.object({
      // Lets a policy be dated from when notice was actually given, rather
      // than forcing "in force the instant someone clicked publish".
      effectiveAt: z.string().datetime().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const version = await prisma.legalDocumentVersion.findUnique({
      where: { id },
      include: { document: { select: { slug: true, title: true } } },
    });
    if (!version) throw notFound('That document version does not exist.');

    try {
      await publishVersion(prisma, id, {
        effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : undefined,
      });
    } catch (err) {
      if (err instanceof LegalDocumentNotPublishableError) {
        // The placeholder gate is the one thing standing between a
        // fill-in-the-blank draft and a live policy page, so the refusal is
        // reported as a normal validation failure naming what is missing --
        // not as a 500.
        throw badRequest(
          `"${version.document.title}" still has details to fill in, so it cannot be published yet.`,
          { placeholders: err.unresolved },
        );
      }
      throw err;
    }

    await writeAudit({
      actorId: req.user!.id,
      action: 'legal.published',
      entityType: 'LegalDocumentVersion',
      entityId: id,
      metadata: { slug: version.document.slug, version: version.version },
    });

    res.json({ ok: true, slug: version.document.slug, version: version.version });
  }),
);
