# Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 22 recommended (≥ 20.18 minimum) | Install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | Bundled with Node 22 |
| Docker + Docker Compose | Any recent version | Optional — only needed for container workflow |

## Environment variables

Copy `.env.example` to `.env`, then set your own deployment values.

| Variable | Description |
|----------|-------------|
| `PORT` | TCP port the server listens on |
| `QUICKGLIMPSE_BASE_URL` | Canonical public URL — used in magic-link emails and redirects |
| `QUICKGLIMPSE_TRUST_PROXY` | Express trusted proxy setting. Use `1` behind one trusted reverse proxy that sets `X-Forwarded-For`; leave `false` for direct/local use |
| `QUICKGLIMPSE_DATA_DIR` | Directory where SQLite data files are stored |
| `QUICKGLIMPSE_DB_PATH` | Full path to the SQLite database file |
| `QUICKGLIMPSE_DB_ENCRYPTION_KEY` | Database encryption key value for deployment environments |
| `QUICKGLIMPSE_SESSION_TTL_MS` | Session token lifetime in milliseconds |
| `QUICKGLIMPSE_ROOT_SEED_PASSWORD` | Seed password for the seeded root/platform-admin account |
| `QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD` | Seed password for the seeded institution-admin account |
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

When `TURNSTILE_SECRET_KEY` is empty, local development uses the built-in bypass token:
- Turnstile checks accept `dev-turnstile-pass`.
- Auth and shell rate limiters are disabled.

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

### Seed accounts (first run only)

| Email | Password | Role |
|-------|----------|------|
| `root@quickglimpse.local` | `ChangeMeRoot123!` | Platform admin (root) |
| `institution-admin@quickglimpse.local` | `ChangeMeInstitution123!` | Institution admin |

Change these passwords immediately after first login, or override them via the seed-password env vars before the first run.

### Configure initial platform admin from CLI

```bash
npm run admin:init -- --email admin@example.com --password 'ChangeMeNow123!'
```

Optional: append `--must-change-password=false` if you do not want the first login to force a password change.

## Docker workflow

```bash
# Build and start the container stack
docker compose build
docker compose up
```

Data persists in the named Docker volume `quickglimpse-data`.  
See [docker-quickstart.md](docker-quickstart.md) for the full post-start verification steps.

## Development mode

Run the server in watch mode (TypeScript recompiles on save):

```bash
npm run dev
```

The React SPA must be built once before the server can serve it:

```bash
npm run build --workspace @quickglimpse/web
```

For hot-reload SPA development, run the Vite dev server in a second terminal:

```bash
cd packages/web
npm run dev
```

Vite defaults to port `5173`; configure its proxy in `packages/web/vite.config.*` to forward `/api` requests to `localhost:3000`.

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
