# Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 22 recommended (≥ 20.18 minimum) | Install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | Bundled with Node 22 |

## Environment variables

Copy `.env.example` to `.env`, then set your own deployment values.

| Variable | Description |
|----------|-------------|
| `PORT` | TCP port the server listens on |
| `QUICKGLIMPSE_BASE_URL` | Canonical public URL — used in magic-link emails and redirects |
| `QUICKGLIMPSE_TRUST_PROXY` | Express trusted proxy setting. Use `1` behind one trusted reverse proxy that sets `X-Forwarded-For`; leave `false` for direct/local use |
| `QUICKGLIMPSE_DATA_DIR` | Directory where SQLite data files are stored |
| `QUICKGLIMPSE_DB_PATH` | Full path to the SQLite database file |
| `QUICKGLIMPSE_DB_ENCRYPTION_KEY` | SQLCipher database encryption key. Use at least 32 random characters in production |
| `QUICKGLIMPSE_SESSION_SECRET` | HMAC secret for stored bearer-session token hashes. Required in production; use at least 32 random characters |
| `QUICKGLIMPSE_SESSION_TTL_MS` | Session token lifetime in milliseconds |
| `QUICKGLIMPSE_SESSION_IDLE_TTL_MS` | Idle session timeout in milliseconds |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for the browser widget; required in deployed environments |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key for server-side token verification; required in deployed environments |
| `SMTP_USERNAME` | Initial SMTP username |
| `SMTP_PASSWORD` | Initial SMTP password |
| `SMTP_SEND_ADDRESS` | Initial SMTP send address |
| `SMTP_SERVER_ADDRESS` | Initial SMTP server host |
| `SMTP_PORT` | Initial SMTP server port |
| `SMTP_SECURE_LOGIN_TYPE` | Initial SMTP secure mode (`none`, `ssl`, `starttls`) |
### Turnstile configuration

Create a Cloudflare Turnstile widget in the Cloudflare dashboard, then set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `.env`.

Production requires real Turnstile keys. Leave neither `TURNSTILE_SITE_KEY` nor `TURNSTILE_SECRET_KEY` empty.

## Production fail-closed checks

Set `NODE_ENV=production` for production starts. The root `npm start` script and `ecosystem.config.cjs` set it for you. Qglimpse is run from compiled production artifacts only:

- `.env.example` is never loaded as a fallback; real environment values or a real `.env` file must be present.
- Relative `QUICKGLIMPSE_DATA_DIR` and `QUICKGLIMPSE_DB_PATH` values are resolved from the repository root. Absolute paths are recommended for production.
- `QUICKGLIMPSE_BASE_URL` must be an `https://` URL and must not point at localhost.
- `QUICKGLIMPSE_TRUST_PROXY` must trust the Cloudflare or reverse-proxy hop.
- `QUICKGLIMPSE_DB_ENCRYPTION_KEY` and `QUICKGLIMPSE_SESSION_SECRET` must be non-placeholder values with at least 32 characters.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are required.
- SMTP username, password, sender address, server address, port, and secure login mode are required; `SMTP_SECURE_LOGIN_TYPE=none` is rejected.
- Seed credentials are not created. Use `npm run admin:init` to create the first root user.

## First-run steps (bare Node)

```bash
# 1. Clone the repository
git clone https://github.com/jamesjhs/quickglimpse.git
cd quickglimpse

# 2. Install all workspace dependencies
npm install

# 3. Build the React SPA and compile the server
npm run build

# 4. Start the server
npm start
```

Open `http://localhost:3000` in a browser.  
Health check: `http://localhost:3000/readyz`

Docker is not a target deployment path for Qglimpse. Run the built Node server directly under PM2 or another approved host process manager.

### Configure initial root user from CLI

```bash
npm run admin:init -- admin@example.com 'ChangeMeNow123!' true
```

Use `false` as the final argument if you do not want the first login to force a password change.

## Production-only local run

Qglimpse no longer exposes watch-mode or Vite preview scripts. Build explicitly, then start the compiled production server:

```bash
npm run build
npm start
```

If `npm start` reports missing production build artifacts, run `npm run build` and start again.

## Linting and testing

```bash
npm run lint    # ESLint across all workspaces
npm run build   # Type-check + compile
npm test        # Server unit tests (Node.js built-in test runner)
```

## Production process manager

The repository ships an [PM2](https://pm2.keymetrics.io/) ecosystem file:

```bash
npm run build
pm2 start ecosystem.config.cjs
```

See [production-hardening.md](production-hardening.md) for the full deployment checklist.
See [backup-restore.md](backup-restore.md) for encrypted backup and restore expectations.

## Canonical public routes

| Path | Purpose |
|------|---------|
| `/` | Public homepage |
| `/login` | Account login for staff and kiosk users |
| `/app` | Staff app after login |
| `/kiosk/login` | Kiosk-device login for kiosk-only accounts |
| `/guest/qr/:token` | Anonymous QR guest submission |

The current scaffold does not yet implement every canonical route. Treat deviations as pre-production work, not alternate deployment guidance.
