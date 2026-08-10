// Container entrypoint for hosts that don't support a separate pre-deploy
// step (e.g. Render's free tier). Applies pending migrations on every boot
// (idempotent, safe), seeds demo data only if the database is empty (so a
// cold-start restart on a free/sleeping tier doesn't wipe real activity),
// then starts the server in this same process.
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

function run(cmd, args) {
  // Only needed on Windows, where `npx` is a .cmd shim and can't be spawned
  // directly -- Linux (where this actually runs in production) never hits
  // this branch. Args here are always fixed constants, never external input.
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`[bootstrap] command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

/** Runs a step whose failure must not take the site down. */
function runAllowFailure(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`[bootstrap] step declined or failed (continuing): ${cmd} ${args.join(' ')}`);
  }
}

console.log('[bootstrap] applying database migrations...');
run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);

const appEnv = process.env.APP_ENV ?? 'development';
if (appEnv !== 'production') {
  const prisma = new PrismaClient();
  const userCount = await prisma.user.count();
  await prisma.$disconnect();
  if (userCount === 0) {
    console.log('[bootstrap] database is empty, running demo seed...');
    run('npx', ['tsx', 'apps/api/prisma/seed.ts']);
  } else {
    console.log(`[bootstrap] database already has ${userCount} user(s), skipping demo seed.`);
  }
}

// Always sync the catalogue, in every environment. The demo seed above only
// runs on an empty database, so without this a deployment that already has
// users can never pick up newly-added categories or subjects -- which is
// exactly how production drifted behind the code. Additive only: it inserts
// what's missing and never deletes or moves anything (see syncTaxonomy.ts).
console.log('[bootstrap] syncing subject catalogue...');
run('npx', ['tsx', 'apps/api/prisma/syncTaxonomy.ts']);

// Same reasoning for the policy documents and consent wording. Drafts land
// unpublished; nothing here promotes text to a live policy on its own.
console.log('[bootstrap] syncing legal documents and consent wording...');
run('npx', ['tsx', 'apps/api/prisma/syncLegal.ts']);

// Grants ADMIN to the addresses in ADMIN_EMAILS. Runs on every boot because
// the account usually does not exist yet on the first deploy -- the operator
// sets the variable, registers, and the next restart picks it up. Additive
// only: it never creates an account, never revokes, and never fails the boot.
console.log('[bootstrap] syncing administrators...');
run('npx', ['tsx', 'apps/api/prisma/syncAdmins.ts']);

// One-shot demo cleanup, for hosts with no shell to run the script from.
//
// Deletes only accounts on @demo.skillsplore.local -- an unroutable domain no
// real person can hold -- so this cannot reach a genuine account no matter how
// the flag is set. Idempotent: once the demo accounts are gone it finds
// nothing and does nothing, so leaving the variable set is harmless.
//
// The script refuses to run while every administrator is a demo account, which
// is what stops this deleting the only way into /admin. That refusal must not
// take the site down, hence runAllowFailure.
if (/^(1|true|yes)$/i.test(process.env.REMOVE_DEMO_DATA ?? '')) {
  console.log('[bootstrap] REMOVE_DEMO_DATA is set — removing demo accounts...');
  runAllowFailure('npx', ['tsx', 'apps/api/prisma/removeDemoData.ts', '--commit']);
}

console.log('[bootstrap] starting server...');
await import('../dist/index.js');
