# Deployment Review Trace

Use this trace to prove that data categories, retention rules, access paths, and export paths match the shipped product.

| Data or path | Category | Access path | Retention | Export status |
|--------------|----------|-------------|-----------|---------------|
| Staff account email, role, status, institution link | Account administration | Root user; same-institution admin for institution users | Retained while account is active or required for audit | Not exported in this release |
| Auth sessions | Account security | Server auth middleware only | Absolute and idle expiry; revoked on logout/status change | Not exported |
| Login challenges | Account security | SMTP challenge issue/verify flows | Deleted when consumed, expired, or retention-expired | Not exported |
| Kiosk sessions | Anonymous guest session metadata | Kiosk APIs and institution analytics | 90 days by default; shorter institution policy allowed | Reserved export path returns `501` |
| Feedback answers | Anonymous guest feedback | Kiosk answer API and institution analytics | 90 days by default; shorter institution policy allowed | Reserved export path returns `501` |
| Demographic answers | Anonymous broad category data | Kiosk complete API and grouped analytics | 90 days by default; shorter institution policy allowed | Reserved export path returns `501` |
| Audit events | Security and compliance evidence | Root operational database review; future admin audit UI | Retained as compliance evidence; does not store raw guest answers | Not exported in this release |
| Structured logs | Operational diagnostics | Host logging platform | Operator-defined; must protect request IDs and redacted metadata | Not exported by Qglimpse |
| Backups | Encrypted recovery copy | Root operator restore workflow | 90 days by default or shorter institution policy | Restore only |
| QR guest submission | Anonymous guest-device submission | `/guest/qr/:token` SPA path and `/api/guest/qr/:token` handlers | QR tokens are short-lived and deleted when consumed, expired, or retention-expired | Reserved export path returns `501`; QR answers appear as anonymous feedback |

## Review questions

- Does the production URL match `QUICKGLIMPSE_BASE_URL` and public documentation?
- Is Cloudflare Tunnel the only public ingress path?
- Does `QUICKGLIMPSE_TRUST_PROXY=1` match the single trusted proxy hop?
- Do all staff, root, kiosk, and anonymous paths match `README.md` and `docs/technical.md`?
- Is every enabled provider listed in `docs/subprocessors.md`?
- Did retention cleanup run after startup or restore?
- Did the latest security test run cover auth, institution isolation, kiosk token misuse, QR reuse fail-closed behavior, export scope, and retention?
