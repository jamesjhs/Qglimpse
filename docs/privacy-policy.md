# Qglimpse Privacy Policy

## Scope

This policy applies to Qglimpse deployments operated by an institution using this software.

## What data is processed

- Institution account and administration data (institution name, account email, role, account status).
- Anonymous visitor feedback responses submitted through logged-in kiosk or QR guest flows.
- Optional demographic category answers used for grouped analytics.

Qglimpse is designed so direct visitor identifiers are not required for standard feedback capture.

Qglimpse may process only these anonymous guest data categories:

- Feedback answer values for configured question types.
- Question metadata needed to interpret the answer.
- Random kiosk or QR session metadata needed for abuse prevention and analytics.
- Optional broad demographic category answers.
- Derived aggregate analytics and export audit metadata.

Qglimpse must not ask guests for names, contact details, exact dates of birth, national identifiers, patient/student/customer IDs, appointment IDs, payment details, precise geolocation, photographs, audio, video, biometrics, diagnosis details, or other direct identifiers. IP addresses and raw user-agent strings must not be stored with guest feedback.

## Why data is processed

- To operate institution dashboards and account access.
- To collect service feedback and provide aggregate analytics.
- To support institutional quality improvement and audit workflows.

## How data is protected

- Role-based authorization with institution scoping.
- Session expiry and revocation.
- Security headers (CSP, HSTS, X-Frame-Options, CORP/COOP).
- Rate limiting on high-risk endpoints.
- Encrypted SQLite data persistence under controlled server filesystem access.

## Data sharing

The application itself does not include third-party ad tracking or behavioural profiling components.
SMTP delivery providers may process email metadata when email features are used.

## Retention and deletion

Default retention is 90 days for raw feedback responses, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs. Institutions may configure a shorter window. A longer window requires explicit root approval and matching privacy documentation before use.

Backups must be encrypted and access controlled. Backup sets containing raw feedback must age out on the same 90-day default schedule unless the institution has a stricter policy. Restored data must pass retention cleanup before it is made available to users.

## Contact

Each production deployment must publish the institution's data protection contact on the public policy page or adjacent institutional privacy notice before collecting real guest feedback.
