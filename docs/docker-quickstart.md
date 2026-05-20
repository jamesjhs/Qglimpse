# Docker quick start

1. From `/home/runner/work/quickglimpse/quickglimpse`, build the image:
   ```bash
   docker compose build
   ```
2. Start the containerized app:
   ```bash
   docker compose up
   ```
3. Open `http://localhost:3000`.
4. Check readiness at `http://localhost:3000/readyz`.
5. Data persists in the named Docker volume `quickglimpse-data`.

## Post-start verification workflow

1. Sign in as a platform administrator with seeded administrative credentials.
2. Confirm the aggregate-only platform overview view loads expected metrics.
3. Confirm **SMTP** settings can be read/updated by an authorized administrator.
4. Sign in as institution admin and confirm:
   - kiosk mode can be toggled for own institution
   - privileged overview and SMTP routes remain inaccessible.

## Environment variables

- `PORT` — listening port inside the container
- `QUICKGLIMPSE_BASE_URL` — public base URL used for generated magic-link previews
- `QUICKGLIMPSE_DATA_DIR` — SQLite storage directory inside the container
