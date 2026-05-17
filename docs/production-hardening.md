# Production hardening

Use this scaffold as a starting point, then complete the following before release:

1. Put the app behind HTTPS and set `QUICKGLIMPSE_BASE_URL` to the canonical public URL.
2. Terminate TLS at a reverse proxy and restrict the app to private network ingress where possible.
3. Replace the login preview flow with real email delivery and verification before enabling external users.
4. Store SMTP credentials in a secret manager or injected environment variables, not in source control.
5. Back up the SQLite data directory and monitor `/readyz` from your orchestration platform.
6. Run the server under PM2 with `/home/runner/work/quickglimpse/quickglimpse/ecosystem.config.cjs` or an equivalent process manager.
7. Review route-level authorization before exposing institution or root workflows.
8. Add audit logging, rate limiting, and abuse protection around authentication endpoints.
9. Tune CSP, HSTS, cookie, and cache headers at the reverse proxy layer.
10. Revisit root analytics exposure whenever reporting requirements change.
