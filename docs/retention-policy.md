# Qglimpse Retention Policy

## Default rule

Raw feedback responses, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs are retained for 90 days by default. Institution operators may configure a shorter window when their local policy requires it. Longer retention requires root approval and matching privacy documentation before use.

## Enforced cleanup

The server runs retention cleanup at startup. Cleanup deletes:

- `responses` rows older than the configured retention window.
- `kiosk_sessions` rows older than the configured retention window.
- consumed, expired, or retention-expired `login_challenges`.

Aggregate analytics may outlive raw rows only when the aggregate cannot reconstruct a session-level payload, free-text answer, rare demographic slice, or small cohort.

## Backups and restores

Backups containing raw feedback follow the same 90-day default expectation and must be encrypted. A restored database must run retention cleanup before staff, kiosk, or export access is re-enabled.

## Export paths

XLSX export is not implemented in this release. The reserved API path `/api/institutions/:id/export` requires an authenticated root or same-institution admin and returns `501` until export generation is implemented. Unknown QR and export-like API paths return JSON `404` before SPA fallback routing.
