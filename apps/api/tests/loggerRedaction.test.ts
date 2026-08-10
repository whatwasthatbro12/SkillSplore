/**
 * Session tokens must never reach the log stream.
 *
 * Found in the live Render logs: every response that touched the session was
 * writing a complete, unexpired `skillsplore.sid` cookie into
 * res.headers["set-cookie"]. The redact list covered req.headers.cookie, which
 * made it look handled -- but the response side leaks the same session id, and
 * anyone able to read the logs could paste one into a browser and be signed in
 * as that user without a password.
 *
 * These assert against a real pino instance rather than the exported logger,
 * so they check the redaction CONFIGURATION rather than whatever level or
 * transport the environment happens to select.
 *
 * The reason this needs a test at all: a redact path that matches nothing
 * produces exactly the same clean-looking config as one that works. The only
 * way to tell them apart is to log a token and check it is gone -- which is
 * what these do, rather than asserting on the shape of the path strings.
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';

const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
];

/** Logs one object through pino and returns what was actually written. */
function capture(obj: Record<string, unknown>): string {
  let output = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      output += chunk.toString();
      cb();
    },
  });
  const log = pino({ redact: { paths: REDACT_PATHS, remove: true } }, sink);
  log.info(obj);
  return output;
}

const SESSION_COOKIE =
  'skillsplore.sid=s%3AgFaKtNWXkTPp0GBJOtlNLGbFLDyC6mAu.PVbc0aoT22fwY3ol8NhAMuUHKLb; '
  + 'Path=/; HttpOnly; Secure; SameSite=Lax';

describe('logger redaction', () => {
  it('strips the session cookie from response headers', () => {
    const output = capture({
      res: { statusCode: 200, headers: { 'content-type': 'application/json', 'set-cookie': [SESSION_COOKIE] } },
    });
    expect(output).not.toContain('skillsplore.sid');
    expect(output).not.toContain('set-cookie');
    // Non-sensitive headers must survive -- redaction that removes everything
    // is not a fix, it just moves the problem to debuggability.
    expect(output).toContain('content-type');
  });

  it('strips the request cookie header', () => {
    const output = capture({ req: { headers: { cookie: SESSION_COOKIE, host: 'skillsplore.org' } } });
    expect(output).not.toContain('skillsplore.sid');
    expect(output).toContain('skillsplore.org');
  });

  it('strips authorization headers', () => {
    const output = capture({ req: { headers: { authorization: 'Bearer secret-value-here' } } });
    expect(output).not.toContain('secret-value-here');
  });

  it('strips passwords and tokens wherever they appear', () => {
    const output = capture({
      body: { email: 'someone@example.com', password: 'hunter2' },
      user: { passwordHash: '$2b$10$abcdefg' },
      reset: { token: 'verification-token-value' },
    });
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('$2b$10$abcdefg');
    expect(output).not.toContain('verification-token-value');
    expect(output).toContain('someone@example.com');
  });

  it('matches the paths the real logger is configured with', async () => {
    // Guards against this test drifting from logger.ts and quietly passing
    // while production leaks again.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/lib/logger.ts', import.meta.url), 'utf8'),
    );
    for (const path of REDACT_PATHS) {
      expect(source, `logger.ts should redact ${path}`).toContain(path);
    }
  });
});
