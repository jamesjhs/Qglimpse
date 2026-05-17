# quickglimpse

Quick Glimpse is a Docker-contained PWA for institution-specific visitor insight collection. This scaffold establishes the first implementation step with a React/Tailwind front end, Express API, SQLite persistence, kiosk-mode toggles, aggregate-only root analytics, confirmed demographic question seeds, and SMTP settings constrained to the approved fields.

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
- Institution-local timezone on the seeded sample institution
- Institution kiosk-mode toggle persisted in SQLite
- Confirmed demographics question bank seeded into template and institution copies
- Root overview limited to aggregate counts only
- SMTP settings limited to username, password, send address, server address, port, and secure login type
- `/readyz` health endpoint, Docker baseline, and PM2 ecosystem file

## Validation

```bash
npm run lint
npm run build
npm test
```
