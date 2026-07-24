# Production runbook

## Pre-deploy

1. Run `bun install --frozen-lockfile`, `bun run bootstrap:check -- --skip-port`,
   and `bun run verify`.
2. Confirm `bun run check:audit`, `bun run check:artifact-tracking`, and
   `bun run check:bundle` pass.
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
