# Production hardening

Use this scaffold as a starting point, then complete the following before release:

1. Put the app behind HTTPS and set `QUICKGLIMPSE_BASE_URL` to the canonical public URL.
2. Terminate TLS at a reverse proxy and restrict the app to private network ingress where possible.
3. Replace the login preview flow with real email delivery and verification before enabling external users.
4. Store SMTP credentials in a secret manager or injected environment variables, not in source control.
5. Back up the SQLite data directory and monitor `/readyz` from your orchestration platform.
6. Run the server under PM2 with `ecosystem.config.cjs` (in the repository root) or an equivalent process manager.
7. Review route-level authorization before exposing institution or privileged administrative workflows.
8. Add audit logging, rate limiting, and abuse protection around authentication endpoints.
9. Tune CSP, HSTS, cookie, and cache headers at the reverse proxy layer.
10. Revisit privileged aggregate-analytics exposure whenever reporting requirements change.

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
