import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../lib/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { publicUser } from '../../lib/serializers.js';
import { notify } from '../../lib/notify.js';
import { accrueCommission } from '../../lib/payments/commission.js';

export const engagementsRouter = Router();

const createSchema = z.object({
  conversationId: z.number().int().positive(),
  title: z.string().min(3).max(160),
  subjectId: z.number().int().positive().nullable().optional(),
  note: z.string().max(1000).optional(),
});

const engagementInclude = {
  subject: true,
  tutorProfile: { include: { user: { select: { id: true, displayName: true, avatarKey: true } } } },
  student: { select: { id: true, displayName: true, avatarKey: true } },
  review: { select: { id: true } },
} as const;

type EngagementRow = import('@prisma/client').Prisma.EngagementGetPayload<{ include: typeof engagementInclude }>;

function serialize(e: EngagementRow, viewerId: number) {
  const iAmStudent = e.studentId === viewerId;
  const iAmTutor = e.tutorProfile.userId === viewerId;
  return {
    id: e.id,
    title: e.title,
    note: e.note,
    status: e.status,
    createdAt: e.createdAt,
    completedAt: e.completedAt,
    cancelledAt: e.cancelledAt,
    conversationId: e.conversationId,
    requestId: e.requestId,
    subject: e.subject ? { id: e.subject.id, name: e.subject.name } : null,
    tutor: { profileId: e.tutorProfileId, ...publicUser(e.tutorProfile.user) },
    student: publicUser(e.student),
    role: iAmStudent ? 'student' : iAmTutor ? 'tutor' : 'observer',
    hasReview: !!e.review,
    // Reviews may be written by the student for a completed engagement only.
    canReview: iAmStudent && e.status === 'COMPLETED' && !e.review,
    // Payment is arranged directly between student and tutor, outside SkillSplore.
    paymentNote: 'Payment is arranged directly between you and the tutor. SkillSplore does not process or protect payments.',
  };
}

engagementsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await prisma.engagement.findMany({
      where: { OR: [{ studentId: req.user!.id }, { tutorProfile: { userId: req.user!.id } }] },
      orderBy: { createdAt: 'desc' },
      include: engagementInclude,
    });
    res.json({ engagements: rows.map((e) => serialize(e, req.user!.id)) });
  }),
);

engagementsRouter.post(
  '/',
  requireAuth,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.body.conversationId },
      include: { participants: true },
    });
    if (!conversation || !conversation.tutorProfileId) throw badRequest('Invalid conversation.');
    const iAmParticipant = conversation.participants.some((p) => p.userId === req.user!.id);
    if (!iAmParticipant) throw forbidden();

    const tutorProfile = await prisma.tutorProfile.findUnique({
      where: { id: conversation.tutorProfileId },
      select: { id: true, userId: true },
    });
    if (!tutorProfile) throw badRequest('Invalid conversation.');
    const studentParticipant = conversation.participants.find((p) => p.userId !== tutorProfile.userId);
    if (!studentParticipant) throw badRequest('Invalid conversation.');

    const engagement = await prisma.engagement.create({
      data: {
        studentId: studentParticipant.userId,
        tutorProfileId: tutorProfile.id,
        subjectId: req.body.subjectId ?? null,
        conversationId: conversation.id,
        title: req.body.title,
        note: req.body.note,
        status: 'ARRANGED',
      },
      include: engagementInclude,
    });

    const otherId = req.user!.id === studentParticipant.userId ? tutorProfile.userId : studentParticipant.userId;
    await notify({ userId: otherId, type: 'engagement', title: 'A tutoring arrangement was recorded', body: engagement.title });
    res.status(201).json({ engagement: serialize(engagement, req.user!.id) });
  }),
);

async function myEngagement(userId: number, id: number) {
  const e = await prisma.engagement.findUnique({ where: { id }, include: engagementInclude });
  if (!e) throw notFound();
  const involved = e.studentId === userId || e.tutorProfile.userId === userId;
  if (!involved) throw forbidden();
  return e;
}

engagementsRouter.post(
  '/:id/complete',
  requireAuth,
  validate({
    body: z.object({
      // What the tutor was actually paid, if they choose to say. Optional
      // because SkillSplore cannot verify it and should not present an
      // unverifiable number as fact. Commission still works without it -- the
      // flat component covers that case.
      paidCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const e = await myEngagement(req.user!.id, Number(req.params.id));
    if (e.status === 'CANCELLED') throw badRequest('A cancelled engagement cannot be completed.');

    const updated = await prisma.engagement.update({
      where: { id: e.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: engagementInclude,
    });

    // Deliberately after the status change and outside its transaction. If the
    // ledger write fails, the lesson is still completed and the learner can
    // still leave a review; billing is our problem, not theirs. accrueCommission
    // swallows its own failures and logs them for the same reason.
    await accrueCommission(prisma, updated, { basisCents: req.body?.paidCents ?? null });

    res.json({ engagement: serialize(updated, req.user!.id) });
  }),
);

engagementsRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const e = await myEngagement(req.user!.id, Number(req.params.id));
    if (e.status === 'COMPLETED') throw badRequest('A completed engagement cannot be cancelled.');
    const updated = await prisma.engagement.update({
      where: { id: e.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: engagementInclude,
    });
    res.json({ engagement: serialize(updated, req.user!.id) });
  }),
);
