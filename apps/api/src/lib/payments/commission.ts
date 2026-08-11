/**
 * Commission on an introduction that became a lesson.
 *
 * The revenue model is: SkillSplore earns only when a tutor earns. That is
 * easy to say and awkward to implement, because lesson payments are arranged
 * directly between two people and never touch this platform. There is no
 * transaction to observe.
 *
 * What can be observed is that an introduction made here turned into a lesson
 * both parties agree happened -- an Engagement reaching COMPLETED. That is a
 * proxy, and it is worth being clear about how it is imperfect:
 *
 *   - A tutor who never marks an engagement complete accrues nothing. That is
 *     a real avoidance route and it is left open deliberately. Completion also
 *     unlocks the learner's review, so suppressing it costs the tutor the
 *     thing that actually wins them future work. Making it adversarial would
 *     be worse than accepting some leakage.
 *
 *   - The declared lesson value is exactly that: declared. A platform that
 *     cannot verify a number should not present it as authoritative, so
 *     `basisCents` is optional and the flat component exists so the model
 *     works without it.
 *
 * Nothing here charges anybody. It writes ledger rows. Collection needs a
 * payment processor that does not exist yet, and inventing an amount owed
 * before that is the cheap half of the problem.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';

export interface CommissionQuote {
  rateBps: number;
  flatCents: number;
  basisCents: number | null;
  amountCents: number;
}

/**
 * What an engagement would accrue, given a declared value.
 *
 * Pure and exported so the tutor-facing screen can show the same number the
 * ledger will record, rather than a second implementation that drifts.
 */
export function quoteCommission(basisCents: number | null): CommissionQuote {
  const rateBps = env.COMMISSION_RATE_BPS;
  const flatCents = env.COMMISSION_FLAT_CENTS;

  // Percentage only applies to a value the tutor actually declared. Guessing
  // one from their hourly rate would invent a number and then bill on it.
  const variable = basisCents === null ? 0 : Math.round((basisCents * rateBps) / 10_000);

  return { rateBps, flatCents, basisCents, amountCents: flatCents + variable };
}

export interface AccrualResult {
  status: 'accrued' | 'waived' | 'skipped';
  amountCents: number;
  reason?: string;
}

/**
 * Records what an engagement owes, once.
 *
 * Safe to call repeatedly: the unique constraint on `engagementId` means a
 * retried request, a double-clicked button, or completing an already-completed
 * engagement cannot accrue twice. The catch below treats that collision as
 * success rather than an error, because it means the ledger already says what
 * this function was about to say.
 */
export async function accrueCommission(
  db: PrismaClient | Prisma.TransactionClient,
  engagement: { id: number; tutorProfileId: number },
  opts: { basisCents?: number | null; currency?: string } = {},
): Promise<AccrualResult> {
  if (!env.COMMISSION_ENABLED) return { status: 'skipped', amountCents: 0, reason: 'disabled' };

  const existing = await db.commission.findUnique({ where: { engagementId: engagement.id } });
  if (existing) {
    return { status: 'skipped', amountCents: existing.amountCents, reason: 'already-accrued' };
  }

  // The free allowance counts every commission row for this tutor, waived ones
  // included. Counting only chargeable rows would hand a tutor a fresh
  // allowance every time one was written off.
  const priorCount = await db.commission.count({
    where: { tutorProfileId: engagement.tutorProfileId },
  });
  const withinFreeAllowance = priorCount < env.COMMISSION_FREE_ENGAGEMENTS;

  const quote = quoteCommission(opts.basisCents ?? null);

  // A waived row is still written. It records that the introduction converted,
  // which is the number that matters for knowing whether the model works at
  // all -- and it is what makes the free allowance countable.
  const waivedReason = withinFreeAllowance
    ? `Within the first ${env.COMMISSION_FREE_ENGAGEMENTS} completed engagements for this tutor.`
    : null;

  try {
    const row = await db.commission.create({
      data: {
        engagementId: engagement.id,
        tutorProfileId: engagement.tutorProfileId,
        basisCents: quote.basisCents,
        currency: opts.currency ?? 'NZD',
        // Copied, not referenced. Changing the rate later must not silently
        // restate what a tutor already owes.
        rateBps: quote.rateBps,
        flatCents: quote.flatCents,
        amountCents: withinFreeAllowance ? 0 : quote.amountCents,
        status: withinFreeAllowance ? 'WAIVED' : 'PENDING',
        waivedReason,
      },
    });
    return {
      status: withinFreeAllowance ? 'waived' : 'accrued',
      amountCents: row.amountCents,
      reason: waivedReason ?? undefined,
    };
  } catch (err) {
    // Unique violation: something else accrued this engagement between the
    // check above and here. The ledger is already correct.
    if ((err as { code?: string }).code === 'P2002') {
      return { status: 'skipped', amountCents: 0, reason: 'already-accrued' };
    }
    // Never let a billing-ledger problem block a tutor from marking a lesson
    // complete. Completion is what the learner needs in order to leave a
    // review; revenue is our problem, not theirs.
    logger.error({ err, engagementId: engagement.id }, 'commission accrual failed');
    return { status: 'skipped', amountCents: 0, reason: 'error' };
  }
}
