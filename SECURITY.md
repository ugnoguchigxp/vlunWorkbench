# Security Policy

## Supported versions

| Version | Status |
| --- | --- |
| `v1.0.0` | Supported |
| `main` | Development branch; not a release |

Only versions that appear in `git tag` and have same-commit clean-checkout
evidence are supported releases. An untagged package version or draft release
note is not a supported release. Older releases are unsupported unless a
release note explicitly says otherwise.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, source
snippets, or customer data. Report the issue privately to the repository
maintainers with the affected revision, reproduction steps, impact, and a
suggested remediation when available.

Maintainers should acknowledge a report within three business days, preserve
confidentiality, and coordinate a fix and disclosure timeline with the reporter.

## Secret response

Treat a discovered credential as compromised: revoke or rotate it first, then
remove it from the current tree and decide separately whether Git history must be
rewritten. Never rely on history rewriting as credential revocation.

LLM credentials stored by the application require
`LLM_SETTINGS_ENCRYPTION_KEY`. Back up that key separately from the database and
restrict access to both. A database backup without the matching key cannot
restore encrypted provider credentials.

## Release policy

A release is blocked by a known High or Critical dependency advisory, tracked
runtime artifacts, failed security-critical tests, failed database restore
verification, or a failed project-path/outbound-network authorization scenario.
Moderate exceptions require an owner, applicability statement, and expiry date.
