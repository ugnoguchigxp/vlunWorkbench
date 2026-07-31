# Production runbook

## Pre-deploy

1. Run `bun install --frozen-lockfile`, `bun run bootstrap:check -- --skip-port`,
   and `bun run verify:strict`.
2. `verify:strict` includes the fast verification pipeline, Web/critical
   coverage, browser E2E, dependency audit, artifact tracking, and the bundle
   budget.
3. After the release commit exists, run `bun run verify:clean-checkout -- HEAD`
   to repeat frozen installation and the strict gate from a detached temporary
   worktree.
4. Set explicit `PROJECT_ALLOWED_ROOTS`, trusted proxy CIDRs (when applicable),
   the LLM host allowlist, the LLM settings encryption key, and
   `DAST_AUTH_ENCRYPTION_KEY` when authenticated DAST is enabled.
5. For a scanner-capability release, build the toolbox and run the actual
   network-disabled matrix:

   ```bash
   bun run docker:toolbox:build
   bun run verify:security-capability
   ```

   Keep `.artifacts/offline-toolbox-matrix.json` with the release evidence.
   The gate must show Semgrep, OSV-Scanner, and Trivy JSON output, the image
   digest, scanner-data manifest hash, `networkMode=none`, and the enforced
   memory/CPU/PID limits.
   Then run the pinned external capability gates:

   ```bash
   bun run security-corpora:verify
   OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
     bun run benchmark:all
   OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
     bun run verify:professional-capability
   ```

   Do not publish a `met` claim unless the generated report has every gate set
   to true and references a persisted passing benchmark run from the same
   release inputs. A successful command with below-threshold metrics is a
   completed measurement, not a passing capability.
6. Create and verify a backup:

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

Dynamic verification uses the same validated Docker defaults and hard ranges.
Every run applies memory, equal memory-swap, CPU, and PID limits, and request
options may only tighten the saved profile limits. Dynamic stdout/stderr use the
scanner byte limits and fail closed as `dynamic_output_limit_exceeded`.
Collected dynamic artifacts are also bounded to 16 MiB per file, 64 MiB total,
128 files, 16 directory levels, and 2,048 visited entries. An artifact overflow
fails closed as `dynamic_artifact_limit_exceeded`; reduce the profile output
instead of broadening these collection limits.

## Scanner data update

Scanner rules and vulnerability databases never update during a scan. Refresh
them only in an explicit build/update job:

```bash
bun run scanner-data:prepare -- /absolute/path/to/new-scanner-data
bun run docker:toolbox:build
bun run verify:security-capability
```

The preparation job downloads the official OSV archives for npm, PyPI, Go,
Maven, crates.io, NuGet, Packagist, and RubyGems plus the Trivy vulnerability
database. It validates bounded archive paths and sampled ecosystem records,
copies the owned Semgrep rules, hashes each bundle, and atomically emits
`scanner-data-manifest.json` with source references, record counts, generation
times, freshness limits, and coverage. Review all manifest and capability-result
diffs before replacing a release image. A missing, stale, or digest-mismatched
ecosystem is `not_tested`; never fall back to an online OSV update during a scan.

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

The service enforces the active-lab preconditions rather than relying on a
review checklist. Activation is one-way and requires a complete, time-bounded
Rules of Engagement record. Every request must be inside the engagement scope,
Rules of Engagement, and target scope. Transaction plans reserve enough
cumulative engagement and target request budget for seed, operation, and all
cleanup requests before the first request is sent. Auth contexts are encrypted
and bound to the same project, target, identity role, and target cookie/storage
origin. Same-project active runs are serialized.

ZAP active is additionally limited to `local` or `ephemeral` internal targets,
an explicit `runtime-zap-active-lab` or `api-zap-active-lab` request, and
`VULN_WORKBENCH_ZAP_ACTIVE_ENABLED=true`. It runs only on a Linux Docker host
where an internal bridge can isolate the ZAP container from every destination
except the bounded gateway. The active policy starts with every rule disabled
and enables only the versioned nine-rule catalog at low strength/medium
threshold. Browser login, CSRF/token refresh, public targets, shared staging,
and production targets fail closed.

Authorization matrices are read-only (`GET`, `HEAD`, or `OPTIONS`) until a
matrix-level seed and cleanup contract exists. Only 2xx responses count as
allowed; 401, 403, and 404 count as denied; redirects and all other responses
are persisted as `inconclusive`.

Cleanup runs even if seed or test requests fail. A cleanup error must leave the
run as `failed_cleanup`; an operation error with successful cleanup is
`inconclusive`. For either state, stop further active runs, snapshot the target,
reconcile seeded object IDs, run the documented cleanup/restore procedure, and
record the residual target state. Never relabel the run `completed` merely
because the diagnostic report was generated.

On startup, an interrupted state-changing transaction is persisted as
`failed_cleanup` with `interrupted_cleanup_state_unknown`; an interrupted
read-only matrix is persisted as `inconclusive`. The related scan is failed in
both cases so automated reports cannot present an interrupted run as complete.
Interrupted business-logic runs are likewise closed as `failed_cleanup`; the
project remains blocked from new business-logic execution until the target
state is reconciled. Automatically generated state-changing scenarios require
an explicit cleanup method and path, and irreversible external side effects
must be represented as `not_tested`.

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
