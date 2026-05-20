# Troubleshooting

## Database issues

### `SQLITE_BUSY: database is locked`

**Cause:** A second process has opened the database file exclusively, or a previous process crashed while holding a write lock.

**Fix:**
1. Confirm only one server process is running: `ps aux | grep quickglimpse`
2. Stop any duplicate processes.
3. The database is opened in WAL mode, so brief lock contention is usually transient — restart the server.
4. If the lock persists, remove the WAL side-files and restart:
   ```bash
   rm .data/quickglimpse.db-shm .data/quickglimpse.db-wal
   npm start
   ```

### `SQLITE_CANTOPEN` / database directory not found

**Cause:** The directory set in `QUICKGLIMPSE_DATA_DIR` or `QUICKGLIMPSE_DB_PATH` does not exist and could not be created (permission error).

**Fix:** Ensure the process user has write access to the data directory:
```bash
mkdir -p .data
chmod 750 .data
npm start
```

---

## Server / network issues

### `Error: listen EADDRINUSE :::3000`

**Cause:** Port 3000 is already bound by another process.

**Fix:**
```bash
# Find what is using port 3000
lsof -i :3000
# Kill it, or change the port
PORT=3001 npm start
```

### Server starts but browser shows "web bundle not built"

**Cause:** `packages/web/dist` does not exist — the React SPA has not been compiled.

**Fix:**
```bash
npm run build
npm start
```

---

## Turnstile / CAPTCHA failures

### `Turnstile verification failed` on login or registration

**Cause:** The request did not include the expected bypass token.

**Fix:**
- Ensure the submitted token is `dev-turnstile-pass`.
- Reload the page and retry if the client token field was changed manually.

### Rate limit `429` on auth endpoints

**Cause:** More than 5 challenge/reset requests in a 5-minute window from the same IP, or more than 20 login/register attempts.

**Fix:** Rate limiters are skipped in dev-bypass mode; verify the app is running with default auth config and retry.

**Fix (production):** Wait for the window to expire, or adjust `windowMs` / `limit` in `packages/server/src/index.ts` if the defaults are too restrictive for your traffic pattern.

---

## SMTP / email issues

### Test email fails: `connect ECONNREFUSED`

**Cause:** The SMTP server address or port is wrong, or the server is not reachable from the host running Quick Glimpse.

**Fix:**
1. Verify `serverAddress` and `port` in the platform admin SMTP settings.
2. Confirm network connectivity: `telnet <serverAddress> <port>`.

### Test email fails: `Invalid login` / `Authentication failed`

**Cause:** Wrong `username` or `password` in SMTP settings.

**Fix:** Update credentials via the platform admin UI (`Settings → SMTP`) or `PUT /api/settings/smtp`.

### Test email fails: `self-signed certificate` / TLS error

**Cause:** The SMTP server presents a certificate that Node.js does not trust, or `secureLoginType` is set incorrectly.

**Fix:**
- Change `secureLoginType` to `none` for plain-text SMTP (not recommended for production).
- Use `starttls` for submission port 587 or `ssl` for port 465.
- If the server uses a self-signed cert in a trusted internal environment, set `NODE_TLS_REJECT_UNAUTHORIZED=0` (development only — never in production).

### Emails arrive in spam / no email received

**Cause:** The sending domain lacks SPF/DKIM records, or `sendAddress` does not match the authenticated SMTP account.

**Fix:** Configure SPF and DKIM for your domain and ensure `sendAddress` matches the SMTP account identity.

---

## Kiosk issues

### Kiosk page shows "Kiosk is not available"

**Cause:** Kiosk mode is disabled for the institution.

**Fix:** Sign in as an authorized admin and enable kiosk mode:
- UI: **Admin → Institution → Kiosk mode → Enable**
- API: `POST /api/institutions/:id/kiosk-mode` with body `{ "enabled": true }`

### Kiosk shows no questions

**Cause:** All institution questions have `include_in_kiosk = false`, or none are active.

**Fix:** Sign in as institution admin, go to **Questions**, and toggle at least one question on for kiosk display.

### Questions not shown at current time

**Cause:** A question has a `schedule_days` / `schedule_start_time` / `schedule_end_time` that excludes the current day or time.

**Fix:** Edit the question schedule or clear the schedule fields to show the question at all times.

---

## Session / authentication issues

### `Session is invalid or expired`

**Cause:** The session token has exceeded `QUICKGLIMPSE_SESSION_TTL_MS` (default 24 hours), or the user was suspended/deactivated, or the session was explicitly revoked on logout.

**Fix:** Log in again. To extend session lifetime, increase `QUICKGLIMPSE_SESSION_TTL_MS` (value in milliseconds).

### `mustChangePassword` banner appears immediately after login

**Cause:** The account was created by an admin with a temporary password, or the seed password was never changed.

**Fix:** Follow the banner prompt to set a new password via **Profile → Change password**.

### Magic link returns `Magic link verification failed`

**Cause:** The link has already been used (tokens are single-use), has expired (15-minute window), or the token was truncated by an email client.

**Fix:** Request a new magic link via `POST /api/auth/challenges` with `{ "method": "magic_link" }`.

---

## Docker issues

### Container exits immediately

**Cause:** The data volume is not writable, or the port is already bound on the host.

**Fix:**
```bash
docker compose logs quickglimpse
```
Look for permission errors or `EADDRINUSE`. Adjust `ports:` in `docker-compose.yml` if needed.

### Data lost after `docker compose down`

**Cause:** `docker compose down -v` was used, which removes named volumes.

**Fix:** Use `docker compose down` (without `-v`) to stop without removing data. Back up the `quickglimpse-data` volume before destructive operations.
