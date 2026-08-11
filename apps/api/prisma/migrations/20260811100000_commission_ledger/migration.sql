-- Commission on introductions that became lessons.
--
-- A ledger only. Nothing here moves money, and no charging exists yet. Rows
-- accumulate so that when a payment processor is connected there is an accurate
-- history to invoice from, and so a tutor can watch it accrue rather than
-- meeting it as a surprise.

CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'INVOICED', 'PAID', 'WAIVED');

CREATE TABLE "Commission" (
    "id" SERIAL NOT NULL,
    "engagementId" INTEGER NOT NULL,
    "tutorProfileId" INTEGER NOT NULL,
    "basisCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "rateBps" INTEGER NOT NULL,
    "flatCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- One commission per engagement. This is the constraint that makes accrual
-- safe to call more than once: completing an already-completed engagement, a
-- retried request, or two clicks on the same button cannot double-charge.
CREATE UNIQUE INDEX "Commission_engagementId_key" ON "Commission"("engagementId");

CREATE INDEX "Commission_tutorProfileId_status_idx" ON "Commission"("tutorProfileId", "status");
CREATE INDEX "Commission_status_idx" ON "Commission"("status");

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_engagementId_fkey"
    FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_tutorProfileId_fkey"
    FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
