import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isProduction ? 'info' : 'debug',
  transport: env.isProduction
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    // `set-cookie` is the one that actually mattered. Redacting only the
    // REQUEST cookie header looked complete but was not: every response that
    // touches the session writes the same session id back out in
    // res.headers["set-cookie"], so a live, unexpired `skillsplore.sid` was
    // being written to the hosting provider's log stream on essentially every
    // request. Anyone who can read those logs -- or any future log export,
    // drain or third-party aggregator -- could paste one into a browser and be
    // signed in as that user, no password involved.
    //
    // Bracket notation is pino's documented form for hyphenated keys. The
    // dotted form happens to work too, but the brackets say plainly that
    // `set-cookie` is one key rather than a nested path. There is a test
    // asserting the token is actually gone from the output, because a redact
    // path that matches nothing looks identical to one that works until you
    // read production logs.
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    remove: true,
  },
});
