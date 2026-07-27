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

**Cause:** `QUICKGLIMPSE_DB_PATH` points to a file whose parent directory cannot be created or written by the Qglimpse process user.

**Fix:** Set `QUICKGLIMPSE_DB_PATH` to a writable location, or create and chown the configured directory before starting:
```bash
mkdir -p /var/node/qglimpse.jahosi.co.uk-2010/data
chown -R "$USER":"$USER" /var/node/qglimpse.jahosi.co.uk-2010/data
chmod 750 /var/node/qglimpse.jahosi.co.uk-2010/data
npm start
```

For hosted environments where `/var/lib` is not writable, use a path inside the deployed app directory, for example `QUICKGLIMPSE_DB_PATH=./data/quickglimpse.db`.

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

**Cause:** The request did not include a valid Cloudflare Turnstile token, or the configured secret key does not match the rendered widget site key.

**Fix:**
- Confirm `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are both set from the same Cloudflare Turnstile widget.
- Confirm the deployment CSP allows `https://challenges.cloudflare.com` for scripts, frames, and connections.
- Reload the page and complete the Turnstile challenge again.

### Rate limit `429` on auth endpoints

**Cause:** More than 5 challenge/reset requests in a 5-minute window from the same IP, or more than 20 login/register attempts.

**Fix:** Wait for the window to expire, verify the app is running with the intended production auth config, or adjust `windowMs` / `limit` in `packages/server/src/index.ts` if the defaults are too restrictive for your traffic pattern.

---

## SMTP / email issues

### Test email fails: `connect ECONNREFUSED`

**Cause:** The SMTP server address or port is wrong, or the server is not reachable from the host running Qglimpse.

**Fix:**
1. Verify `serverAddress` and `port` in the root user SMTP settings.
2. Confirm network connectivity: `telnet <serverAddress> <port>`.

### Test email fails: `Invalid login` / `Authentication failed`

**Cause:** Wrong `username` or `password` in SMTP settings.

**Fix:** Update credentials via the root user UI (`Settings → SMTP`) or `PUT /api/settings/smtp`.

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

