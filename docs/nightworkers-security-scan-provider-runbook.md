# NightWorkers security scan provider runbook

## Scope

vulnWorkbench exposes the versioned provider API at:

```text
/api/integrations/nightworkers/v1
```

The route is disabled by default. It uses a dedicated bearer credential and does
not accept the browser session cookie as integration authorization.

## Database migration

Back up the database, then apply migrations before enabling the route:

```bash
bun run backup:create
bun run db:migrate
```

Migration `0017_nightworkers_security_scan_provider.sql` adds integration
credentials, resource bindings, preview/idempotency/audit storage, monotonic
scan event sequence fields, and asynchronous report lifecycle fields.

## Configuration

Required rollout settings:

```dotenv
NIGHTWORKERS_INTEGRATION_ENABLED=true
PROJECT_ALLOWED_ROOTS=/absolute/path/to/approved/projects
NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES=source-baseline,diff-source-baseline,diff-basic-security,basic-security,detailed-security
```

Security-sensitive defaults:

| Setting | Default |
| --- | ---: |
| `NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS` | `false` |
| `NIGHTWORKERS_INTEGRATION_PREVIEW_TTL_SECONDS` | `300` |
| `NIGHTWORKERS_INTEGRATION_IDEMPOTENCY_TTL_HOURS` | `168` |
| `NIGHTWORKERS_INTEGRATION_MAX_CONCURRENT_SCANS` | `2` |
| `NIGHTWORKERS_INTEGRATION_MAX_FINDING_PAGE_SIZE` | `100` |
| `NIGHTWORKERS_INTEGRATION_MAX_EVENT_PAGE_SIZE` | `200` |
| `NIGHTWORKERS_INTEGRATION_MAX_REPORT_BYTES` | `5242880` |
| `NIGHTWORKERS_INTEGRATION_MAX_REQUEST_BYTES` | `65536` |
| `NIGHTWORKERS_REPORT_RUNNER_CONCURRENCY` | `2` |

In production, keep auto-create disabled unless the project-registration policy
has been reviewed. Both `PROJECT_ALLOWED_ROOTS` and each credential's
`--allowed-root` are enforced; an empty client root list does not broaden the
global allowlist.

## Credential operations

Create a client for an existing vulnWorkbench user:

```bash
bun run integration:client create \
  --name nightworkers-production \
  --owner-user <user-id> \
  --scope nightworkers:security-scan:read \
  --scope nightworkers:security-scan:write \
  --scope nightworkers:security-report:read \
  --scope nightworkers:security-report:write \
  --allowed-root /absolute/path/to/approved/projects
```

The plaintext token is printed once. Store it in the NightWorkers OS secret
store; vulnWorkbench stores only its hash and a lookup prefix.

```bash
bun run integration:client list
bun run integration:client rotate --id <client-id>
bun run integration:client revoke --id <client-id>
```

Rotation preserves the client ID, resource bindings, and idempotency history.
Revocation rejects subsequent requests immediately.

## Canary rollout

1. Apply the database migration with the provider route disabled.
2. Restart vulnWorkbench and confirm normal user-facing scan/report routes.
3. Create a read-only canary credential with only
   `nightworkers:security-scan:read`.
4. Enable the route and verify `POST /capabilities` and
   `POST /scans/preview`.
5. Add scan write scope and exercise `quick`, then `standard`, against a
   disposable registered repository.
6. Confirm event sequence pagination, terminal outcome/coverage, finding
   redaction, and cancellation.
7. Add report read/write scopes and verify asynchronous report generation and
   Markdown integrity metadata.
8. Restart both processes and confirm the same opaque refs remain readable.

## Compatibility matrix

| Consumer | Provider contract | Supported operations |
| --- | --- | --- |
| NightWorkers canary | v1 | capabilities, preview, quick/standard scan |
| NightWorkers full rollout | v1 | deep/custom scan and asynchronous report |
| vulnWorkbench Web/CLI | existing user API | unchanged; integration bearer tokens are rejected |

The v1 provider treats unknown request fields and enum values as invalid.
Consumers must use the `contractVersion: 1` response envelope and must not
depend on internal database columns.

## Monitoring and invariant checks

The normal structured `http_request` log supplies request count, status, and
latency by integration path without logging request or response bodies. Audit
rows supply operation outcome and replay correlation.

After a canary, verify event and idempotency invariants:

```bash
sqlite3 data/vuln-workbench.sqlite "
SELECT scan_run_id, COUNT(*) AS events, COUNT(DISTINCT seq) AS distinct_seq,
       MIN(seq) AS first_seq, MAX(seq) AS last_seq
FROM scan_events
GROUP BY scan_run_id
HAVING events <> distinct_seq OR first_seq <> 1 OR last_seq <> events;"

sqlite3 data/vuln-workbench.sqlite "
SELECT integration_client_id, operation, idempotency_key, COUNT(*)
FROM integration_idempotency_keys
GROUP BY integration_client_id, operation, idempotency_key
HAVING COUNT(*) > 1;"
```

Both queries must return no rows. Also inspect recent operation outcomes:

```bash
sqlite3 data/vuln-workbench.sqlite "
SELECT operation, outcome, error_code, COUNT(*)
FROM integration_audit_logs
GROUP BY operation, outcome, error_code
ORDER BY operation, outcome;"
```

## Disable and rollback

Set `NIGHTWORKERS_INTEGRATION_ENABLED=false` and restart to remove the provider
route without deleting scan/report history. Revoke affected credentials if a
token may be exposed.

As a revoke drill, revoke the canary client and confirm its next request returns
`integration_unauthorized`; do not rotate a revoked client. Create a new client
when re-enabling access after an incident.

Database rollback should normally restore the pre-migration backup. Do not drop
integration tables while scans or reports created through the provider still
need to be resolved. Existing user-facing scan/report endpoints remain separate
from the feature-flagged provider route.

## Incident checks

- Authentication and scope failures return a versioned structured error without
  token or path disclosure.
- Side-effect operations record client, owner, scope, request ID, project ref,
  hashed path/idempotency key, resource ref, and outcome in
  `integration_audit_logs`.
- `scan_events.seq` is the resume cursor. Consumers must treat `afterSeq` as
  exclusive and continue until `hasMore` is false.
- A scan result of `no_findings` is not a safety attestation. Coverage gaps
  force `inconclusive`.
- Report Markdown is available only after `completed`; stored size and SHA-256
  are verified before download.
