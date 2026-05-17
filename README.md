# quickglimpse

Quick Glimpse is a Docker-contained PWA for institution-specific visitor insight collection. The scaffold currently covers Steps 1–4: foundation, auth core, 2FA/magic-link flows, and institution + user administration.

## Repository layout

- `packages/web` — React + Vite + Tailwind PWA shell
- `packages/server` — Express API, SQLite, auth, seed data
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
- Institution CRUD: root-only `GET/POST /api/institutions`, `GET/PUT/DELETE /api/institutions/:id`; delete blocked if users assigned
- Profile management: `PATCH /api/auth/profile` (email), `PATCH /api/auth/profile/password` (change own password)
- Auth core with registration/login, session issuance + validation + logout, and account status lifecycle updates
- `mustChangePassword` returned in login response; 2FA toggle via `PATCH /api/auth/users/:id/2fa`
- Institution kiosk-mode toggle persisted in SQLite with institution-scoped admin authorization
- Confirmed demographics question bank seeded into template and institution copies
- Root overview limited to aggregate counts only and restricted to root sessions
- SMTP settings limited to the approved field set, restricted to root sessions
- `/readyz` health endpoint, Docker baseline, and PM2 ecosystem file
- Rate limiters bypass in dev mode (when `TURNSTILE_SECRET_KEY` is not set)

## Auth seed accounts (local defaults)

- Root: `root@quickglimpse.local` / `ChangeMeRoot123!`
- Institution admin: `institution-admin@quickglimpse.local` / `ChangeMeInstitution123!`
- Turnstile dev bypass token (when no `TURNSTILE_SECRET_KEY` is set): `dev-turnstile-pass`

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

### Root admin
- Can access aggregate-only root overview metrics.
- Can list all users, update user lifecycle status and toggle 2FA.
- Can read/update SMTP settings.
- Full institution CRUD: create, rename, delete (blocked if users assigned).

## API summary (new in Steps 2–4)

| Method | Path | Access |
|--------|------|--------|
| `POST` | `/api/auth/challenges/verify` | Public |
| `GET` | `/api/auth/magic-link?token=` | Public |
| `POST` | `/api/auth/password-reset/request` | Public |
| `POST` | `/api/auth/password-reset/confirm` | Public |
| `POST` | `/api/auth/email-verify/request` | Authenticated |
| `POST` | `/api/auth/email-verify/confirm` | Public |
| `PATCH` | `/api/auth/users/:id/2fa` | Self or root |
| `PATCH` | `/api/auth/profile` | Authenticated |
| `PATCH` | `/api/auth/profile/password` | Authenticated |
| `GET/POST` | `/api/institutions` | Root |
| `GET/PUT/DELETE` | `/api/institutions/:id` | Root |
| `GET` | `/api/institutions/:id/users` | Root or institution_admin (own) |
| `POST` | `/api/institutions/:id/users` | Root or institution_admin (own) |

## Validation

```bash
npm run lint
npm run build
npm test
```
