# Dependency Audit and Update Workflow

## Release audit

Run this before every production deployment:

```bash
npm audit --workspaces --audit-level=high
```

High or critical advisories block release unless a documented compensating control is approved by the root operator.

## Update cadence

- Review runtime and build dependencies at least monthly.
- Apply security updates as soon as practical after validation.
- Keep Node on the supported major version declared in the root `package.json`.
- Rebuild and rerun lint, tests, database encryption tests, production config tests, and Phase 8 security tests after updates.

## Update process

1. Create a dedicated dependency-update branch.
2. Run `npm outdated --workspaces` and review release notes for security-sensitive packages.
3. Update the smallest practical set of packages.
4. Run `npm install` to refresh the lockfile.
5. Run `npm run lint`, `npm run build`, `npm test`, and `npm audit --workspaces --audit-level=high`.
6. Manually verify login, kiosk, analytics, and admin settings on a local production build.
7. Record advisory IDs, package versions, commands run, and any residual risk in release notes.
