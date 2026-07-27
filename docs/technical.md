# Technical Reference

## Architecture overview

Qglimpse is an npm workspace monorepo with two packages:

```
quickglimpse/
├── packages/
│   ├── server/          # Express API + SQLite backend (TypeScript)
│   │   └── src/
│   │       ├── index.ts     # Route definitions, middleware, rate limiters
│   │       ├── auth.ts      # Session, password, 2FA, Turnstile logic
│   │       ├── services.ts  # Business logic (institutions, kiosk, analytics, SMTP)
│   │       ├── db.ts        # Schema migrations, seed data, DB singleton
│   │       ├── config.ts    # Env-var-driven configuration object
│   │       └── data/        # Seed data (demographics + insight templates)
│   └── web/             # React + Vite + Tailwind SPA (TypeScript)
│       └── src/
│           ├── App.tsx
│           └── main.tsx
├── docs/                # This documentation
└── ecosystem.config.cjs # PM2 process config
```

### Request flow

```
Browser → Express static (packages/web/dist)
        → Express API (/api/*)
              → Rate limiter
              → Auth middleware (Bearer token → session lookup)
              → Route handler → services.ts → better-sqlite3-multiple-ciphers → encrypted quickglimpse.db
```

The SPA is served as static files from `packages/web/dist`. The server falls back to `index.html` for all non-API routes (SPA shell routing).

---

## Database schema

SQLCipher-backed SQLite with WAL journal mode. The configured `QUICKGLIMPSE_DB_ENCRYPTION_KEY` is applied during database open and verified before migrations run. Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### `institutions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `slug` | TEXT UNIQUE | URL-safe identifier used in kiosk routes |
| `timezone` | TEXT | IANA timezone string |
| `kiosk_mode_enabled` | INTEGER | Boolean flag (0/1) |
| `color_scheme` | TEXT | Theme name: `ocean`, `emerald`, `sunset`, `violet` |
| `created_at` | TEXT | ISO 8601 timestamp |

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE | Lowercase |
| `role` | TEXT | `root`, `institution_admin`, `institution_user`, `institution_kiosk` |
| `status` | TEXT | `active`, `suspended`, `deactivated` |
| `institution_id` | INTEGER FK | NULL for root accounts |
| `email_verified` | INTEGER | Boolean (0/1) |
| `two_fa_enabled` | INTEGER | Boolean (0/1) |
| `last_login_at` | TEXT | |
| `deactivated_at` | TEXT | |
| `created_at` | TEXT | |

### `user_credentials`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | INTEGER PK FK→users | |
| `password_hash` | TEXT | bcrypt hash |
| `must_change_password` | INTEGER | Boolean (0/1) |
| `updated_at` | TEXT | |

### `auth_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `user_id` | INTEGER FK→users | |
| `token_hash` | TEXT UNIQUE | HMAC-SHA-256 of the bearer token using `QUICKGLIMPSE_SESSION_SECRET` |
| `expires_at` | TEXT | Controlled by `QUICKGLIMPSE_SESSION_TTL_MS` |
| `last_seen_at` | TEXT | Updated on authenticated use; idle expiry controlled by `QUICKGLIMPSE_SESSION_IDLE_TTL_MS` |
| `revoked_at` | TEXT | Set on logout or account suspension |
| `created_at` | TEXT | |

### `login_attempts`

Records successful and failed login attempts for brute-force protection. Failed attempts are counted by email or IP over a 15-minute window.

### `audit_events`

Records security and privileged administrative actions without passwords, OTPs, tokens, raw answers, or SMTP secrets.

### `question_templates`

Global template bank. Institution questions are cloned from here.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `template_key` | TEXT UNIQUE | Stable identifier (e.g. `demographics.age_range`) |
| `question_type` | TEXT | `single`, `multiple`, `text`, `scale`, `boolean`, `star` |
| `prompt` | TEXT | Question text shown to the visitor |
| `options_json` | TEXT | JSON array of option strings |
| `is_demographic` | INTEGER | Boolean — marks demographic questions |
| `created_at` | TEXT | |

### `institution_questions`

Per-institution copy of a template, with scheduling and display overrides.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `institution_id` | INTEGER FK→institutions | |
| `template_key` | TEXT | References `question_templates.template_key` |
| `question_type` | TEXT | |
| `prompt` | TEXT | |
| `options_json` | TEXT | |
| `is_active` | INTEGER | Boolean |
| `is_demographic` | INTEGER | Boolean |
| `include_in_kiosk` | INTEGER | Boolean |
| `display_order` | INTEGER | Sort order on kiosk screen |
| `schedule_days` | TEXT | JSON array of day-of-week integers (0 = Sun) |
| `schedule_start_time` | TEXT | `HH:MM` — nullable |
| `schedule_end_time` | TEXT | `HH:MM` — nullable |
| `created_at` | TEXT | |

Unique constraint: `(institution_id, template_key)`.

### `kiosk_sessions`

One row per visitor interaction.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `institution_id` | INTEGER FK→institutions | |
| `session_token` | TEXT UNIQUE | Random token issued at session start |
| `demographic_data` | TEXT | JSON object submitted at session completion |
| `expires_at` | TEXT | Session expiry used by kiosk and QR validation |
| `started_at` | TEXT | |
| `completed_at` | TEXT | NULL until `POST /api/kiosk/complete` |

### `guest_qr_tokens`

Single-use guest-device submission links generated by authenticated kiosk users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `institution_id` | INTEGER FK→institutions | Institution scope for the token |
| `kiosk_session_id` | INTEGER FK→kiosk_sessions | Bound kiosk session snapshot |
| `token_hash` | TEXT UNIQUE | SHA-256 hash of the URL token; raw tokens are not stored |
| `expires_at` | TEXT | Short-lived expiry |
| `consumed_at` | TEXT | Set after successful submission |
| `created_at` | TEXT | |

### `responses`

Individual question answers within a kiosk session.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `institution_id` | INTEGER FK→institutions | |
| `question_key` | TEXT | `institution_questions.template_key` |
| `answer_json` | TEXT | JSON-encoded answer value |
| `kiosk_session_id` | INTEGER FK→kiosk_sessions | nullable |
| `created_at` | TEXT | |

### `smtp_settings`

Single-row table (id always = 1).

| Column | Type | Notes |
|--------|------|-------|
| `username` | TEXT | SMTP auth username |
| `password` | TEXT | SMTP auth password (stored in DB — use secrets management in production) |
| `send_address` | TEXT | From address for outgoing email |
| `server_address` | TEXT | SMTP host |
| `port` | INTEGER | Default 587 |
| `secure_login_type` | TEXT | `none`, `ssl`, `starttls` |
| `updated_at` | TEXT | |

### `login_challenges`

Temporary records for OTP and magic-link flows. Consumed on use; expire after 15 minutes.

### `schema_migrations`

Records applied schema versions. Version `5` represents the current baseline schema and compatibility migrations in `packages/server/src/db.ts`.

| Column | Type | Notes |
|--------|------|-------|
| `version` | INTEGER PK | Applied schema version |
| `applied_at` | TEXT | Timestamp when the version was recorded |

## Production configuration

When `NODE_ENV=production`, config loading fails closed:

- `.env.example` is not loaded as a fallback.
- `QUICKGLIMPSE_BASE_URL` must be `https://` and cannot be localhost.
- `QUICKGLIMPSE_TRUST_PROXY` must trust the deployment proxy hop.
- `QUICKGLIMPSE_DB_ENCRYPTION_KEY` and `QUICKGLIMPSE_SESSION_SECRET` must be non-placeholder values with at least 32 characters.
- `QUICKGLIMPSE_SESSION_IDLE_TTL_MS` must be positive and no greater than `QUICKGLIMPSE_SESSION_TTL_MS`.
- Turnstile site and secret keys are required.
- SMTP settings are required and must use `ssl` or `starttls`.
- Seed credentials are not created by normal startup.

Production role model:

| Role | Permissions |
|------|-------------|
| `root` | Create/configure/suspend institutions; manage users across all institutions; manage global feedback and demographic templates; configure SMTP, security, retention, backup, and compliance settings; view platform aggregate health metrics; perform audited institution exports where policy permits. |
| `institution_admin` | Manage users, institution settings, branding, kiosk/QR mode, question bank, schedules, demographic prompts, analytics, exports, and retention overrides for their own institution only. |
| `institution_user` | View analytics and manage question-bank/scheduling work for their own institution. Export access is intended to be explicitly permissioned by an institution admin. No user, SMTP, retention, backup, or institution-lifecycle access. |
| `institution_kiosk` | Kiosk-device login only; may start guest sessions for its own institution. No dashboard, analytics, export, user, question-management, or settings access. |

Canonical web routes:

| Path | Purpose | Status |
|------|---------|--------|
| `/` | Public homepage for institutions considering Qglimpse. | Current |
| `/login` | Single account login for root, institution admin, institution general user, and kiosk user roles. | Current |
| `/app` | Authenticated staff app shell alias for staff workflows. | Current alias |
| `/kiosk/login` | Kiosk-device login for kiosk-only accounts. | Planned dedicated alias; current kiosk users sign in through `/login` and are routed to `/kiosk`. |
| `/guest/qr/:token` | Anonymous guest-device submission from a short-lived, single-use QR token. | Current |

Anonymous-only guest data contract:

| Allowed category | Notes |
|------------------|-------|
| Feedback answer values | Configured single choice, multiple choice, boolean, scale, star, and short free-text answers where enabled. |
| Question metadata | Question key, type, prompt/version, options, schedule assignment, and institution id needed to interpret the answer. |
| Kiosk/QR session metadata | Random token hashes, expiry, start/completion timestamps, submission channel, and institution id. |
| Optional demographics | Broad, skippable categories such as age range, visit type, travel band, duration band, or purpose category. |
| Derived analytics | Aggregates and export audit metadata that cannot reconstruct a guest identity. |

Banned guest fields: names, initials, signatures, email addresses, phone numbers, postal addresses, exact dates of birth, national identifiers, patient/student/customer IDs, appointment IDs, ticket numbers, account IDs, payment details, precise geolocation, advertising identifiers, photographs, audio, video, biometrics, diagnosis details, and free-text prompts that ask for direct identifiers. IP addresses and raw user-agent strings must not be stored with guest feedback.

Retention contract: raw feedback responses, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs default to 90-day retention. Institutions may configure shorter retention. Longer retention requires explicit root approval and matching privacy documentation. Encrypted backups must age out raw feedback on the same 90-day default schedule, and restored data must pass retention cleanup before user access.

---

## API endpoint reference

All API routes are prefixed `/api/`. Authenticated routes require an `Authorization: Bearer <token>` header.

### Bootstrap & health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/readyz` | None | Health check — returns `{ status, version, timestamp }` |
| `GET` | `/api/bootstrap` | None | Returns Turnstile config and app metadata for SPA init |

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/turnstile` | None | Returns Turnstile site key, remote-validation status, and local dev-bypass hint when no secret is configured |
| `POST` | `/api/institution-interest` | None | Validates homepage institutional-interest submissions with Turnstile and returns `{ accepted: true }` |
| `POST` | `/api/auth/register` | None | Register a new user (requires Turnstile token) |
| `POST` | `/api/auth/login` | None | Log in; returns session token and `redirectPath`, or a generic 2FA challenge state (requires Turnstile token) |
| `GET` | `/api/auth/session` | Bearer | Validate session, refresh idle timestamp, and return user info |
| `POST` | `/api/auth/logout` | Bearer | Revoke the current session |
| `GET` | `/api/auth/users` | Root user | List all users |
| `PATCH` | `/api/auth/users/:id/status` | Root user | Update user status (`active`, `suspended`, `deactivated`) |
| `PATCH` | `/api/auth/users/:id/2fa` | Self or root user | Enable/disable 2FA for a user |
| `PATCH` | `/api/auth/profile` | Bearer | Update own email address |
| `PATCH` | `/api/auth/profile/password` | Bearer | Change own password |
| `POST` | `/api/auth/challenges` | None | Issue an SMTP-delivered OTP or magic-link challenge; returns only `{ accepted: true }` |
| `POST` | `/api/auth/challenges/verify` | None | Verify an OTP code and issue a session |
| `GET` | `/api/auth/magic-link?token=` | None | Verify a magic-link token and issue a session |
| `POST` | `/api/auth/password-reset/request` | None | Request a password-reset token |
| `POST` | `/api/auth/password-reset/confirm` | None | Confirm password reset with token + new password |
| `POST` | `/api/auth/email-verify/request` | Bearer | Send an email verification link |
| `POST` | `/api/auth/email-verify/confirm` | None | Confirm email with verification token |

### Institutions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/institutions` | Root user | List all institutions |
| `POST` | `/api/institutions` | Root user | Create an institution |
| `GET` | `/api/institutions/:id` | Bearer | Get institution details |
| `PUT` | `/api/institutions/:id` | Root user | Update institution (name, slug, timezone, colorScheme) |
| `DELETE` | `/api/institutions/:id` | Root user | Delete institution (blocked if users assigned) |
| `POST` | `/api/institutions/:id/kiosk-mode` | Root user or institution admin (own) | Enable/disable kiosk mode |
| `POST` | `/api/institutions/:id/color-scheme` | Root user or institution admin (own) | Update institution colour theme (`ocean`, `emerald`, `sunset`, `violet`) |
| `GET` | `/api/institutions/:id/users` | Root user or institution admin (own) | List users in an institution |
| `POST` | `/api/institutions/:id/users` | Root user or institution admin (own) | Create a user within an institution |
| `GET` | `/api/institutions/:id/questions` | Root user or institution admin (own) | List institution questions |
| `POST` | `/api/institutions/:id/questions` | Root user or institution admin (own) | Create a custom question |
| `PATCH` | `/api/institutions/:id/questions/:questionId` | Root user or institution admin (own) | Update question settings/schedule |
| `DELETE` | `/api/institutions/:id/questions/:questionId` | Root user or institution admin (own) | Delete a custom question |
| `GET` | `/api/institutions/:id/analytics` | Root user or any institution user (own) | Aggregated response analytics (optional `?from=&to=`) |
| `GET` | `/api/institutions/:id/analytics/cross-tab` | Root user or any institution user (own) | Cross-tabulation of a question by demographic (`?primaryKey=&demographicKey=`) |

### Kiosk runtime

Kiosk session and QR token creation are login-based and require an `institution_kiosk` bearer session scoped to the requested institution. Anonymous QR inspection/submission validates token hash, expiry, consumption status, institution scope, kiosk availability, bound session status, assigned question, answer type, and configured options.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/kiosk/:slug/status` | None | Check if kiosk is enabled and return active questions |
| `POST` | `/api/kiosk/:slug/session` | Institution kiosk user (own) | Start a new kiosk session; returns `sessionToken` |
| `POST` | `/api/kiosk/:slug/qr-token` | Institution kiosk user (own) | Create a short-lived single-use QR link for guest-device submission |
| `POST` | `/api/kiosk/answer` | None | Submit one answer for the active session |
| `POST` | `/api/kiosk/complete` | None | Complete a session and record demographic data |
| `GET` | `/api/guest/qr/:token` | None | Inspect a valid QR token and return the bound question snapshot |
| `POST` | `/api/guest/qr/:token` | None | Submit anonymous feedback through a valid single-use QR token |

### Question templates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/question-templates` | Bearer | List all global question templates |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/smtp` | Root user | Read SMTP settings |
| `PUT` | `/api/settings/smtp` | Root user | Update SMTP settings |
| `POST` | `/api/settings/smtp/test` | Root user | Send a test email (`{ "toAddress": "..." }`) |

---

## Rate limiting

Rate limiters are **disabled in dev-bypass mode**.

| Limiter | Window | Limit | Applied to |
|---------|--------|-------|-----------|
| `authChallengeLimiter` | 5 min | 5 requests | Challenge issue/verify, password reset, magic link |
| `authCoreLimiter` | 5 min | 20 requests | Login, register, logout, session, profile, user management |
| `kioskRuntimeLimiter` | 1 min | 120 requests | Kiosk session start, QR token, answer, complete, and guest QR endpoints |
| `privilegedOpsLimiter` | 5 min | 40 requests | Institutions, questions, analytics, SMTP, privileged overview |
| `spaShellLimiter` | 1 min | 240 requests | SPA shell fallback (all non-API GET requests when dist is built) |
| `fallbackLimiter` | 1 min | 120 requests | Fallback HTML when dist is not built |

Standard `RateLimit-*` headers are returned on all limited responses. `429 Too Many Requests` is returned when a limit is exceeded.

---

## Security headers

Applied to every response by global Express middleware:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; child-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `Referrer-Policy` | `no-referrer` |
| `Origin-Agent-Cluster` | `?1` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Request-ID` | Incoming valid `X-Request-ID` or a generated UUID |
| `X-Powered-By` | _(removed)_ |

API routes additionally set `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

HSTS is sent on all responses including HTTP. Terminate TLS at a reverse proxy in production and ensure `QUICKGLIMPSE_BASE_URL` uses `https://`.

Unknown `/api/...` paths return JSON `404` responses before SPA fallback routing. Expired, consumed, forged, or unavailable QR tokens fail closed through the explicit guest QR handlers.

## Request, audit, and CSRF model

Every response includes `X-Request-ID`. Error logs are JSON records with the request ID, method, path, status, duration, client IP as resolved through the configured trusted proxy chain, and a redacted error summary. Secret-like keys such as passwords, tokens, session identifiers, SMTP credentials, raw answers, and demographic payloads are replaced with `[REDACTED]` before logging.

Audit events store a stable `audit_id` UUID in addition to the database row id. Operational review should use `audit_id` as the external reference, and join it with structured logs by timestamp, actor, institution, and request ID where a route-level action triggered the audit event.

Qglimpse API authentication is bearer-token only. The server does not accept cookie authentication, does not set an auth cookie, and requires JavaScript to send the `Authorization: Bearer ...` header. The web client stores the bearer token in same-origin `localStorage` so manual URL entry and page refreshes can restore the session. Successful authenticated API use refreshes `last_seen_at` and slides `expires_at` forward; the default session and idle windows are 30 days. Logout removes the browser token and revokes the server session. Because cross-site form posts cannot attach this bearer token and cross-origin JavaScript cannot read it without an XSS foothold, CSRF protection is handled by the bearer-token design plus no-store API responses, same-origin CSP, and no CORS policy. The CSP and XSS controls are security-critical because same-origin script execution can read `localStorage`.
