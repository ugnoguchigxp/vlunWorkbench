# Production runbook

## Pre-deploy

1. Run `bun install --frozen-lockfile`, `bun run bootstrap:check -- --skip-port`,
   and `bun run verify:strict`.
2. `verify:strict` includes the fast verification pipeline, Web/critical
   coverage, browser E2E, dependency audit, artifact tracking, and the bundle
   budget.
3. Set explicit `PROJECT_ALLOWED_ROOTS`, trusted proxy CIDRs (when applicable),
   the LLM host allowlist, and the LLM settings encryption key.
4. Create and verify a backup:

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
