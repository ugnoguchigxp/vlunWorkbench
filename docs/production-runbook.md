# Production runbook

## Pre-deploy

1. Run `bun install --frozen-lockfile`, `bun run bootstrap:check -- --skip-port`,
   and `bun run verify:strict`.
2. `verify:strict` includes the fast verification pipeline, Web/critical
   coverage, browser E2E, dependency audit, artifact tracking, and the bundle
   budget.
3. Set explicit `PROJECT_ALLOWED_ROOTS`, trusted proxy CIDRs (when applicable),
   the LLM host allowlist, the LLM settings encryption key, and
   `DAST_AUTH_ENCRYPTION_KEY` when authenticated DAST is enabled.
4. For a scanner-capability release, build the toolbox and run the actual
   network-disabled matrix:

   ```bash
   bun run docker:toolbox:build
   bun run verify:security-capability
   ```

   Keep `.artifacts/offline-toolbox-matrix.json` with the release evidence.
   The gate must show Semgrep, OSV-Scanner, and Trivy JSON output, the image
   digest, scanner-data manifest hash, `networkMode=none`, and the enforced
   memory/CPU/PID limits.
5. Create and verify a backup:

   ```bash
   bun run backup:create -- --output /secure/backups/pre-deploy.sqlite
   bun run backup:verify -- --input /secure/backups/pre-deploy.sqlite
   ```

The backup command is serialized by the SQLite Writer and uses `VACUUM INTO`;
it does not copy a live WAL database file. Store the matching
`LLM_SETTINGS_ENCRYPTION_KEY` in a separate protected secret backup.

Legacy LLM plaintext cleanup also requires an already-unused backup output path:

```bash
bun run llm-secrets:migrate -- --backup-output /secure/backups/pre-secret-migration.sqlite
```

The command verifies encryption for every row, creates and verifies the backup,
then updates every legacy row in one Writer transaction.

## Scanner resource boundaries

Production Docker scans always include `--memory`, equal `--memory-swap`,
`--cpus`, and `--pids-limit` values. Defaults are 4 GiB, 2 CPUs, and 512 PIDs.
Override them only within the validated ranges documented in the README.

Scanner stdout, stderr, and structured result files are bounded before parsing.
An overflow fails the tool run with `tool_output_limit_exceeded` (or
`tool_stderr_limit_exceeded`), records the termination reason in execution
metadata, and force-cleans a Docker container when necessary. Do not raise the
hard limits to make a noisy or adversarial target pass; investigate the tool
configuration and target scope first.

## Scanner data update

Scanner rules and vulnerability databases never update during a scan. Refresh
them only in an explicit build/update job:

```bash
bun run scanner-data:prepare -- /absolute/path/to/new-scanner-data
bun run docker:toolbox:build
bun run verify:security-capability
```

The preparation job downloads the OSV npm offline database and Trivy
vulnerability database, copies the owned Semgrep rules, hashes each tree, and
emits `scanner-data-manifest.json` with source references, generation times,
freshness limits, and coverage. Review all manifest and capability-result diffs
before replacing a release image. OSV coverage is currently npm-only; report
other ecosystems as `not_tested`, not as passed.

Do not copy an unverified host cache into a release image. If data is stale or
missing, keep the affected scanner unavailable or mark report readiness
`ready_with_limitations`; never silently fall back to a network update.

## Authenticated DAST credential rotation

Authenticated DAST uses an encrypted auth-context reference. API responses,
plans, events, logs, and artifacts contain only redacted metadata. The secret is
decrypted immediately before request injection and is bound by AES-256-GCM AAD
to the project, target, identity role, and auth kind.

Rotate a context through its project-scoped rotate endpoint, verify one
read-only run, and then revoke the old credential at the upstream identity
provider. Revoked or expired contexts fail before a request is sent. When
rotating the encryption key, deploy the new
`DAST_AUTH_ENCRYPTION_KEY` with the old key in
`DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS`, rotate every stored context, verify the
credential-canary suite, then remove the old key.

If a credential may have leaked, revoke it upstream first, revoke the stored
context, preserve only redacted audit metadata, and quarantine affected
artifacts. Do not paste credentials into `defaultHeadersJson`, scan options, or
incident notes.

## Rules of Engagement and active-lab incidents

State-changing checks are not part of the default scan. They require an active,
unexpired engagement for the same project, a `local`, `ephemeral`, or
`staging` environment, a non-public target, and explicit path, method, request,
rate, and cleanup contracts. Production and public targets fail closed. LLM
output cannot create or broaden this authorization.

Before an active-lab run:

1. Confirm the target is disposable and restoreable.
2. Activate a time-bounded Rules of Engagement record.
3. Verify each state-changing transaction has declarative seed and cleanup
   requests and remains inside the server request budget.
4. Confirm all required test identities are dedicated, least-privileged, and
   represented by encrypted auth contexts.

Cleanup runs even if seed or test requests fail. A cleanup error must leave the
run as `failed_cleanup`; an operation error with successful cleanup is
`inconclusive`. For either state, stop further active runs, snapshot the target,
reconcile seeded object IDs, run the documented cleanup/restore procedure, and
record the residual target state. Never relabel the run `completed` merely
because the diagnostic report was generated.

## Automated diagnostic recovery

Every completed scan starts deterministic report generation and, when a route
is configured, evidence-constrained scan-level LLM review. Missing or invalid
LLM output must still produce a deterministic report with
`ready_with_limitations` and a machine-readable limitation code. Human
decision, peer approval, and manual finding review are not completion gates.

Use `POST /api/scans/:scanRunId/diagnostics/retry` only for a failed or limited
LLM/report stage. Retry is idempotent for the same scan snapshot and preserves
the input hash, scanner-provenance hash, attempt count, prior report revisions,
and prior review records. First verify the LLM route and outbound host policy;
do not delete the deterministic report or scanner evidence to force a retry.

## Upgrade

Stop application processes, allow the SQLite Writer to drain, deploy the new
application, run `bun run db:migrate`, then start the application and verify
liveness at `/api/health` and readiness at `/api/health/ready`. Writer protocol
upgrades require every old process and Writer instance to be restarted together.

## Rollback

Do not roll back across an incompatible migration or after plaintext secret
cleanup unless the previous application supports the current schema and the
database/key backup pair has passed verification. Restore into an isolated
temporary location first, run `backup:verify`, then point the stopped
application at the restored database.

## Retention and incident handling

Keep application logs, scan artifacts, and database backups according to the
deployment's data classification and retention policy. Never place them in Git.
Rotate credentials before history remediation. Preserve security event metadata
without logging authorization headers, cookies, API keys, source snippets, or
unnecessary absolute paths.

The SQLite Writer transport is supported on Unix-like platforms. Windows named
pipe transport is not currently supported.
