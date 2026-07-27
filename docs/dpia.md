# Qglimpse DPIA (Data Protection Impact Assessment) Summary

## Processing description

Qglimpse collects anonymous visitor feedback and optional demographic categories, then presents institution-level analytics and privileged aggregate platform metrics.

## Necessity and proportionality

- The service purpose is operational feedback and service-quality improvement.
- Data minimisation is applied: visitor direct identifiers are not required for normal use.
- Role-based permissions restrict access by responsibility and institution boundary.

## Data categories

- Administrator account data (email, role, institution linkage, session/auth status).
- Survey response data (question key, answer value, timestamp, kiosk session linkage).
- Optional demographic category selections.

Banned guest fields include names, contact details, exact dates of birth, national identifiers, patient/student/customer IDs, appointment IDs, payment details, precise geolocation, media, biometrics, diagnosis details, and prompts designed to collect direct identifiers. IP addresses and raw user-agent strings must not be stored with guest feedback.

## Key risks considered

- Unauthorized access to institution data.
- Re-identification risk from low-count demographic slices.
- Misconfiguration of authentication or SMTP settings.

## Controls and mitigations

- Authenticated bearer sessions with expiry and revocation.
- Turnstile verification on registration/login.
- SMTP-delivered OTP and magic-link login challenge support.
- Session rotation, revocation, absolute expiry, and idle-timeout enforcement.
- Audit events for login, logout, failed login, password reset, 2FA changes, account status changes, and privileged administration.
- Cross-tab privacy guardrail for low counts (`< 5` masking).
- Secure response headers and API no-store policy.
- 90-day default retention for raw feedback, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs.
- Encrypted backups with the same 90-day default retention expectation and retention cleanup after restore.
- Operational hardening guidance in `docs/production-hardening.md`.

## Residual risk

Residual risk is reduced to low/moderate under expected deployment controls.
Operators should still review local legal obligations and perform deployment-specific DPIA reviews where required.
