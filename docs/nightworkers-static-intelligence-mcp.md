# NightWorkers path-first Static Intelligence MCP handoff

NightWorkers must use only the registered repository path as the project selector. It must not persist, resolve, or send vulnWorkbench `projectId`, `scanRunId`, `generationId`, `rootRef`, or `findingId` values.

## Server configuration

Configure the vulnWorkbench MCP process with the same SQLite database and an explicit allowlist:

```env
DATABASE_URL=file:/absolute/path/to/vuln-workbench.sqlite
STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS=/absolute/workspace/root,/another/allowed/root
STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY=registered_only
```

The allowlist is fail-closed. Paths are checked with `realpath`, but the request itself must already be the canonical absolute repository root; symlink aliases, symlink escapes, files, and non-repository directories are rejected.
Project creation is also server-controlled. The default `registered_only` policy rejects unregistered repositories; requests cannot opt into creation.

## Client flow

1. Call `vuln_prepare_project_intelligence({ projectPath: registeredProject.repoPath })`.
2. Poll `vuln_get_project_intelligence_status({ projectPath })` using `retryAfterMs` until `ready`, `stale`, or `failed`.
3. On `ready`, expose a NightWorkers-owned catalog adapter whose model input is `focus` only. The adapter injects the registered `projectPath` and fixed MCP server ID.
4. Check `freshness.status` on every read and retain returned provenance only as diagnostic evidence.
5. On `not_prepared`, call the explicit prepare action. Read tools never prepare implicitly.
6. On MCP failure, fail open to the existing NightWorkers exploration path.

Finding-specific reads use `findingFingerprint`. If the response is `AMBIGUOUS_FINDING`, do not select a candidate by internal ID; surface the sanitized candidates for review.

## Controlled pilot

- Use app-managed MCP configuration.
- Keep the feature flag off by default.
- Enable only the native/API implementation lane.
- Do not change Codex SDK, planning, test, review, or general-answer lanes.
- Do not connect directly to the vulnWorkbench database.
- Keep provenance and the existing evidence ledger.
- Keep the full MCP provenance in audit evidence, but remove absolute paths and internal IDs from the model projection.
- The prepare worker is structure-only and does not replace a separately requested security scan.
- Source state is checked before and after generation build; a concurrent repository change fails the job with `SOURCE_CHANGED` instead of publishing it as ready.
- Preserve existing behavior when MCP is unavailable or preparation fails.

## Acceptance checks

```bash
bun run db:migrate
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
bun run fixture:static-intelligence-path-first
```

Captured NightWorkers requests must contain `projectPath` and optional stable domain selectors only; internal vulnWorkbench IDs are forbidden in request inputs.
