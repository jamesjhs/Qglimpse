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

## Environment variables

- `PORT` — listening port inside the container
- `QUICKGLIMPSE_BASE_URL` — public base URL used for generated magic-link previews
- `QUICKGLIMPSE_DATA_DIR` — SQLite storage directory inside the container
