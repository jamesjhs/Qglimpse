# Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 22 recommended (≥ 20.18 minimum) | Install via [nvm](https://github.com/nvm-sh/nvm) or [nodejs.org](https://nodejs.org) |
| npm | ≥ 10 | Bundled with Node 22 |
| Docker + Docker Compose | Any recent version | Optional — only needed for container workflow |

## Environment variables

All variables are optional; defaults are shown in the **Default** column.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | TCP port the server listens on |
| `QUICKGLIMPSE_BASE_URL` | `http://localhost:3000` | Canonical public URL — used in magic-link emails and redirects |
| `QUICKGLIMPSE_DATA_DIR` | `<repo-root>/.data` | Directory where SQLite data files are stored |
| `QUICKGLIMPSE_DB_PATH` | `$QUICKGLIMPSE_DATA_DIR/quickglimpse.db` | Full path to the SQLite database file |
| `QUICKGLIMPSE_SESSION_TTL_MS` | `86400000` (24 h) | Session token lifetime in milliseconds |
| `QUICKGLIMPSE_ROOT_SEED_PASSWORD` | `ChangeMeRoot123!` | Seed password for the root account on first run |
| `QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD` | `ChangeMeInstitution123!` | Seed password for the seeded institution-admin account |
| `TURNSTILE_SITE_KEY` | _(empty)_ | Cloudflare Turnstile site key — set in production |
| `TURNSTILE_SECRET_KEY` | _(empty)_ | Cloudflare Turnstile secret key — when absent, dev-bypass mode is active |
| `TURNSTILE_DEV_BYPASS_TOKEN` | `dev-turnstile-pass` | Token accepted in place of a real Turnstile token when `TURNSTILE_SECRET_KEY` is unset |
| `APP_VERSION` | `0.1.0` | Reported by `/readyz` |

> **SMTP settings** are stored in the database (not env vars) and are configured at runtime via the root admin UI or `PUT /api/settings/smtp`. See the [technical reference](technical.md) for the full field set.

### Dev-bypass mode

When `TURNSTILE_SECRET_KEY` is **not** set, the server enters dev-bypass mode:
- All Turnstile checks accept the value of `TURNSTILE_DEV_BYPASS_TOKEN`.
- All rate limiters are disabled.

Set `TURNSTILE_SECRET_KEY` in any environment exposed to real users.

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
| `root@quickglimpse.local` | `ChangeMeRoot123!` | Root |
| `institution-admin@quickglimpse.local` | `ChangeMeInstitution123!` | Institution admin |

Change these passwords immediately after first login, or override them via the seed-password env vars before the first run.

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
npm test        # Server unit tests (Vitest)
```

## Production process manager

The repository ships an [PM2](https://pm2.keymetrics.io/) ecosystem file:

```bash
npm run build
pm2 start ecosystem.config.cjs
```

See [production-hardening.md](production-hardening.md) for the full deployment checklist.
