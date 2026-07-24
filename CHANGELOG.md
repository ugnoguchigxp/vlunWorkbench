# Changelog

## Unreleased

### Security

- Enforce canonical allowed-root authorization when registering and executing
  host project scans, and restrict the folder picker to administrators.
- Restrict global LLM administration and shared-source mutations to
  administrators.
- Add provider-host allowlisting, DNS/IP validation, redirect revalidation, and
  environment-credential identity binding for outbound LLM requests.
- Encrypt stored LLM API keys with AES-256-GCM and provide an explicit legacy
  secret migration command.
- Trust forwarding headers only from configured proxy CIDRs, add a normalized
  email login limiter, and enforce a production Content Security Policy.
- Upgrade or override audited dependency trees to patched versions.
- Stop tracking generated runtime artifacts while preserving local files.

### Release engineering

- Add complete test inventory, isolated API test processes, frozen dependency
  installation, audit/artifact/bundle gates, Dependabot, and CI verification.
- Lazy-load major frontend domains and enforce initial bundle budgets.
