# Accessibility Testing

Qglimpse targets WCAG 2.2 AA for production-facing surfaces.

## Required surfaces

Test each release across:

- Homepage and institution interest form.
- Login, password reset, magic-link, email-code, and required-password-change flows.
- Root dashboard.
- Institution dashboard, questions, analytics, SMTP/settings controls visible by role.
- Kiosk login and kiosk guest question flow.
- Export unavailable and export error states until XLSX export is implemented.

## Manual checks

- Keyboard-only navigation reaches every interactive control in a logical order.
- Focus indicators are visible and not hidden by layout changes.
- Form controls have accessible labels or clear `aria-label` values.
- Error messages are announced near the relevant field and do not rely on color alone.
- Text and controls meet contrast requirements in all configured color schemes.
- Layout works at 320 px wide and at 200 percent browser zoom without overlapping text.
- Kiosk controls remain operable on touch devices and with large text.
- Tables, analytics cards, and export/error states expose meaningful names and values to screen readers.

## Automated checks

Run automated browser accessibility checks against a local production build before release. Recommended tools are axe DevTools, Playwright plus `@axe-core/playwright`, or an equivalent WCAG 2.2 AA scanner. Record the tool, version, tested URL, date, and unresolved issues in release evidence.

## Blocking issues

Block release for keyboard traps, missing login labels, unreadable contrast, inaccessible kiosk submission controls, overlapping text at supported viewports, or any issue that prevents a user from signing in, submitting feedback, reviewing analytics, or understanding export availability.
