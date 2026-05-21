# quickglimpse

Quick Glimpse is a Docker-contained PWA for institution-specific visitor insight collection. Steps 1–10 are complete, covering the full feature set from auth core through kiosk runtime, analytics, and SMTP integration.

Copy `.env.example` to `.env` and set your own values before first run.

## Features

- **Multi-institution support** — create, manage, and isolate multiple institutions under a single administrative account
- **Full authentication** — email/password login, email 2FA, magic-link sign-in, password reset, email verification
- **Question bank management** — global template library cloned per institution; custom questions; scheduling by day and time window
- **Kiosk runtime** — per-institution kiosk mode with session tracking, answer submission, and demographic capture at completion
- **Analytics with cross-tabulation** — per-institution response summaries with demographic breakdown
- **SMTP with test email** — runtime SMTP configuration stored in the database; test-email endpoint for validation
- **Docker support** — single-container image with named volume persistence and a docker-compose workflow

## Repository layout

- `packages/web` — React + Vite + Tailwind PWA shell
- `packages/server` — Express API, SQLite, auth, seed data
- `docs/install.md` — prerequisites, environment variables, first-run steps
- `docs/troubleshooting.md` — common issues and fixes
- `docs/technical.md` — architecture, schema, API reference, rate limiting, security headers
- `docs/simple-guide.md` — plain-English guide for non-technical staff
- `docs/privacy-policy.md` — privacy policy baseline for deployments
- `docs/dpia.md` — DPIA summary and control mapping
- `docs/docker-quickstart.md` — local container workflow
- `docs/production-hardening.md` — deployment hardening checklist

## Quick start

```bash
npm install
npm run build
npm start
```

Then open `http://localhost:3000`.

## Included foundation capabilities

- Email 2FA: OTP challenge issued on login when enabled; `/api/auth/challenges/verify` issues the session
- Magic link: server generates a token, SPA handles `/magic-link?token=` after redirect from `/auth/magic-link`
- Password reset: `POST /api/auth/password-reset/request` (returns dev preview token) + `POST /api/auth/password-reset/confirm`
- Email verification: `POST /api/auth/email-verify/request` + `POST /api/auth/email-verify/confirm`
- Delegated user creation: institution admins can `POST /api/institutions/:id/users` (users created with `mustChangePassword: true`)
- Institution CRUD: restricted administrative access for `GET/POST /api/institutions`, `GET/PUT/DELETE /api/institutions/:id`; delete blocked if users assigned
- Profile management: `PATCH /api/auth/profile` (email), `PATCH /api/auth/profile/password` (change own password)
- Auth core with registration/login, session issuance + validation + logout, and account status lifecycle updates
- `mustChangePassword` returned in login response; 2FA toggle via `PATCH /api/auth/users/:id/2fa`
- Institution kiosk-mode toggle persisted in SQLite with institution-scoped admin authorization
- Confirmed demographics question bank seeded into template and institution copies
- Platform overview metrics are aggregate-only and restricted to privileged sessions
- SMTP settings are limited to the approved field set and restricted to privileged sessions
- `/readyz` health endpoint, Docker baseline, and PM2 ecosystem file
- Rate limiters bypass in dev-bypass mode

## Auth seed accounts (local defaults)

- Institution admin: `institution-admin@quickglimpse.local` / `ChangeMeInstitution123!`
- Turnstile dev bypass token: `dev-turnstile-pass`

## Create initial platform admin via CLI

```bash
npm run admin:init -- --email admin@example.com --password 'ChangeMeNow123!'
```

Optional: append `--must-change-password=false` if you do not want the first login to force a password change.

## User-facing workflow

1. Sign in via **Auth core** with email + password.
2. If 2FA is enabled, enter the OTP code in the challenge form.
3. If `mustChangePassword` is true, a banner prompts the user to change their password immediately.
4. Manage 2FA and change password from the **Profile** tab.
5. Follow a magic link — the server redirects to `/magic-link?token=…` which logs you in automatically.

## Admin workflows

### Institution admin
- Can sign in and manage kiosk mode **only for their own institution**.
- Can create users via `POST /api/institutions/:id/users` (own institution only).
- Can list users in their institution via `GET /api/institutions/:id/users`.

### Platform admin
- Can access aggregate-only platform overview metrics.
- Can list all users, update user lifecycle status and toggle 2FA.
- Can read/update SMTP settings.
- Full institution CRUD: create, rename, delete (blocked if users assigned).

## API summary (Steps 2–10)

See [docs/technical.md](docs/technical.md) for the full API reference. Key route groups:

| Method | Path | Access |
|--------|------|--------|
| `POST` | `/api/auth/challenges/verify` | Public |
| `GET` | `/api/auth/magic-link?token=` | Public |
| `POST` | `/api/auth/password-reset/request` | Public |
| `POST` | `/api/auth/password-reset/confirm` | Public |
| `POST` | `/api/auth/email-verify/request` | Authenticated |
| `POST` | `/api/auth/email-verify/confirm` | Public |
| `PATCH` | `/api/auth/users/:id/2fa` | Self or platform admin |
| `PATCH` | `/api/auth/profile` | Authenticated |
| `PATCH` | `/api/auth/profile/password` | Authenticated |
| `GET/POST` | `/api/institutions` | Platform admin |
| `GET/PUT/DELETE` | `/api/institutions/:id` | Platform admin |
| `GET` | `/api/institutions/:id/users` | Platform admin or institution_admin (own) |
| `POST` | `/api/institutions/:id/users` | Platform admin or institution_admin (own) |
| `GET/POST/PATCH/DELETE` | `/api/institutions/:id/questions` | Platform admin or institution_admin (own) |
| `GET` | `/api/institutions/:id/analytics` | Platform admin or institution user (own) |
| `GET` | `/api/institutions/:id/analytics/cross-tab` | Platform admin or institution user (own) |
| `GET/POST` | `/api/kiosk/:slug/session` | Public |
| `POST` | `/api/kiosk/answer` | Public |
| `POST` | `/api/kiosk/complete` | Public |
| `GET/PUT` | `/api/settings/smtp` | Platform admin |
| `POST` | `/api/settings/smtp/test` | Platform admin |
| `GET` | `/api/question-templates` | Authenticated |

## Validation

```bash
npm run lint
npm run build
npm test
```
