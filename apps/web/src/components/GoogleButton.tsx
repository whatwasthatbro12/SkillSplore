import { useApi } from '../lib/useApi.js';

/**
 * Starts the Google sign-in redirect.
 *
 * A real link to the API rather than a fetch: the flow leaves this origin
 * entirely, so it must be a browser navigation. Using a button with
 * `window.location` would work but takes the middle-click, open-in-new-tab and
 * status-bar-preview behaviour away for no gain.
 *
 * Renders nothing at all when Google is not configured. A button that
 * dead-ends is worse than no button, and this deployment may run without
 * credentials set.
 */
export function GoogleButton({ label }: { label: string }) {
  const { data } = useApi<{ google: boolean }>('/auth/providers');
  if (!data?.google) return null;

  return (
    <>
      <a className="btn btn-outline btn-block" href="/api/auth/google" style={{ gap: 10 }}>
        {/* Google's mark, inline so it survives the artifact CSP and needs no
            network request. aria-hidden because the label already says it. */}
        <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
          <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.9-12.3-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.7 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.2 2 20.5 2 24s.8 6.8 2.3 9.8l7.4-5.7z" />
          <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.4 5.7c1.7-5.2 6.6-9.1 12.3-9.1z" />
        </svg>
        {label}
      </a>
      <div className="row" style={{ gap: 12, margin: '14px 0 2px' }}>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span className="muted" style={{ fontSize: '0.8rem' }}>or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
    </>
  );
}

/** Maps the `?error=` value the callback redirects with to something readable. */
export const OAUTH_ERRORS: Record<string, string> = {
  'google-not-configured': 'Google sign-in is not available on this site yet.',
  'google-cancelled': 'Google sign-in was cancelled.',
  'google-state-mismatch': 'That sign-in link expired. Please try again.',
  'google-failed':
    'Google sign-in did not complete. If you already have an account with this address, '
    + 'sign in with your password instead.',
};
