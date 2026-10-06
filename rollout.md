# Qglimpse automated rollout guide

This guide documents the current push-to-server deployment path for Qglimpse.
It is written for the current setup:

- Local development on Windows using GitHub Desktop and VS Code.
- Source hosted on GitHub.
- GitHub Actions workflow at `.github/workflows/deploy.yml`.
- Container image built from the root `Dockerfile`.
- Image published to GitHub Container Registry, `ghcr.io`.
- Debian 13 virtual private server running Docker containers.
- Cloudflare Tunnel and Cloudflare Access providing SSH access to the server.
- Runtime managed with `docker compose` in `/home/dockertunnel/qglimpse.jahosi.co.uk-2010`.
- Public app URL: `https://qglimpse.jahosi.co.uk`.

The intended daily workflow is:

```text
Edit in VS Code -> commit in GitHub Desktop -> push to main -> GitHub Actions builds and publishes the Docker image -> GitHub Actions SSHes through Cloudflare -> Debian server pulls the new image -> docker compose restarts qglimpse
```

## 1. Understand the deployment files

### `Dockerfile`

The Dockerfile creates a production-only Node container in three stages:

1. `deps`
   - Uses `node:20-alpine`.
   - Installs build tools needed by native npm dependencies.
   - Copies root and workspace `package.json` files.
   - Runs `npm ci`.

2. `build`
   - Copies `packages` and `scripts`.
   - Runs `npm run build`.
   - Prunes dev dependencies with `npm prune --omit=dev --workspaces`.

3. `runtime`
   - Uses `node:20-alpine`.
   - Sets `NODE_ENV=production`.
   - Copies only production dependencies, compiled server files, built web assets, package metadata, and scripts.
   - Exposes the build-time `APP_PORT`, which defaults to `2010` and is set from the GitHub `PORT` variable during CI builds.
   - Starts with `npm start`.

This means the server should not build source code on the VPS during deployment. GitHub Actions builds the image, and the server only pulls and runs it.

### `docker-compose.yml`

The compose file defines one service:

```yaml
services:
  qglimpse:
    image: ${QGLIMPSE_IMAGE:-qglimpse:local}
    build: .
    container_name: qglimpse-${BRANCH_NAME:-main}
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./persistent-data:/app/data
    networks:
      - proxy
```

Important details:

- `QGLIMPSE_IMAGE` is written into the server `.env` by GitHub Actions.
- In deployment, `docker compose pull qglimpse` pulls the prebuilt GHCR image.
- `docker compose up -d --no-build qglimpse` restarts the service without building on the VPS.
- `./persistent-data:/app/data` keeps database files and runtime data outside the container so they survive image replacement.
- The app joins an external Docker network named `proxy`.
- Traefik labels route `qglimpse.jahosi.co.uk` to the internal container port from `PORT`.

The external `proxy` network and whatever proxy/tunnel container uses it must already exist on the Debian server.

### `.github/workflows/deploy.yml`

The workflow is named `Deploy to Debian` and runs on:

```yaml
on:
  push:
    branches: [ main ]
```

Only pushes to `main` deploy automatically.

The workflow:

1. Checks out the repository.
2. Creates image names:
   - `ghcr.io/<owner>/<repo>:<commit-sha>`
   - `ghcr.io/<owner>/<repo>:main`
3. Logs in to GHCR using `GITHUB_TOKEN`.
4. Builds and pushes the Docker image using Buildx.
5. Installs `cloudflared` on the GitHub runner.
6. Configures SSH through Cloudflare Access.
7. Builds a production `.env` file from GitHub environment secrets and variables.
8. Copies `.env` and `docker-compose.yml` to the VPS.
9. SSHes into the VPS and runs:

```sh
docker compose pull qglimpse
docker compose up -d --no-build qglimpse
docker image prune -f
```

## 2. Prepare the Debian 13 server

Run these commands on the VPS as a user with sudo rights.

### 2.1 Install Docker

These commands follow Docker's official Debian apt-repository pattern. If you rebuild the VPS much later, check the current Docker Debian install page first in case package names or keyring guidance have changed.

```sh
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Check Docker:

```sh
docker --version
docker compose version
```

### 2.2 Create or confirm the deploy user

The workflow expects:

```text
SSH_USER=dockertunnel
```

If the user does not exist:

```sh
sudo adduser dockertunnel
sudo usermod -aG docker dockertunnel
```

Log out and back in after adding the Docker group, or restart the session.

### 2.3 Create the deployment directory

The workflow expects:

```text
DEPLOY_PATH=/home/dockertunnel/qglimpse.jahosi.co.uk-2010
```

Create it:

```sh
sudo mkdir -p /home/dockertunnel/qglimpse.jahosi.co.uk-2010
sudo chown -R dockertunnel:dockertunnel /home/dockertunnel/qglimpse.jahosi.co.uk-2010
```

### 2.4 Create persistent data storage

```sh
sudo -u dockertunnel mkdir -p /home/dockertunnel/qglimpse.jahosi.co.uk-2010/persistent-data
```

The compose file mounts this into the container at:

```text
/app/data
```

Your GitHub Actions variables should therefore make the production data path line up with the container path, for example:

```text
QUICKGLIMPSE_DATA_DIR=/app/data
QUICKGLIMPSE_DB_PATH=/app/data/quickglimpse.db
```

### 2.5 Confirm the proxy network exists

The compose file requires an external network:

```yaml
networks:
  proxy:
    external: true
```

Check it:

```sh
docker network ls | grep proxy
```

If it does not exist yet:

```sh
docker network create proxy
```

Only do this if your existing Traefik or tunnel/proxy setup expects a Docker network named `proxy`.

## 3. Prepare Cloudflare Tunnel SSH access

The GitHub runner connects to:

```text
SSH_HOST=sshjhs.jahosi.co.uk
SSH_USER=dockertunnel
```

The workflow uses:

```sshconfig
ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h --loglevel debug
```

### 3.1 Server-side expectation

Cloudflare Tunnel should route `sshjhs.jahosi.co.uk` to SSH on the Debian VPS, usually `localhost:22`.

In Cloudflare Zero Trust:

1. Create or confirm a tunnel connector on the Debian VPS.
2. Add a public hostname:
   - Hostname: `sshjhs.jahosi.co.uk`
   - Service: `ssh://localhost:22`
3. Protect the SSH hostname with a Cloudflare Access application.
4. Create a service token for GitHub Actions.

### 3.2 Add the GitHub runner's SSH public key to the VPS

Generate a deploy key pair locally or on a secure admin machine:

```sh
ssh-keygen -t ed25519 -C "github-actions-qglimpse"
```

Add the public key to:

```text
/home/dockertunnel/.ssh/authorized_keys
```

Example on the VPS:

```sh
sudo -u dockertunnel mkdir -p /home/dockertunnel/.ssh
sudo chmod 700 /home/dockertunnel/.ssh
sudo -u dockertunnel nano /home/dockertunnel/.ssh/authorized_keys
sudo chmod 600 /home/dockertunnel/.ssh/authorized_keys
```

The private key goes into the GitHub secret named `SSH_PRIVATE_KEY`.

## 4. Configure GitHub environment secrets and variables

The workflow uses:

```yaml
environment: quickglimpse
```

In GitHub, go to:

```text
Repository -> Settings -> Environments -> quickglimpse
```

Create the environment if it does not exist.

### 4.1 Required GitHub secrets

Add these as environment secrets:

| Secret | Purpose |
|--------|---------|
| `SSH_PRIVATE_KEY` | Private SSH key for the `dockertunnel` user. |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token client ID. |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token secret. |
| `GHCR_USERNAME` | GitHub username or bot account allowed to pull from GHCR. |
| `GHCR_TOKEN` | GitHub token with package read access for GHCR pulls on the VPS. |
| `QUICKGLIMPSE_DB_PATH` | Container database path, normally `/app/data/quickglimpse.db`. |
| `QUICKGLIMPSE_DATA_DIR` | Container data directory, normally `/app/data`. |
| `QUICKGLIMPSE_DB_ENCRYPTION_KEY` | Production SQLCipher key. Use a long random value. |
| `QUICKGLIMPSE_ROOT_SEED_PASSWORD` | Initial/root bootstrap password if used by startup logic. |
| `QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD` | Initial institution bootstrap password if used by startup logic. |
| `QUICKGLIMPSE_SESSION_SECRET` | Long random session secret. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key. |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key. |
| `SMTP_USERNAME` | SMTP account username. |
| `SMTP_PASSWORD` | SMTP account password. |

Generate strong random secrets with PowerShell:

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 4.2 Required GitHub variables

Add these as environment variables:

| Variable | Recommended value |
|----------|-------------------|
| `PORT` | Internal container port for Node and Traefik, currently `2010`. |
| `NODE_ENV` | `production` |
| `QUICKGLIMPSE_BASE_URL` | `https://qglimpse.jahosi.co.uk` |
| `QUICKGLIMPSE_TRUST_PROXY` | `1` |
| `QUICKGLIMPSE_SESSION_TTL_MS` | Your chosen absolute session lifetime. |
| `QUICKGLIMPSE_SESSION_IDLE_TTL_MS` | Your chosen idle timeout. |
| `SMTP_PORT` | Usually `587` for STARTTLS. |
| `SMTP_SECURE_LOGIN_TYPE` | Usually `starttls`. |
| `SMTP_SEND_ADDRESS` | Sender email address. |
| `SMTP_SERVER_ADDRESS` | SMTP host. |

The workflow writes these into the server `.env` file on every deployment, plus:

```text
QGLIMPSE_IMAGE=ghcr.io/<owner>/<repo>:<commit-sha>
```

That image pin is what makes each deployment traceable to a commit.

## 5. Confirm GHCR permissions

GitHub Actions pushes the package using the repository `GITHUB_TOKEN` because the workflow has:

```yaml
permissions:
  contents: read
  packages: write
```

For the Debian server to pull the image, `GHCR_USERNAME` and `GHCR_TOKEN` must be valid for:

```sh
docker login ghcr.io
docker compose pull qglimpse
```

If the repository or package is private, the token normally needs at least package read permission.

Manual server test:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
echo "<GHCR_TOKEN>" | docker login ghcr.io -u "<GHCR_USERNAME>" --password-stdin
```

Do not leave tokens in shell history on shared systems.

## 6. First deployment checklist

Before the first automated deployment, confirm:

1. `dockertunnel` can run Docker commands.
2. `/home/dockertunnel/qglimpse.jahosi.co.uk-2010` exists.
3. `/home/dockertunnel/qglimpse.jahosi.co.uk-2010/persistent-data` exists.
4. The Docker network `proxy` exists.
5. The Cloudflare tunnel connector is running.
6. `sshjhs.jahosi.co.uk` reaches the VPS SSH service through Cloudflare Access.
7. The `quickglimpse` GitHub environment exists.
8. All required GitHub secrets and variables are present.
9. The GHCR pull token works.
10. DNS and Traefik routing for `qglimpse.jahosi.co.uk` point at the container on the configured `PORT`.

## 7. Daily push-to-deploy workflow

Use this for ordinary changes.

### 7.1 Edit locally

Open the repo in VS Code:

```powershell
cd C:\GitHub\Qglimpse
code .
```

Make the code or documentation changes.

### 7.2 Validate before committing

Run:

```powershell
npm run lint
npm run build
npm test
```

For dependency/security release evidence, also run:

```powershell
npm run audit:deps
```

### 7.3 Commit in GitHub Desktop

In GitHub Desktop:

1. Review the changed files.
2. Confirm no secrets or local `.env` values are included.
3. Write a clear commit summary.
4. Commit to `main`.

If you work on a feature branch, merge into `main` when ready. The deployment workflow only runs for pushes to `main`.

### 7.4 Push to GitHub

In GitHub Desktop, click:

```text
Push origin
```

This push starts `.github/workflows/deploy.yml`.

### 7.5 Watch GitHub Actions

Go to:

```text
GitHub -> Repository -> Actions -> Deploy to Debian
```

Expected successful job sequence:

1. `Checkout`
2. `Prepare Image Name`
3. `Set Up Docker Buildx`
4. `Log In to GHCR`
5. `Build and Push Image`
6. `Install Cloudflared on Runner`
7. `Configure SSH over Cloudflare`
8. `Build Secure .env File`
9. `Deploy to Server via Tunnel`

If the job succeeds, the new container should be running on the Debian VPS.

## 8. Verify the deployed app

From your local machine:

```powershell
curl https://qglimpse.jahosi.co.uk/readyz
```

In a browser, check:

```text
https://qglimpse.jahosi.co.uk
```

On the VPS:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
docker compose ps
docker compose logs --tail=100 qglimpse
```

Confirm:

- The `qglimpse` service is `Up`.
- The app is listening internally on the configured `PORT`.
- No production fail-closed configuration errors appear.
- The database path is inside `/app/data`.
- The mounted host directory `persistent-data` contains the durable database files.

## 9. How rollback works

The workflow writes `QGLIMPSE_IMAGE` into `.env` using the exact commit SHA image tag.

To roll back manually:

1. Find the previous good image tag in GitHub Packages or a previous successful Actions run.
2. SSH to the server through your Cloudflare Access path.
3. Edit the deployment `.env`:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
nano .env
```

Change:

```text
QGLIMPSE_IMAGE=ghcr.io/<owner>/<repo>:<previous-good-sha>
```

Then run:

```sh
docker compose pull qglimpse
docker compose up -d --no-build qglimpse
docker compose logs --tail=100 qglimpse
```

Rollback changes the application image. It does not automatically roll back database migrations or data changes, so take a backup before high-risk releases.

## 10. Troubleshooting common failures

### Build fails in GitHub Actions

Likely causes:

- TypeScript or Vite build error.
- npm dependency lockfile mismatch.
- Native dependency build failure in the Alpine build stage.

Fix locally first:

```powershell
npm ci
npm run build
npm test
```

Then commit and push the fix.

### GHCR push fails

Check:

- Workflow permissions include `packages: write`.
- GitHub Packages is enabled for the repository or organization.
- The repository owner allows Actions to publish packages.

### SSH through Cloudflare fails

Check:

- `CF_ACCESS_CLIENT_ID` is set.
- `CF_ACCESS_CLIENT_SECRET` is set.
- The Cloudflare Access service token has access to `sshjhs.jahosi.co.uk`.
- The tunnel connector is online.
- The public hostname maps to `ssh://localhost:22`.
- The `SSH_PRIVATE_KEY` secret matches a public key in `/home/dockertunnel/.ssh/authorized_keys`.

### `scp` succeeds but deploy fails

Check on the VPS:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
docker compose config
docker compose pull qglimpse
docker compose up -d --no-build qglimpse
```

Common causes:

- The `proxy` Docker network does not exist.
- `dockertunnel` cannot access Docker.
- GHCR login failed.
- The image tag in `QGLIMPSE_IMAGE` does not exist or is private.

### Container starts then exits

Check logs:

```sh
docker compose logs --tail=200 qglimpse
```

Common causes:

- Missing required production environment variable.
- `QUICKGLIMPSE_BASE_URL` is not HTTPS.
- `QUICKGLIMPSE_TRUST_PROXY` is not valid for the Cloudflare/proxy setup.
- SMTP settings are missing.
- Turnstile keys are missing.
- Database encryption key changed from the key used to create the existing database.
- `/app/data` is not writable through the `persistent-data` mount.

### Public site does not update

Check:

- The GitHub Actions run deployed the commit you expected.
- The `.env` on the server has the expected `QGLIMPSE_IMAGE`.
- `docker compose ps` shows a recently recreated container.
- Traefik is routing `qglimpse.jahosi.co.uk` to the service port from `PORT`.
- Browser/PWA cache has refreshed. If needed, hard refresh or reinstall the PWA during testing.

## 11. Release evidence to record

For each production deployment, record:

- Git commit SHA.
- GitHub Actions run URL.
- GHCR image tag.
- Deployment timestamp.
- `/readyz` result.
- `docker compose ps` result.
- Any database backup taken before deployment.
- Result of `npm run lint`, `npm run build`, `npm test`, and `npm run audit:deps`.

This is especially important because the current automated path uses Docker even though some older documentation still says Docker is not the target deployment path. Treat this guide, `Dockerfile`, `docker-compose.yml`, and `.github/workflows/deploy.yml` as the current deployment source of truth until the older docs are reconciled.

## 12. Quick command reference

Local validation:

```powershell
cd C:\GitHub\Qglimpse
npm run lint
npm run build
npm test
npm run audit:deps
```

Server status:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
docker compose ps
docker compose logs --tail=100 qglimpse
```

Server redeploy using current `.env`:

```sh
cd /home/dockertunnel/qglimpse.jahosi.co.uk-2010
docker compose pull qglimpse
docker compose up -d --no-build qglimpse
docker image prune -f
```

Health check:

```sh
curl -fsS https://qglimpse.jahosi.co.uk/readyz
```
