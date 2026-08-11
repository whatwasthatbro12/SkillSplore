/**
 * Commission accrual.
 *
 * This is the money path, and the failures that matter are quiet ones: a
 * double charge from a retried request, a free allowance that renews itself,
 * or a rate change that silently restates what someone already owes. Each has
 * a test named for it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma, resetDb } from './helpers.js';
import { accrueCommission, quoteCommission } from '../src/lib/payments/commission.js';
import { env } from '../src/config/env.js';

type Mutable = {
  COMMISSION_ENABLED: boolean;
  COMMISSION_RATE_BPS: number;
  COMMISSION_FLAT_CENTS: number;
  COMMISSION_FREE_ENGAGEMENTS: number;
};
const cfg = env as unknown as Mutable;
const original = {
  COMMISSION_ENABLED: cfg.COMMISSION_ENABLED,
  COMMISSION_RATE_BPS: cfg.COMMISSION_RATE_BPS,
  COMMISSION_FLAT_CENTS: cfg.COMMISSION_FLAT_CENTS,
  COMMISSION_FREE_ENGAGEMENTS: cfg.COMMISSION_FREE_ENGAGEMENTS,
};

async function makeEngagement() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const tutorUser = await prisma.user.create({
    data: { email: `tutor.${stamp}@test.local`, passwordHash: 'x', displayName: 'Tutor' },
  });
  const student = await prisma.user.create({
    data: { email: `student.${stamp}@test.local`, passwordHash: 'x', displayName: 'Student' },
  });
  const profile = await prisma.tutorProfile.create({
    data: { userId: tutorUser.id, status: 'APPROVED', deliveryMode: 'ONLINE' },
  });
  return prisma.engagement.create({
    data: { studentId: student.id, tutorProfileId: profile.id, title: 'A lesson' },
  });
}

describe('commission accrual', () => {
  beforeEach(async () => {
    await resetDb();
    cfg.COMMISSION_ENABLED = true;
    cfg.COMMISSION_RATE_BPS = 500; // 5%
    cfg.COMMISSION_FLAT_CENTS = 100; // $1.00
    cfg.COMMISSION_FREE_ENGAGEMENTS = 0;
  });
  afterEach(() => {
    Object.assign(cfg, original);
  });

  it('accrues flat plus a percentage of the declared value', async () => {
    const e = await makeEngagement();
    const result = await accrueCommission(prisma, e, { basisCents: 10_000 }); // $100
    // $1.00 flat + 5% of $100 = $6.00
    expect(result.status).toBe('accrued');
    expect(result.amountCents).toBe(600);
  });

  it('charges only the flat amount when nothing is declared', async () => {
    // Declaring is optional, so the model has to work without it rather than
    // guessing a value from the tutor's hourly rate and billing on the guess.
    const e = await makeEngagement();
    const result = await accrueCommission(prisma, e, { basisCents: null });
    expect(result.amountCents).toBe(100);
    const row = await prisma.commission.findUniqueOrThrow({ where: { engagementId: e.id } });
    expect(row.basisCents).toBeNull();
  });

  it('NEVER accrues twice for the same engagement', async () => {
    // The failure this prevents is a double charge from a retried request or a
    // double-clicked button.
    const e = await makeEngagement();
    const first = await accrueCommission(prisma, e, { basisCents: 10_000 });
    const second = await accrueCommission(prisma, e, { basisCents: 10_000 });
    expect(first.status).toBe('accrued');
    expect(second.status).toBe('skipped');
    expect(second.reason).toBe('already-accrued');
    expect(await prisma.commission.count({ where: { engagementId: e.id } })).toBe(1);
  });

  it('waives inside the free allowance, and charges after it', async () => {
    cfg.COMMISSION_FREE_ENGAGEMENTS = 2;
    const e1 = await makeEngagement();
    const profileId = e1.tutorProfileId;
    const mk = async () => prisma.engagement.create({
      data: { studentId: e1.studentId, tutorProfileId: profileId, title: 'Another' },
    });

    expect((await accrueCommission(prisma, e1, { basisCents: 10_000 })).status).toBe('waived');
    expect((await accrueCommission(prisma, await mk(), { basisCents: 10_000 })).status).toBe('waived');

    const third = await accrueCommission(prisma, await mk(), { basisCents: 10_000 });
    expect(third.status).toBe('accrued');
    expect(third.amountCents).toBe(600);
  });

  it('counts waived rows toward the allowance, so it cannot renew itself', async () => {
    // If the allowance counted only chargeable rows, writing one off would
    // silently hand the tutor a fresh free run.
    cfg.COMMISSION_FREE_ENGAGEMENTS = 1;
    const e1 = await makeEngagement();
    await accrueCommission(prisma, e1, { basisCents: 10_000 });

    const e2 = await prisma.engagement.create({
      data: { studentId: e1.studentId, tutorProfileId: e1.tutorProfileId, title: 'Second' },
    });
    expect((await accrueCommission(prisma, e2, { basisCents: 10_000 })).status).toBe('accrued');
  });

  it('records a waived row rather than nothing', async () => {
    // The row is the evidence that an introduction converted, which is the
    // number that says whether the model works at all.
    cfg.COMMISSION_FREE_ENGAGEMENTS = 5;
    const e = await makeEngagement();
    await accrueCommission(prisma, e, { basisCents: 10_000 });
    const row = await prisma.commission.findUniqueOrThrow({ where: { engagementId: e.id } });
    expect(row.status).toBe('WAIVED');
    expect(row.amountCents).toBe(0);
    expect(row.waivedReason).toContain('first 5');
  });

  it('freezes the rate in force at accrual', async () => {
    // Raising the price later must not restate what a tutor already owes.
    const e = await makeEngagement();
    await accrueCommission(prisma, e, { basisCents: 10_000 });
    cfg.COMMISSION_RATE_BPS = 9_000;
    const row = await prisma.commission.findUniqueOrThrow({ where: { engagementId: e.id } });
    expect(row.rateBps).toBe(500);
    expect(row.amountCents).toBe(600);
  });

  it('does nothing at all while commission is disabled', async () => {
    cfg.COMMISSION_ENABLED = false;
    const e = await makeEngagement();
    const result = await accrueCommission(prisma, e, { basisCents: 10_000 });
    expect(result.status).toBe('skipped');
    expect(await prisma.commission.count()).toBe(0);
  });

  it('quotes the same number the ledger will record', async () => {
    // The tutor-facing screen uses quoteCommission. If it drifted from what is
    // actually written, someone would be shown one figure and billed another.
    const quote = quoteCommission(10_000);
    const e = await makeEngagement();
    const result = await accrueCommission(prisma, e, { basisCents: 10_000 });
    expect(result.amountCents).toBe(quote.amountCents);
  });

  it('rounds a fractional cent rather than storing a fraction', async () => {
    cfg.COMMISSION_FLAT_CENTS = 0;
    cfg.COMMISSION_RATE_BPS = 333; // 3.33%
    const e = await makeEngagement();
    // 3.33% of $10.01 = 33.3333 cents
    const result = await accrueCommission(prisma, e, { basisCents: 1001 });
    expect(Number.isInteger(result.amountCents)).toBe(true);
    expect(result.amountCents).toBe(33);
  });
});
