# Quick Glimpse DPIA (Data Protection Impact Assessment) Summary

## Processing description

Quick Glimpse collects anonymous visitor feedback and optional demographic categories, then presents institution-level analytics and root-level aggregate platform metrics.

## Necessity and proportionality

- The service purpose is operational feedback and service-quality improvement.
- Data minimisation is applied: visitor direct identifiers are not required for normal use.
- Role-based permissions restrict access by responsibility and institution boundary.

## Data categories

- Administrator account data (email, role, institution linkage, session/auth status).
- Survey response data (question key, answer value, timestamp, kiosk session linkage).
- Optional demographic category selections.

## Key risks considered

- Unauthorized access to institution data.
- Re-identification risk from low-count demographic slices.
- Misconfiguration of authentication or SMTP settings.

## Controls and mitigations

- Authenticated bearer sessions with expiry and revocation.
- Turnstile verification on registration/login.
- Optional OTP and magic-link login challenge support.
- Cross-tab privacy guardrail for low counts (`< 5` masking).
- Secure response headers and API no-store policy.
- Operational hardening guidance in `docs/production-hardening.md`.

## Residual risk

Residual risk is reduced to low/moderate under expected deployment controls.
Operators should still review local legal obligations and perform deployment-specific DPIA reviews where required.
