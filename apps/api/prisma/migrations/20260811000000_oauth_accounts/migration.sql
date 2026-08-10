-- Sign in with an existing account (Google today, others later).

CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE');

-- An account created through a provider has no password here at all. Storing a
-- random or empty hash instead would make "does this person have a password?"
-- unanswerable, and the login route needs to answer it to say something useful
-- rather than "wrong password" to someone who never set one.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE TABLE "OAuthAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- The provider's subject id is the identity, not the email address. A Google
-- account's address can change; its `sub` cannot. Matching on the address
-- instead is the classic route to linking a stranger into someone's account.
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key"
    ON "OAuthAccount"("provider", "providerAccountId");

CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
