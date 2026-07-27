# Qglimpse Subprocessors

Qglimpse has no embedded advertising, behavioural tracking, analytics, or model-training subprocessors.

## Required operational providers

| Provider category | Purpose | Data exposed | Notes |
|-------------------|---------|--------------|-------|
| Hosting provider | Runs the Node process and stores the encrypted SQLite database files. | Encrypted database files, logs, environment metadata. | Must support restricted administrative access and encrypted backup storage. |
| Cloudflare Tunnel | Public TLS termination, tunnel routing, and edge protection. | Request metadata such as IP, URL, headers, timing, and Cloudflare challenge metadata. | The origin must still enforce Qglimpse auth and institution scoping. |
| SMTP provider | Sends OTP, magic-link, password-reset, email-verification, and operational test emails. | Staff email address, message subject/body, delivery metadata. | Guest feedback content must not be included in auth emails. |
| Backup storage provider | Stores encrypted backup sets. | Encrypted database backup files and backup metadata. | Backup access must be restricted to approved root operators. |

## Optional providers

No optional production subprocessors are enabled by the application code in this release. If an operator adds monitoring, SIEM, support desk, analytics, or external export delivery, they must update this document before enabling that integration.

## Review cadence

Review subprocessors before production launch, after any hosting or email provider change, after adding export delivery, and at least annually.
