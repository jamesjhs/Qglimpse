# Technical Reference

## Architecture overview

Quick Glimpse is an npm workspace monorepo with two packages:

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
├── Dockerfile
├── docker-compose.yml
└── ecosystem.config.cjs # PM2 process config
```

### Request flow

```
Browser → Express static (packages/web/dist)
        → Express API (/api/*)
              → Rate limiter
              → Auth middleware (Bearer token → session lookup)
              → Route handler → services.ts → better-sqlite3 → quickglimpse.db
```

The SPA is served as static files from `packages/web/dist`. The server falls back to `index.html` for all non-API routes (SPA shell routing).

---

## Database schema

SQLite with WAL journal mode. Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### `institutions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `slug` | TEXT UNIQUE | URL-safe identifier used in kiosk routes |
| `timezone` | TEXT | IANA timezone string |
| `kiosk_mode_enabled` | INTEGER | Boolean flag (0/1) |
| `created_at` | TEXT | ISO 8601 timestamp |

### `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE | Lowercase |
| `role` | TEXT | `root`, `institution_admin`, `institution_user` |
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
| `token_hash` | TEXT UNIQUE | SHA-256 of the bearer token |
| `expires_at` | TEXT | Controlled by `QUICKGLIMPSE_SESSION_TTL_MS` |
| `revoked_at` | TEXT | Set on logout or account suspension |
| `created_at` | TEXT | |

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
| `started_at` | TEXT | |
| `completed_at` | TEXT | NULL until `POST /api/kiosk/complete` |

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
| `GET` | `/api/auth/turnstile` | None | Returns Turnstile site key and dev-bypass hint |
| `POST` | `/api/auth/register` | None | Register a new user (requires Turnstile token) |
| `POST` | `/api/auth/login` | None | Log in; returns session token (requires Turnstile token) |
| `GET` | `/api/auth/session` | Bearer | Validate session and return user info |
| `POST` | `/api/auth/logout` | Bearer | Revoke the current session |
| `GET` | `/api/auth/users` | Root | List all users |
| `PATCH` | `/api/auth/users/:id/status` | Root | Update user status (`active`, `suspended`, `deactivated`) |
| `PATCH` | `/api/auth/users/:id/2fa` | Self or root | Enable/disable 2FA for a user |
| `PATCH` | `/api/auth/profile` | Bearer | Update own email address |
| `PATCH` | `/api/auth/profile/password` | Bearer | Change own password |
| `POST` | `/api/auth/challenges` | None | Issue an OTP or magic-link challenge |
| `POST` | `/api/auth/challenges/verify` | None | Verify an OTP code and issue a session |
| `GET` | `/api/auth/magic-link?token=` | None | Verify a magic-link token and issue a session |
| `POST` | `/api/auth/password-reset/request` | None | Request a password-reset token |
| `POST` | `/api/auth/password-reset/confirm` | None | Confirm password reset with token + new password |
| `POST` | `/api/auth/email-verify/request` | Bearer | Send an email verification link |
| `POST` | `/api/auth/email-verify/confirm` | None | Confirm email with verification token |

### Institutions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/institutions` | Root | List all institutions |
| `POST` | `/api/institutions` | Root | Create an institution |
| `GET` | `/api/institutions/:id` | Bearer | Get institution details |
| `PUT` | `/api/institutions/:id` | Root | Update institution (name, slug, timezone) |
| `DELETE` | `/api/institutions/:id` | Root | Delete institution (blocked if users assigned) |
| `POST` | `/api/institutions/:id/kiosk-mode` | Root or inst. admin (own) | Enable/disable kiosk mode |
| `GET` | `/api/institutions/:id/users` | Root or inst. admin (own) | List users in an institution |
| `POST` | `/api/institutions/:id/users` | Root or inst. admin (own) | Create a user within an institution |
| `GET` | `/api/institutions/:id/questions` | Root or inst. admin (own) | List institution questions |
| `POST` | `/api/institutions/:id/questions` | Root or inst. admin (own) | Create a custom question |
| `PATCH` | `/api/institutions/:id/questions/:questionId` | Root or inst. admin (own) | Update question settings/schedule |
| `DELETE` | `/api/institutions/:id/questions/:questionId` | Root or inst. admin (own) | Delete a custom question |
| `GET` | `/api/institutions/:id/analytics` | Root or any institution user (own) | Aggregated response analytics (optional `?from=&to=`) |
| `GET` | `/api/institutions/:id/analytics/cross-tab` | Root or any institution user (own) | Cross-tabulation of a question by demographic (`?primaryKey=&demographicKey=`) |

### Kiosk runtime (public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/kiosk/:slug/status` | None | Check if kiosk is enabled and return active questions |
| `POST` | `/api/kiosk/:slug/session` | None | Start a new kiosk session; returns `sessionToken` |
| `POST` | `/api/kiosk/answer` | None | Submit one answer for the active session |
| `POST` | `/api/kiosk/complete` | None | Complete a session and record demographic data |

### Question templates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/question-templates` | Bearer | List all global question templates |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/settings/smtp` | Root | Read SMTP settings |
| `PUT` | `/api/settings/smtp` | Root | Update SMTP settings |
| `POST` | `/api/settings/smtp/test` | Root | Send a test email (`{ "toAddress": "..." }`) |

### Root overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/root/overview` | Root | Aggregate counts (institutions, users, sessions) |

---

## Rate limiting

Rate limiters are **disabled in dev-bypass mode** (when `TURNSTILE_SECRET_KEY` is unset).

| Limiter | Window | Limit | Applied to |
|---------|--------|-------|-----------|
| `authChallengeLimiter` | 5 min | 5 requests | Challenge issue/verify, password reset, magic link, kiosk session start |
| `authCoreLimiter` | 5 min | 20 requests | Login, register, logout, session, profile, user management |
| `privilegedOpsLimiter` | 5 min | 40 requests | Institutions, questions, analytics, SMTP, root overview |
| `spaShellLimiter` | 1 min | 240 requests | SPA shell fallback (all non-API GET requests when dist is built) |
| `fallbackLimiter` | 1 min | 120 requests | Fallback HTML when dist is not built |

Standard `RateLimit-*` headers are returned on all limited responses. `429 Too Many Requests` is returned when a limit is exceeded.

---

## Security headers

Applied to every response by global Express middleware:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Powered-By` | _(removed)_ |

API routes additionally set `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

HSTS is sent on all responses including HTTP. Terminate TLS at a reverse proxy in production and ensure `QUICKGLIMPSE_BASE_URL` uses `https://`.
