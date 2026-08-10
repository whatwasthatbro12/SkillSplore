import 'express-session';
import type { User } from '@prisma/client';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    // One-time CSRF value for an in-flight Google sign-in. Held in the session
    // rather than a cookie so it cannot be read or set by page scripts.
    oauthState?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
