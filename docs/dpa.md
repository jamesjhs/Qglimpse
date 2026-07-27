# Qglimpse Data Processing Addendum Wording

This wording is the baseline product position for institutions adopting Qglimpse. Operators should review it with their own legal counsel before attaching it to a signed agreement.

## Roles

The institution operating Qglimpse is the controller for guest feedback, optional demographic answers, staff account records, and export decisions. The hosting operator is the processor when it runs Qglimpse on behalf of the institution. Root administrators act only under the institution onboarding, support, security, retention, backup, and compliance responsibilities documented in this repository.

## Processing instructions

Qglimpse processes data only to:

- operate authenticated staff, root, and kiosk access;
- collect anonymous guest feedback through kiosk and planned QR flows;
- present institution-scoped analytics;
- retain audit evidence for privileged actions;
- run encrypted backup, restore, retention, and disaster recovery processes.

The processor must not use Qglimpse data for advertising, behavioural profiling, unrelated analytics, or training external models.

## Data minimisation

Guest submissions are anonymous-only. Banned guest fields include names, contact details, exact dates of birth, national identifiers, patient/student/customer IDs, appointment IDs, payment details, precise geolocation, photographs, audio, video, biometrics, diagnosis details, and prompts designed to collect direct identifiers. IP addresses and raw user-agent strings must not be stored with guest feedback.

## Security commitments

The processor must operate Qglimpse with SQLCipher-backed database encryption, production-required environment validation, bearer-token authentication, session expiry and revocation, role-based institution scoping, security headers, rate limiting, structured secret-redacted logs, audit event IDs, encrypted backups, and tested restore procedures.

## Retention and deletion

Raw feedback, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs use 90-day default retention unless the institution sets a shorter period. A longer period requires root approval and matching privacy documentation. Backup sets containing raw feedback must age out on the same default schedule and restored data must pass retention cleanup before use.

## Assistance and audit

The processor must support reasonable controller requests for access review, deletion evidence, export-path review, security incident investigation, and restore verification. Audit evidence should reference request IDs, audit IDs, timestamps, actors, affected institutions, and actions taken.
