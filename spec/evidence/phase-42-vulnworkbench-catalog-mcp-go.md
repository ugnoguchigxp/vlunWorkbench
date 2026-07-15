# Phase 42 vulnWorkbench Catalog MCP GO Decision

Date: 2026-07-15

Decision: **GO for the vulnWorkbench Catalog MCP component**

This decision covers the correctness, safety, deterministic contract, and
external stdio usability of `vuln_get_project_exploration_catalog`. It does not
decide whether a specific consumer such as NightWorkers should enable the tool
by default. Consumer activation rate, exploratory-call reduction, token
reduction, completion, and verification non-regression belong to that
consumer's rollout evaluation.

## Evidence

- The tool reads one exact persisted `scanRunId` / `generationId` pair and does
  not scan, build, or mutate the target repository.
- The external `@modelcontextprotocol/sdk` stdio client can connect, list the
  tool with `readOnlyHint: true`, and call it against a generated fixture.
- The machine-readable CLI and external MCP call return the exact same JSON
  contract for the same generation and focus.
- Repeated reads use the persisted generation timestamp, so request time does
  not make otherwise identical Catalog responses differ.
- Focus paths and returned paths remain project-relative; raw source bodies,
  fixture source markers, absolute project paths, and secrets are not returned.
- Response target and hard-cap behavior is covered without slicing JSON.
- The expanded scenario evidence contains 41 scenarios: 36 useful results, 3
  correct negatives, 1 invalid module rejection, 1 known granularity
  limitation, and 0 unexpected failures.
- The historical offline evaluation contains 10 source-changing tasks across 2
  repositories. Its recall metrics are diagnostic ranking evidence, not a
  production threshold.

## Reproducible checks

```bash
bun test ./api/modules/static-intelligence/intelligence-exploration-catalog-cli.test.ts \
  ./api/modules/static-intelligence/static-intelligence-mcp-server-cli.test.ts \
  ./api/modules/static-intelligence/exploration-catalog.test.ts \
  ./api/modules/static-intelligence/mcp-tools.test.ts \
  ./api/modules/static-intelligence/generation-repository.test.ts \
  ./api/modules/static-intelligence/evaluate-exploration-catalog-cli.test.ts
bun run verify
```

Focused result: **PASS — 37 tests, 0 failures**

Final repository verification result: **PASS — typecheck, lint, format, test,
build, and verify complete after review closeout**

## Review closeout improvements

- Bounded scan, path, and module focus string lengths at the public schema.
- Redacted secret-shaped values and project roots from verification candidates.
- Returned an exact test-path focus first while following its implementation import.
- Made rootRef discovery linear in generation count, deterministic on timestamp
  ties, sequential for artifact reads, and rejecting duplicate artifact roles.
- Kept CLI and MCP handler failure reason codes aligned without exposing storage
  paths through Catalog-unavailable messages.
- Rejected empty, duplicate-ID, and non-project-relative evaluator fixtures.
- Removed the temporary absolute worktree path from committed validation evidence.

## Related evidence

- `spec/evidence/phase-42-expanded-scenario-validation.json`
- `spec/evidence/phase-42-meaningful-catalog-validation.json`
- `spec/evidence/phase-42-offline-evaluation.json`

## Deferred consumer decision

NightWorkers integration and paired runtime value measurement are intentionally
not used as the completion gate for this component. That separate task may
produce `GO`, `NO-GO`, or `INSUFFICIENT_EVIDENCE` for NightWorkers rollout
without changing this Catalog MCP correctness decision.
