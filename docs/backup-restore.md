# Backup and Restore Runbook

Qglimpse stores production data in a SQLCipher-backed SQLite database. Backups must preserve encryption, access controls, and the 90-day default retention contract.

## Backup expectations

- Back up the configured `QUICKGLIMPSE_DB_PATH` and its WAL side files only from a host context that can protect the files.
- Keep `QUICKGLIMPSE_DB_ENCRYPTION_KEY` and `QUICKGLIMPSE_SESSION_SECRET` outside the backup archive and outside source control.
- Encrypt backup archives at the storage layer or with an approved backup tool before they leave the host.
- Restrict restore and download access to root operators with a documented operational need.
- Retain backup sets for no more than 90 days by default. Use a shorter window when an institution policy requires it.
- Do not keep backup copies containing expired raw feedback after the next backup-retention cycle.

## Suggested hot backup flow

Use SQLite's online backup command through the SQLCipher-capable runtime or stop the process briefly and copy the database files as one consistent set. For the simple stop-copy-start approach:

```bash
pm2 stop ecosystem.config.cjs
cp "$QUICKGLIMPSE_DB_PATH" "$BACKUP_DIR/quickglimpse.db"
cp "$QUICKGLIMPSE_DB_PATH-wal" "$BACKUP_DIR/quickglimpse.db-wal" 2>/dev/null || true
cp "$QUICKGLIMPSE_DB_PATH-shm" "$BACKUP_DIR/quickglimpse.db-shm" 2>/dev/null || true
pm2 start ecosystem.config.cjs
```

Immediately place the copied files into encrypted backup storage.

## Restore expectations

1. Stop the Qglimpse process.
2. Restore the encrypted database and matching WAL side files to the configured data directory.
3. Set the original `QUICKGLIMPSE_DB_ENCRYPTION_KEY`; without it the database must not open.
4. Start Qglimpse in an isolated maintenance context.
5. Run retention cleanup before exposing the restored service to users.
6. Verify `/readyz`, root login, institution isolation, and a read-only analytics check.
7. Record the restore operator, time, source backup set, retention cleanup result, and verification result.

## Verification

After restore, confirm that:

- Opening the database without `QUICKGLIMPSE_DB_ENCRYPTION_KEY` fails.
- Opening with the wrong key fails.
- `schema_migrations` contains the current schema version.
- Raw feedback, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs older than the configured retention window are absent or irreversibly anonymised.

## Disaster recovery runbook

Use this runbook when the production host, data directory, Cloudflare Tunnel, or credentials are suspected to be unavailable or compromised.

1. Declare an incident owner and record the start time, detection source, affected institution scope, and current public status.
2. Disable public traffic at Cloudflare if data integrity or unauthorized access is suspected.
3. Preserve the affected host and database files for investigation before overwriting anything.
4. Provision a clean host with the approved Node version, PM2 or equivalent process manager, and private network access.
5. Restore the most recent encrypted backup and matching WAL side files.
6. Inject the original `QUICKGLIMPSE_DB_ENCRYPTION_KEY`, `QUICKGLIMPSE_SESSION_SECRET`, SMTP settings, Turnstile settings, base URL, and trust-proxy setting from the secret store.
7. Start Qglimpse in maintenance isolation and verify database open, migrations, and `/readyz`.
8. Run retention cleanup before exposing restored data.
9. Rotate session secret material and SMTP credentials if compromise is suspected; force affected users to sign in again.
10. Validate root login, institution-scoped admin login, kiosk login, analytics read paths, QR expiry/reuse fail-closed behavior, and export route authorization.
11. Re-enable Cloudflare routing only after verification passes.
12. Record recovery point, recovery time, data loss window, credentials rotated, users notified, and follow-up actions.

Default recovery expectations are a recovery point objective of the most recent successful encrypted backup and a recovery time objective defined by the institution operator's hosting plan. Qglimpse itself does not provide multi-node failover.
