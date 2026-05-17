# quickglimpse

Quick Glimpse is a Docker-contained PWA for institution-specific visitor insight collection. The scaffold currently covers Step 1 + Step 2 baseline work plus final hardening for auth boundaries and admin workflows.

## Repository layout

- `/home/runner/work/quickglimpse/quickglimpse/packages/web` — React + Vite + Tailwind PWA shell
- `/home/runner/work/quickglimpse/quickglimpse/packages/server` — Express API, SQLite bootstrap, readiness probe, seed data
- `/home/runner/work/quickglimpse/quickglimpse/docs/docker-quickstart.md` — local container workflow
- `/home/runner/work/quickglimpse/quickglimpse/docs/production-hardening.md` — deployment hardening checklist

## Quick start

```bash
cd /home/runner/work/quickglimpse/quickglimpse
npm install
npm run build
npm start
```

Then open `http://localhost:3000`.

## Included foundation capabilities

- Email 2FA demo that offers either one-time code or magic-link delivery
- Auth core with registration/login, session issuance + validation + logout, and account status lifecycle updates
- Institution-local timezone on the seeded sample institution
- Institution kiosk-mode toggle persisted in SQLite with institution-scoped admin authorization
- Confirmed demographics question bank seeded into template and institution copies
- Root overview limited to aggregate counts only and restricted to root sessions
- SMTP settings limited to username, password, send address, server address, port, and secure login type, restricted to root sessions
- `/readyz` health endpoint, Docker baseline, and PM2 ecosystem file
- API hardening with security headers, strict ID validation, and reduced sensitive bootstrap payload exposure

## Auth seed accounts (local defaults)

- Root: `root@quickglimpse.local` / `ChangeMeRoot123!`
- Institution admin: `institution-admin@quickglimpse.local` / `ChangeMeInstitution123!`
- Turnstile dev bypass token (when no `TURNSTILE_SECRET_KEY` is set): `dev-turnstile-pass`

## User-facing workflow (institution users)

1. Open the web app and sign in through **Auth core**.
2. Use email/password login with Turnstile token.
3. Optionally generate OTP/magic-link demo challenge previews (development/demo flow only).
4. Kiosk usage remains institution-local and tied to institution timezone.

## Admin-facing workflow

### Institution admin
- Can sign in and manage kiosk mode **only for their own institution**.
- Cannot access root analytics or SMTP configuration.

### Root admin
- Can access aggregate-only root overview metrics.
- Can list users and update user lifecycle status (`active`, `suspended`, `deactivated`) with root self-protection.
- Can read/update SMTP settings with the approved field set only.

## Developer-facing notes

- Public bootstrap data intentionally excludes sensitive operational data (SMTP and root analytics).
- Sensitive endpoints require bearer sessions:
  - `GET /api/root/overview` (root only)
  - `GET /api/settings/smtp` (root only)
  - `PUT /api/settings/smtp` (root only)
  - `POST /api/institutions/:id/kiosk-mode` (root or institution_admin, institution scoped for institution admins)
- Login challenge records are periodically cleaned up to reduce DB growth from expired/consumed rows.
- API responses include baseline security headers and `Cache-Control: no-store` for `/api/*`.

## Validation

```bash
npm run lint
npm run build
npm test
```
