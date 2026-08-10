import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../lib/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { sendMail } from '../../lib/mailer.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const feedbackRouter = Router();

const KINDS = ['BUG', 'SUGGESTION', 'COMPLAINT', 'PRAISE', 'QUESTION', 'OTHER'] as const;

const submitSchema = z.object({
  kind: z.enum(KINDS).default('OTHER'),
  message: z.string().trim().min(5).max(4000),
  // Optional even for a signed-out visitor. Someone reporting a broken page
  // should not be forced to identify themselves; without it we simply cannot
  // reply, which the form says.
  email: z.string().email().max(200).optional().or(z.literal('')),
  // Captured by the client so a bug report carries the page it happened on,
  // which is far more reliable than asking the reporter to describe it.
  pageUrl: z.string().max(500).optional(),
});

/**
 * Open to everyone, signed in or not.
 *
 * Rate limiting is the general API limiter rather than the stricter auth one:
 * feedback should be easy to send. Abuse is handled by triage, not by making
 * the form hard to reach.
 */
feedbackRouter.post(
  '/',
  validate({ body: submitSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof submitSchema>;

    const created = await prisma.feedback.create({
      data: {
        userId: req.user?.id ?? null,
        // Prefer the signed-in address; fall back to whatever was typed.
        email: req.user?.email ?? (b.email || null),
        kind: b.kind,
        message: b.message,
        pageUrl: b.pageUrl ?? null,
        userAgent: req.get('user-agent') ?? null,
      },
    });

    // Notify the operator. Without this, feedback landed in the database and
    // waited for someone to think to open /admin/feedback -- which for a
    // one-person company means a bug report can sit unread for weeks. The
    // person who submitted it has no way to tell the difference between "read
    // and ignored" and "never seen".
    //
    // Best-effort on purpose: the submission is already saved, and a mail
    // failure must not turn a successful report into an error for someone
    // trying to help. Delivery is logged either way, and nothing is lost --
    // /admin/feedback remains the source of truth.
    const operators = (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (operators.length > 0) {
      const from = created.email ? `from ${created.email}` : 'from an anonymous visitor';
      void sendMail({
        to: operators.join(','),
        subject: `[SkillSplore] ${b.kind.toLowerCase()} feedback ${from}`,
        text: [
          `Kind:    ${b.kind}`,
          `From:    ${created.email ?? '(not supplied)'}`,
          `Page:    ${created.pageUrl ?? '(not recorded)'}`,
          '',
          b.message,
          '',
          `Manage: ${(env.PUBLIC_SITE_URL || env.WEB_ORIGIN).replace(/\/$/, '')}/admin/feedback`,
        ].join('\n'),
      }).then((result) => {
        if (!result.delivered) {
          logger.error(
            { feedbackId: created.id, error: result.error },
            'feedback saved but the notification email was not delivered',
          );
        }
      });
    }

    res.status(201).json({
      id: created.id,
      message: 'Thanks — this has been recorded and a human will read it.',
    });
  }),
);

// --- Administration -------------------------------------------------------

const listSchema = z.object({
  status: z.enum(['NEW', 'TRIAGED', 'ACTIONED', 'CLOSED']).optional(),
  kind: z.enum(KINDS).optional(),
});

feedbackRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const qp = req.query as unknown as z.infer<typeof listSchema>;
    const rows = await prisma.feedback.findMany({
      where: { status: qp.status, kind: qp.kind },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { user: { select: { id: true, displayName: true } } },
    });

    res.json({
      feedback: rows,
      counts: {
        new: await prisma.feedback.count({ where: { status: 'NEW' } }),
      },
    });
  }),
);

const updateSchema = z.object({
  status: z.enum(['NEW', 'TRIAGED', 'ACTIONED', 'CLOSED']).optional(),
  adminNote: z.string().max(4000).optional(),
});

feedbackRouter.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.feedback.findUnique({ where: { id } });
    if (!existing) throw notFound();

    const b = req.body as z.infer<typeof updateSchema>;
    const closing = b.status === 'ACTIONED' || b.status === 'CLOSED';

    const updated = await prisma.feedback.update({
      where: { id },
      data: {
        status: b.status ?? existing.status,
        adminNote: b.adminNote ?? existing.adminNote,
        handledBy: req.user!.id,
        resolvedAt: closing ? existing.resolvedAt ?? new Date() : existing.resolvedAt,
      },
    });

    await writeAudit({
      actorId: req.user!.id,
      action: 'feedback.updated',
      entityType: 'Feedback',
      entityId: id,
      metadata: { status: updated.status },
    });

    res.json({ feedback: updated });
  }),
);
