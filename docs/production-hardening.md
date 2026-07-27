# Production hardening

Use this checklist before each production release:

1. Put the app behind HTTPS and set `QUICKGLIMPSE_BASE_URL` to the canonical public URL.
2. Terminate TLS at Cloudflare Tunnel or an equivalent reverse proxy and restrict the app to private network ingress. Set `QUICKGLIMPSE_TRUST_PROXY=1` for the single trusted Cloudflare connector hop; do not expose the Node listener directly to the public internet.
3. Verify SMTP-backed OTP, magic-link, password-reset, and email-verification delivery before enabling external users.
4. Store SMTP credentials in a secret manager or injected environment variables, not in source control.
5. Back up the SQLite data directory and monitor `/readyz` from your orchestration platform.
6. Run the server under PM2 with `ecosystem.config.cjs` (in the repository root) or an equivalent process manager.
7. Review route-level authorization before exposing institution or privileged administrative workflows.
8. Verify audit logging, rate limiting, and abuse protection around authentication endpoints.
9. Verify CSP, HSTS, COOP/CORP, Referrer-Policy, Permissions-Policy, API no-store, and request ID headers from the public Cloudflare URL.
10. Revisit privileged aggregate-analytics exposure whenever reporting requirements change.
11. Verify that no Docker deployment path is published or required.
12. Verify the 90-day default retention job, encrypted backup age-out, and restore cleanup process before enabling real feedback collection.
13. Run `npm audit --workspaces --audit-level=high` and record the result with release evidence.
14. Run accessibility checks for homepage, login, staff dashboards, kiosk, and export/error states using `docs/accessibility-testing.md`.

## Cloudflare Tunnel assumptions

- Cloudflare terminates public TLS and forwards to the private Node process.
- The origin process sets security headers itself; Cloudflare rules may strengthen them but must not weaken CSP, HSTS, no-store, or frame protections.
- `QUICKGLIMPSE_BASE_URL` must be the canonical `https://` URL users visit.
- `QUICKGLIMPSE_TRUST_PROXY=1` is required so Express resolves client IPs from the trusted Cloudflare connector hop for rate limiting and audit context.
- The host firewall should permit origin traffic only from the connector or local reverse proxy.
- Cloudflare Access may protect staff-only hostnames, but it is not a replacement for Qglimpse role checks.

## Release evidence

Record the following for each production deployment:

- Git commit and build artifact identifier.
- Public URL and Cloudflare Tunnel identifier.
- Environment validation result from startup.
- `/readyz` response timestamp.
- Dependency audit command and result.
- Accessibility test date and scope.
- Backup restore test date, source backup set, and retention cleanup result.
- Security test result covering auth, institution isolation, kiosk token misuse, QR reuse fail-closed behavior, export scope, and retention cleanup.

## Security validation and penetration-test checklist

- Verify unauthenticated requests are denied for all sensitive routes:
  - `/api/settings/smtp` (GET/PUT)
  - `/api/institutions/:id/kiosk-mode`
- Verify role boundaries:
  - institution admins cannot access privileged admin-only routes
  - institution admins can only mutate kiosk state for their own institution
- Replay/abuse checks:
  - exercise auth and challenge rate limits (`429` paths)
  - verify suspended/deactivated users cannot create valid sessions
- Input edge-case checks:
  - invalid IDs (`/api/institutions/abc/...`, `/api/auth/users/0/status`)
  - malformed payloads (missing required fields, wrong enums, empty tokens)
- Session checks:
  - session invalidation on logout
  - session invalidation after account suspension/deactivation
- Data lifecycle checks:
  - raw feedback, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs expire after 90 days by default
  - backups are encrypted and age out raw feedback on the same default schedule
  - restored data is cleaned up for expired rows before users can access it
