import { Router } from 'express';
import { env } from './config/env.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { tutorsRouter } from './modules/tutors/tutors.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { requestsRouter } from './modules/requests/requests.routes.js';
import { responsesRouter } from './modules/responses/responses.routes.js';
import { conversationsRouter } from './modules/conversations/conversations.routes.js';
import { engagementsRouter } from './modules/engagements/engagements.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { taxonomyRouter } from './modules/taxonomy/taxonomy.routes.js';
import { subjectsRouter } from './modules/subjects/subjects.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { filesRouter } from './modules/files/files.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { feedbackRouter } from './modules/feedback/feedback.routes.js';
import { legalRouter } from './modules/legal/legal.routes.js';
import { consentRouter } from './modules/legal/consent.routes.js';
import { privacyRequestsRouter } from './modules/legal/privacyRequests.routes.js';
import { prisma } from './lib/prisma.js';

export const apiRouter = Router();

// Public runtime config the web client reads on boot. Never leaks secrets.
apiRouter.get('/config', (_req, res) => {
  res.json({
    appEnv: env.APP_ENV,
    showDemoBanner: env.showDemoBanner,
    demoLoginEnabled: env.demoLoginEnabled,
    demoBannerText: 'Demonstration environment — data may be reset.',
    // Lets the interface ask a tutor what they were paid only when that
    // number is actually used. Asking when commission is off would be
    // collecting income data for no stated purpose.
    commission: {
      enabled: env.COMMISSION_ENABLED,
      ratePercent: env.COMMISSION_RATE_BPS / 100,
      flatCents: env.COMMISSION_FLAT_CENTS,
      freeEngagements: env.COMMISSION_FREE_ENGAGEMENTS,
    },
  });
});

apiRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', appEnv: env.APP_ENV });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/tutors', tutorsRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/requests', requestsRouter);
apiRouter.use('/responses', responsesRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/engagements', engagementsRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/taxonomy', taxonomyRouter);
apiRouter.use('/subjects', subjectsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/files', filesRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/feedback', feedbackRouter);
apiRouter.use('/legal', legalRouter);
apiRouter.use('/consents', consentRouter);
apiRouter.use('/privacy-requests', privacyRequestsRouter);
