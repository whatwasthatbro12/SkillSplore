# Subprocessor register

**Status: draft. Reflects the repository as of 2026-08-04.**

A subprocessor is a third party that processes personal information on
SkillSplore's behalf. This register is the source of truth; the public
`/subprocessors` page is a summary of it.

**Rule: nothing is listed here speculatively.** If a provider has not been
selected, the row says so. A register naming a provider we do not use is a
misrepresentation, and one omitting a provider we do use is a compliance
failure.

## In use

| Provider | Service | Data categories | Country | Contract | Security review | Retention |
|---|---|---|---|---|---|---|
| Render | Application hosting + managed PostgreSQL | All application data | United States (Oregon) — confirmed in the service dashboard | Standard terms accepted at signup — **not separately reviewed** | Not done | Data deleted on service teardown; backup retention per Render's policy — **to confirm** |
| Resend | Transactional email — verification, password reset, notifications, feedback alerts | Recipient address and the content of the message | United States (N. Virginia, us-east-1) — shown on the domain page | Standard terms accepted at signup — **not separately reviewed** | Not done | Message content and delivery logs retained per Resend's policy — **to confirm** |
| Cloudflare | Authoritative DNS for skillsplore.org | DNS queries only. Records are DNS-only rather than proxied, so Cloudflare does not terminate TLS and does not see request contents | Global anycast | Standard terms accepted at signup — **not separately reviewed** | Not done | No application data held |
| Google Workspace | The admin@skillsplore.org mailbox — support, privacy and security correspondence | Whatever a person chooses to send us by email | United States | Standard terms accepted at signup — **not separately reviewed** | Not done | Mailbox retention under our own control |

That is the complete list. One provider.

> **Changed 11 August 2026.** Resend was brought into service for transactional
> email, and Cloudflare and Google Workspace were added to the register — they
> were already in use but had never been listed. The Privacy Policy states that
> no provider appears here unless it is actually in use; the reverse obligation
> is the one that was being missed.
>
> Nothing here has had a security review. That is recorded honestly rather than
> left blank, because an unreviewed provider that looks reviewed is worse than
> one plainly marked as not.

## Not yet configured

| Provider | Service | Status |
|---|---|---|
| *(none selected)* | Object storage for uploads | `STORAGE_DRIVER=local` writes to the container filesystem. On Render's free tier this is **not persistent** — uploads are lost on redeploy. See `KNOWN_LIMITATIONS.md`. S3-compatible storage is supported in code but not configured. |

Both need resolving before launch, and both add a subprocessor row when chosen.

## Explicitly not used

Confirmed by inspection of the repository on 2026-08-04:

- **No third-party analytics.** No Google Analytics, Plausible, PostHog,
  Segment, Mixpanel or similar. `grep` for tracking snippets across
  `apps/web/src` and `apps/web/index.html` returns nothing.
- **No advertising or ad-tech vendor.**
- **No data broker or enrichment provider.**
- **No payment processor** — SkillSplore does not process payments.
- **No identity or background-check provider.**
- **No AI/ML provider receiving user content.**
- **No error-tracking SaaS** (no Sentry or equivalent).

If any of these changes, this register and the Cookie Notice must be updated
**before** the integration ships, not after.

## Overseas transfer position

See `OVERSEAS_DATA_TRANSFERS.md`.

## Maintaining this register

The `Subprocessor` table mirrors this document. Fields: name, service, country,
purpose, data categories, contract status, security review date, retention
terms, active flag.

Review triggers:
- adding or removing any third-party integration;
- a provider changing its subprocessors or data location;
- annually, whichever comes first.
