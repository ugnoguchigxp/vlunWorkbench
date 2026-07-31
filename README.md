# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-%23E36022.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE.md)

English | [日本語](README.jp.md)

vulnWorkbench is a local vulnerability workbench that automatically turns scanner output into evidence-backed diagnostic results and implementation-ready reports.

The product is not designed around an LLM freely browsing a repository and inventing findings. Heavy evidence generation stays in CLI scanners, sandboxed reproduction, dynamic checks, and DAST. When a scan completes, an automatic pipeline preserves the deterministic scanner facts, evaluates each saved finding with an evidence-constrained LLM, and emits a consolidated Markdown report. The LLM output includes criticality, false-positive likelihood, exploitability, business impact, priority, remediation, evidence references, assumptions, unknowns, and an implementation handoff.

Human `Decision` records still exist as optional compatibility and audit annotations. They are never required to complete diagnosis, review, report generation, retry, or export. The main path is:

```text
local project
  -> CLI scanners / reproduction / dynamic / DAST
  -> normalized findings, evidence, artifacts, events
  -> deterministic consolidated report
  -> automatic evidence-constrained LLM criticality assessment
  -> final Markdown report / implementation handoff
```

If the LLM route is unavailable or its structured output is rejected, the deterministic report still completes with explicit limitation codes. Authorization, active-scan permission, credentials, network policy, and resource limits remain server-enforced safety controls; they are not delegated to the LLM.

This is not a complete replacement for a professional penetration test. The
versioned Phase 50 baseline contains 45 offline Semgrep rules across five
languages, prepared OSV databases for eight ecosystems, explicit disposable
target ZAP active profiles, deterministic application/threat models, and
bounded business-logic scenarios. The current measured capability claim is
still `not_met`: the pinned OWASP Benchmark run measured recall `0.7088`,
precision `0.6946`, and false-positive rate `0.3121`, while the pinned Juice
Shop catalog has 20 eligible scenarios but no executable observations yet.
Authenticated checks cover only configured routes, identities, objects, and
operations. Network, cloud, AD, mobile, wireless, social engineering, browser
authentication, production active attacks, and unrestricted fuzzing remain
experimental or outside the product boundary.

vulnWorkbench also acts as a Static Intelligence source for adjacent coding-agent systems. It exposes scanner-backed diagnostic evidence, lightweight code structure facts, file risk, semantic candidates, risk communities, guardrail material, and read-only MCP tools. This is still a source layer: NightWorkers owns ontology, task compilation, queue admission, implementation, and verification orchestration; contextStill owns generalized knowledge, reusable procedures, and retrieval.

## What It Does

- Registers local repositories as projects.
- Runs Semgrep, Gitleaks, OSV, Trivy, scan profiles, DAST, reproduction, and dynamic verification through bounded CLI paths.
- Stores raw artifacts, normalized findings, evidence, scan events, reviews, reports, and diagnostics in local SQLite.
- Builds scan review bundles from saved data only.
- Uses configured LLM task routes for finding review, scan review, and report summaries.
- Automatically runs scan-level criticality assessment and final report generation after a successful scan.
- Produces a scan-level `improvementRequest` / handoff prompt for implementation work.
- Shows decision-grade signals: executive risk summary, workflow completion, evidence quality, scan comparison, report readiness, zero-finding coverage, and action queue.
- Exports Markdown reports with deterministic sections and optional LLM summary.
- Builds Static Intelligence exports, agent-query bundles, semantic search indexes, risk communities, security landscape summaries, and guardrail material from saved diagnostic evidence.
- Extracts redacted lightweight code structure snapshots for TypeScript/JavaScript projects: files, imports, exports, package edges, and route/handler/schema/worker/test/config tags.
- Serves a read-only Static Intelligence MCP surface for discovery, manifests, evidence bundles, verification command candidates, guardrail material, and code structure snapshots.

## Product Boundary

vulnWorkbench intentionally separates evidence generation from LLM interpretation.

| Area | Responsibility |
| --- | --- |
| CLI tools | Generate scanner output, logs, artifacts, and deterministic evidence. |
| Normalizers | Convert tool output into stable findings and evidence records. |
| Reproduction / dynamic / DAST | Add bounded runtime confirmation signals. |
| LLM review | Automatically assess criticality and remediation from saved evidence, and create implementation handoff instructions. |
| Static Intelligence | Expose scanner-backed evidence, code structure facts, semantic candidates, communities, landscape, and guardrail material as read models. |
| Read-only MCP | Let external agents discover and fetch Static Intelligence bundles without DB table access, scanner execution, verification execution, or contextStill mutation. |
| Reports | Package risk, evidence quality, handoff status, verification, and coverage into Markdown. |
| Human Decision | Optional compatibility/audit record, not a required triage gate. |

Non-goals:

- LLM-driven free-form repository auditing.
- Automatic patch application.
- External approval workflows.
- Treating zero findings as proof of safety.
- Treating missing human `Decision` records as the normal blocker when a scan-level LLM handoff exists.
- Treating code structure facts, semantic similarity, or LLM review text as confirmed vulnerability evidence without scanner, artifact, reproduction, or verification support.
- Using MCP as a write path for contextStill registration, NightWorkers task creation, scanner execution, or verification command execution.
- Claiming professional-assessment equivalence without external corpus metrics
  and explicit coverage of the target's business workflows.

## Main UI Workflow

1. Register a local project.
2. Run a static scan profile or individual scanner.
3. Wait for the automatic deterministic report and evidence-constrained LLM diagnosis.
4. Inspect findings, evidence, scanner artifacts, criticality, business impact, remediation, assumptions, unknowns, and limitation codes.
5. Inspect the generated handoff quality checks:
   - objective
   - scope
   - finding references or zero-finding coverage scope
   - implementation tasks
   - acceptance criteria
   - verification commands
   - non-goals
   - saved-context limitation
6. Use the handoff prompt directly, or export the consolidated Markdown report.
7. Check automatic diagnostic readiness:
   - `ready`
   - `ready_with_limitations`
   - `failed`
8. Retry only failed or limited LLM/report stages when necessary.
9. The legacy report readiness view may also show:
   - `submission_ready`
   - `internal_review`
   - `incomplete`
Manual finding review and `Decision` records are optional annotations and do not block this workflow. Report controls may still include compatibility filters for those annotations.

## Quick Start

The intended fresh-clone path is:

```bash
bun install
bun run bootstrap
bun run dev
```

`bun run bootstrap` creates `.env` from `.env.example` when needed, applies SQLite migrations, creates or confirms the local admin user, and prints the login URL and credentials. It keeps an existing admin password unchanged by default on repeat runs.

The dev server runs at:

```text
http://localhost:29831
```

To reset the local admin password during bootstrap:

```bash
bun run bootstrap -- --reset-admin-password
```

To inspect local readiness after bootstrap:

```bash
bun run bootstrap:check
```

Manual setup remains available when you need more control:

```bash
cp .env.example .env
bun run db:migrate
bun run db:seed
```

`bun run db:seed` creates or updates the local admin user `admin@example.com`. If no password is supplied, it prints a generated password in JSON.

```bash
SEED_ADMIN_PASSWORD='<password>' bun run db:seed
printf '%s\n' '<password>' | bun run db:seed -- --password-stdin
bun run db:seed -- --keep-existing-password
```

### SQLite Writer process

File-backed SQLite writes are serialized by one Writer process per database. The Web server, CLI commands, and worker processes keep their own read-only connections, but every Drizzle `insert`, `update`, and `delete` goes through the Writer client over a local Unix socket. The client starts the Writer lazily on the first mutation; it is also possible to run it explicitly with `bun run db:writer`. Migrations use the same Writer boundary.

The database file is guarded by a process lock, so a second Writer fails instead of opening another writable connection. Normal Writer requests accept mutation statements only; reads remain local and migration DDL is limited to the migration operation. Use `bun run db:writer:health` to inspect the active instance and `bun run db:boundary` to check that production code has not introduced another SQLite write path.

If the Writer is unavailable, mutations fail without falling back to a direct connection. A client removes a stale lock when the recorded process no longer exists; it also recovers an ownerless lock after five seconds. Before manually removing `<database-path>.writer-lock`, use the health command and OS process inspection to confirm that no Writer is alive.

Restart the Writer when upgrading across a Writer protocol version; clients reject an older live Writer instead of guessing compatibility. Migration history records a SHA-256 checksum and rejects later changes to an already-applied migration file.

## LLM Routing

LLM work is task-routed. The important tasks are:

| Task | Used For |
| --- | --- |
| `finding_review` | Review one finding and its saved evidence. |
| `scan_review` | Produce scan-level risk summary and implementation handoff. |
| `report_summary` | Add optional LLM summary to a generated report. |

Settings can be configured from the UI or repaired from the CLI:

```bash
bun run api/cli/llm-route-repair.ts -- \
  --provider <provider-endpoint-id> \
  --model <model-name> \
  --tasks finding_review,scan_review,report_summary
```

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite database path. Defaults to `file:./data/vuln-workbench.sqlite`. |
| `JWT_SECRET` | JWT signing secret. Must be changed for production. |
| `APP_URL` | Public app origin and cookie/CORS basis. |
| `CORS_ORIGINS` | Additional allowed origins. |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint. |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key. |
| `AZURE_OPENAI_DEPLOYMENT` | Default Azure chat deployment. |
| `OPENAI_API_KEY` | OpenAI-compatible provider key. |
| `OPENAI_BASE_URL` | OpenAI-compatible provider base URL. |
| `CODEX_SDK_TIMEOUT_MS` | Codex SDK review/report timeout in milliseconds. Defaults to `600000`. |
| `SCAN_EXECUTION_MODE` | Central scanner runner policy: `host` or `docker`. Development defaults to host; production defaults to Docker. |
| `ALLOW_HOST_SCANNER_EXECUTION` | Explicitly permits host scanner execution. Production defaults to `false`. |
| `SCAN_DOCKER_IMAGE` | Toolbox image used by the Docker scanner policy. |
| `VULN_WORKBENCH_DOCKER_MEMORY` | Per-scanner container memory limit. Defaults to `4g`; accepted range is 512 MiB–8 GiB. |
| `VULN_WORKBENCH_DOCKER_CPUS` | Per-scanner container CPU limit. Defaults to `2`; accepted range is 0.25–4. |
| `VULN_WORKBENCH_DOCKER_PIDS_LIMIT` | Per-scanner container PID limit. Defaults to `512`; accepted range is 64–1024. |
| `VULN_WORKBENCH_SCANNER_STDOUT_LIMIT_BYTES` | Scanner stdout and structured-output limit. Defaults to 64 MiB; hard maximum is 256 MiB. |
| `VULN_WORKBENCH_SCANNER_STDERR_LIMIT_BYTES` | Scanner stderr limit. Defaults to 8 MiB; hard maximum is 32 MiB. |
| `PROJECT_ALLOWED_ROOTS` | Comma-separated roots available to Web/API project registration and scans. Development defaults to the current working directory; production is fail-closed when unset. |
| `VULN_WORKBENCH_CURATED_SAST_ENABLED` | Enables the curated SAST capability. Defaults to `false`. |
| `VULN_WORKBENCH_MULTI_ECOSYSTEM_OSV_ENABLED` | Enables the prepared eight-ecosystem OSV capability. Defaults to `false`. |
| `VULN_WORKBENCH_ZAP_ACTIVE_ENABLED` | Enables explicit disposable-target ZAP active runs. Defaults to `false`. |
| `VULN_WORKBENCH_THREAT_MODEL_ENABLED` | Enables application-model and threat-hypothesis generation. Defaults to `false`. |
| `VULN_WORKBENCH_BUSINESS_LOGIC_ENABLED` | Enables bounded business-logic scenario generation and execution. Defaults to `false`. |
| `VULN_WORKBENCH_DAST_STANDARD_V2_ENABLED` | Enables coverage-aware standard DAST profiles. Defaults to `true`; set to `false` to reject explicit v2 runs. |
| `VULN_WORKBENCH_DAST_STANDARD_V2_DEFAULT` | Makes `web-passive-standard` the default profile step. Defaults to `true`; set both DAST v2 flags to `false` for the legacy smoke rollback. |

LLM API keys stay on the host side. Scanner containers and target projects should not receive LLM credentials. Docker scans always apply memory, CPU, memory-swap, and PID limits; stdout, stderr, and structured result files are rejected when their configured byte limit is exceeded. Dynamic verification inherits the same Docker and stream limits, permits request-time resource overrides only when they tighten the saved profile, and bounds collected artifacts to 16 MiB per file, 64 MiB total, 128 files, 16 directory levels, and 2,048 visited entries.

## CLI Workflows

### Security Oracle for External Agents

External orchestrators should pass a repository path, not a foreign database ID.
The CLI resolves or creates the vulnWorkbench project and returns one JSON object
on stdout.
The external contract is intentionally path-only: scan profile, review policy,
output format, and timeout are chosen by vulnWorkbench, not supplied by the
caller.

After a usable scan, the Oracle attempts the configured `scan_review` route and
returns its persisted handoff prompt as `review.improvementRequest`. Missing or
failed review routing produces `inconclusive` rather than a false success. High
or critical findings still take precedence as `security_action_required`.

```bash
bun run oracle:security -- --project-path /path/to/repo
```

### Profile Scan

Scans started from the Web UI are admitted as `queued` and return HTTP 202.
The UI polls the persisted scan state and supports cancellation; terminal state
in `scan_runs` is authoritative. Server restart recovery marks stale Web-owned
queued/running scans failed and does not rewrite independently launched CLI scans.

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile baseline \
  --timeout-sec 600 \
  --report-output report.md
```

Direct CLI scans run the automatic diagnostic by default. `--report-output`
therefore receives the LLM-enriched report when the LLM succeeds, or the
deterministic report with recorded limitations when it does not. Use
`--automated-diagnostic false` only for a deliberately scanner-only run.

`baseline` runs the basic static profile. For broader static coverage:

```bash
bun run scan:profile -- \
  --project-id <project-id> \
  --profile detailed-security \
  --timeout-sec 1200 \
  --report-output detailed-report.md
```

Phase 41 focused profiles add bounded coverage without changing the target repository:

```bash
bun run scan:profile -- --project-path /path/to/repo --profile runtime-web-safe --json
bun run scan:profile -- --project-path /path/to/repo --profile sbom-inventory --json
bun run scan:profile -- --project-path /path/to/repo --profile api-schema-readonly --json
bun run scan:profile -- --project-path /path/to/repo --profile container-image-security --image-ref local/app:tag --json
```

`full-security-scan` runs the existing static tools, CycloneDX SBOM, coverage-aware Web Passive Standard DAST, Nuclei safe, ZAP baseline, and Schemathesis only when a schema is discovered. Nuclei uses the pinned safe template set; ZAP is Docker-only passive baseline through a bounded local gateway; Schemathesis sends no credentials and limits methods to GET/HEAD/OPTIONS. The planned runtime allocations are bounded to 250 requests in total. Missing schema, failed transport, authentication failure, or budget exhaustion is reported as a coverage gap or limitation, not as “no vulnerabilities.”

For a standalone ZAP run, use `bun run scan:zap-baseline -- --project-path /path/to/local-project --create-project true --json`. It uses the pinned `zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2` image (ZAP `2.17.0`), sends at most 20 target requests at 2 requests/second by default, and returns a non-zero CLI status when the ZAP execution or target preflight fails. ZAP Baseline spiders passive GET/HEAD resources; it does not run active attacks or authenticated scans.

### Individual Scanners

```bash
bun run scan:semgrep -- --project-id <project-id>
bun run scan:gitleaks -- --project-id <project-id>
bun run scan:osv -- --project-id <project-id>
bun run scan:trivy -- --project-id <project-id>
bun run scan:sbom -- --project-id <project-id>
bun run scan:trivy-image -- --project-id <project-id> --image-ref local/app:tag
```

Semgrep uses the repository-owned, tree-hashed `curated-sast-v1` catalog by
default: 45 rules, five languages, and at least six security families per
language. Its release fixtures contain 90 positive and 90 negative annotations.
Pass `--config auto` only for an exploratory registry run; that run is recorded
as non-reproducible and the automatic report remains ready with limitations.

### Measured security capability

Prepare and verify the pinned corpora and offline scanner data before running
the external gates:

```bash
bun run scanner-data:prepare -- .cache/scanner-data/phase-50
bun run security-corpora:prepare
bun run security-corpora:verify
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run benchmark:all
OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=.cache/scanner-data/phase-50/osv \
  bun run verify:professional-capability
```

`verify:professional-capability` writes
`.artifacts/professional-capability-release-report.json`. A claim can become
`met` only when every gate passes and
`VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID` contains a persisted passing run UUID.
Missing observations, a null denominator, stale/tampered data, cleanup failure,
or a missing passing run keeps the claim `not_met`.

ZAP active runs are never added to default profiles. They require the explicit
`runtime-zap-active-lab` or `api-zap-active-lab` profile, the feature flag, an
active internal Rules of Engagement record, a local/ephemeral private target,
exact method/path budgets, and a reset contract. The runner uses a Linux Docker
internal network and a gateway that injects credentials without returning them
to ZAP. Browser login/token-refresh flows and production targets are not
supported.

### Scan Review / Handoff

```bash
bun run review:scan -- \
  --scan-run-id <scan-run-id> \
  --task scan_review
```

The scan review stores structured output in `scan_reviews.output`, including `improvementRequest`.

The UI supports handoff scopes:

- all findings
- high / critical
- weak or missing evidence
- new or regressed

### Reproduction

```bash
bun run repro:finding -- \
  --finding-id <finding-id> \
  --profile gitleaks-recheck
```

### Dynamic Verification

```bash
bun run dynamic:run -- \
  --project-id <project-id> \
  --profile bun-test
```

### DAST

Auto-target mode starts a local target from project metadata when possible:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --profile web-passive-standard \
  --auto-target true
```

Saved target mode:

```bash
bun run scan:dast -- \
  --project-id <project-id> \
  --target-config-id <target-config-id> \
  --profile web-passive-standard
```

Standard DAST builds a same-origin route inventory from configured, source,
OpenAPI, HTML, redirect, and common-probe seeds. It enforces depth, request,
response-byte, and duration limits. Execution status, verdict, and coverage are
separate: zero findings becomes `no_findings_observed` only when coverage is
`covered`; otherwise it is `inconclusive` or `not_tested`. Legacy
`http-baseline` remains available only when explicitly selected.

Authenticated read-only runs use
`--profile authenticated-readonly-standard --auth-context-id <id>
--identity-role <role>`. The saved context must include a URL, selector, or
status success assertion. Credentials are encrypted and never returned by the
read API. Run the owned vulnerable/fixed capability gate with:

```bash
bun run verify:phase-51-baseline
bun run verify:dast-capability
```

### Report Export

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --title "セキュリティレポート" \
  --summary-mode deterministic \
  --output report.md
```

With LLM summary:

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --summary-mode deterministic_with_llm_summary \
  --output report-with-summary.md
```

Report inclusion controls:

```bash
--include-false-positives true|false
--include-deferred true|false
--include-undecided true|false
```

### Static Intelligence

Static Intelligence commands are the CLI-first source contract for coding agents and sibling systems.

Build the primary persisted generation for a registered scan. This creates a
versioned code-structure snapshot and Static Intelligence export under one
`generationId`; Project Intelligence, manifest, and MCP reads resolve that same
generation.

```bash
bun run intelligence:build -- \
  --scan-run-id <scan-run-id> \
  --include-semantic false \
  --pretty true
```

The Project Intelligence view can refresh this derived generation for the
selected scan. Refresh does not run scanners, reviews, verification commands,
reports, context registration, or task creation.

Export scanner-backed evidence and file risk:

```bash
bun run intelligence:export -- --scan-run-id <scan-run-id>
```

Extract the current Project Structure snapshot:

```bash
bun run intelligence:project-structure -- \
  --project-path <project-path> \
  --output project-structure.json
```

Use agent-facing query bundles:

```bash
bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind project_overview

bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind evidence_bundle \
  --finding-id <finding-id>

bun run intelligence:agent-query -- \
  --scan-run-id <scan-run-id> \
  --kind verification_commands
```

Discover candidate knowledge sources and guardrail material:

```bash
bun run intelligence:knowledge-source -- --scan-run-id <scan-run-id>
bun run intelligence:guardrail-material -- --scan-run-id <scan-run-id>
```

Query the same persisted project-exploration catalog contract used by MCP,
without an LLM or MCP client:

```bash
bun run intelligence:exploration-catalog -- \
  --scan-run-id <scan-run-id> \
  --generation-id <generation-id> \
  --path api/routes/example.ts \
  --term routing \
  --term schema
```

Repeat `--path`, `--module-id`, or `--term` to add focus values. The command
writes one machine-readable JSON result to stdout and does not scan or mutate
the repository.

Run the Static Intelligence MCP wrapper:

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

Set `STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS` to a comma-separated list of absolute parent directories that MCP may access. An empty value is fail-closed.
`STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY` defaults to `registered_only`; use `create_within_allowed_roots` only in an explicitly controlled fixture or onboarding environment. MCP requests cannot override this policy.

The only side-effecting action is:

- `vuln_prepare_project_intelligence({ projectPath })`

It queues a durable prepare job; a background worker publishes a structure-only source record and Static Intelligence generation without starting Semgrep, Gitleaks, OSV, Trivy, or other external security scanners. Concurrent requests for the same canonical path and source fingerprint share one job, and fresh generations are reused.

All remaining tools are read-only queries:

- `vuln_get_project_intelligence_status`
- `vuln_list_knowledge_sources`
- `vuln_get_knowledge_source_manifest`
- `vuln_get_guardrail_material`
- `vuln_get_evidence_bundle`
- `vuln_get_verification_commands`
- `vuln_get_project_structure_snapshot`
- `vuln_get_project_exploration_catalog`

Path-first queries require a strict canonical `{ projectPath }` input; symlink aliases and internal ID selectors are rejected. A current-source read selects the exact generation recorded by the ready prepare job, while an older latest generation is exposed only as `stale`. When no generation exists the query returns `not_prepared` and the next action without creating projects, scans, jobs, or generations. NightWorkers may use the returned project-relative clues in a separate Git worktree only after verifying that the registered root and worktree are clean at the same `HEAD`; MCP requests always keep the registered canonical `projectPath`. Finding reads use `projectPath + findingFingerprint`; duplicate fingerprints return `AMBIGUOUS_FINDING`.

The catalog accepts optional `focus.paths`, `focus.modules`, and `focus.terms` and returns deterministic bounded candidates without source bodies. See the [NightWorkers path-first MCP handoff](docs/nightworkers-static-intelligence-mcp.md) for operational requirements.

## API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `POST` | `/api/auth/login` | Login and set httpOnly cookies. |
| `POST` | `/api/auth/refresh` | Refresh token rotation. |
| `GET` | `/api/auth/me` | Current user. |
| `GET` | `/api/projects` | List projects. |
| `POST` | `/api/projects` | Register local repository project. |
| `POST` | `/api/projects/:projectId/scans` | Run scan profile from the app. |
| `GET` | `/api/scans?projectId=<id>` | List scan runs. |
| `GET` | `/api/scans/:scanRunId` | Scan run detail. |
| `GET` | `/api/scans/:scanRunId/findings` | Findings with latest review/decision metadata. |
| `GET` | `/api/scans/:scanRunId/artifacts` | Scan artifacts. |
| `GET` | `/api/scans/:scanRunId/reviews` | Scan-level reviews and handoff output. |
| `POST` | `/api/scans/:scanRunId/reviews` | Run scan-level LLM review. |
| `GET` | `/api/scans/:scanRunId/diagnostics` | Automatic diagnostic status, readiness, provenance hashes, and limitations. |
| `POST` | `/api/scans/:scanRunId/diagnostics/retry` | Retry an eligible failed or limited automatic diagnostic. |
| `POST` | `/api/scans/:scanRunId/reports` | Generate Markdown report. |
| `GET` | `/api/scan-reports/:reportId` | Report metadata. |
| `GET` | `/api/scan-reports/:reportId/download` | Download generated Markdown report. |
| `GET` | `/api/findings/:findingId` | Finding detail and evidence. |
| `GET` | `/api/findings/:findingId/reviews` | Finding-level review history. |
| `POST` | `/api/findings/:findingId/reviews` | Finding-level LLM review. |
| `GET` | `/api/finding-reviews/:reviewId` | Finding review detail. |
| `GET` | `/api/findings/:findingId/decisions` | Optional compatibility Decision history. |
| `POST` | `/api/findings/:findingId/decisions` | Optional compatibility Decision record. |
| `GET` | `/api/finding-decisions/:decisionId` | Decision record detail. |
| `GET` | `/api/findings/:findingId/reproductions` | Reproduction history. |
| `POST` | `/api/findings/:findingId/reproductions` | Reproduction run. |
| `GET` | `/api/projects/:projectId/dynamic-runs` | Dynamic verification history. |
| `POST` | `/api/projects/:projectId/dynamic-runs` | Dynamic verification. |
| `GET` | `/api/projects/:projectId/dast-runs` | DAST history. |
| `POST` | `/api/projects/:projectId/dast-runs` | DAST run. |
| `GET` | `/api/settings/llm` | LLM provider/task-route settings. |

Protected endpoints require auth cookies. The frontend retries once through `/api/auth/refresh` after a 401.

## Architecture

| Path | Role |
| --- | --- |
| `api/app/` | Hono app composition, server bootstrap, runtime env parsing. |
| `api/db/schema.ts` | SQLite/Drizzle schema for projects, scans, findings, reviews, decisions, reports, DAST, reproduction, dynamic verification, settings. |
| `api/routes/` | HTTP route layer. |
| `api/cli/` | CLI entrypoints for scans, review, reports, diagnostics, migrations, seed, and auth. |
| `api/modules/scans/` | Scan runners, normalizers, bundles, reports, repositories, artifact storage. |
| `api/modules/reviews/` | Finding review bundle and runner. |
| `api/system-context/` | Typed S11tnext prompt catalog bindings, provider execution, and prompt-message audit identity. |
| `contexts/` | Authored `system` and `user` provider-message contexts. |
| `api/modules/dast/` | DAST target prep, runner, repository, normalization. |
| `api/modules/reproductions/` | Sandboxed reproduction profiles and execution. |
| `api/modules/dynamic/` | Dynamic verification profiles and execution. |
| `api/modules/llm-settings/` | Provider endpoint and task route persistence. |
| `api/modules/static-intelligence/` | Static Intelligence export, semantic search, agent query, risk communities, security landscape, guardrail material, MCP tools, and code structure extraction. |
| `api/providers/` | Azure/OpenAI-compatible/Codex provider adapters and router. |
| `shared/schemas/` | Shared Zod schemas. |
| `shared/report-sections.ts` | Report section contract shared by UI and builder. |
| `web/src/domains/scans/` | Scan UI domain, view models, decision-grade helpers, and panels. |
| `drizzle/` | SQL migrations. |
| `spec/` | Product concept and executable implementation plans. |
| `scripts/verify.ts` | Repository verification pipeline. |

Legacy knowledge/search/chat files still exist, but the active product center is scan evidence, LLM handoff, and report readiness. Static Intelligence adds an agent-facing source layer on top of that center; it does not replace scanner evidence or turn vulnWorkbench into an implementation executor.

## Decision-Grade Models

The frontend keeps pure derivation logic separate from React state where possible:

| Helper | Owns |
| --- | --- |
| `scan-improvement-request.ts` | Type-safe extraction and quality checks for `improvementRequest`. |
| `decision-grade-view.ts` | Aggregation of scan-level executive summary, workflow, comparison, and report preview. |
| `risk-summary.ts` | Executive risk band, score, key drivers, recommended focus. |
| `workflow-completion.ts` | Completion stage, checklist, next best action. |
| `evidence-quality.ts` | Evidence strength and data completeness. |
| `scan-comparison.ts` | Baseline comparison and match confidence. |
| `report-quality.ts` | Report readiness, submission level, generation warning, section state. |

This split is deliberate: components should render derived models, not parse raw `scan_reviews.output` or reinterpret report readiness ad hoc.

## Security Boundary

- Commands are built as structured args, not shell strings.
- Runtime artifacts are isolated under artifact storage paths.
- Scanner output is normalized and redacted before LLM review/report use.
- Secret values are redacted in findings, logs, artifacts, and LLM-facing context where applicable.
- Docker-based toolbox, reproduction, dynamic, and DAST flows do not mount the Docker socket.
- Target project environments should not receive LLM provider credentials.
- DAST is limited to local or explicitly configured targets.
- Dynamic/reproduction/fuzzing-style checks are bounded by profiles, timeout, and artifact policy.
- LLM review must use saved scan/finding/evidence context. It must not claim access to raw repository files, web pages, logs, or runtime state that are not in the bundle.
- Static Intelligence exports and MCP outputs are candidate-only read models. They must keep raw artifact bodies, evidence snippets, private root paths, and secret values out of agent-facing payloads.
- Code structure snapshots contain file paths, import/export facts, content hashes, package names, and tags. They do not include source code bodies or arbitrary string literals, and snapshot enrichment is accepted only when it matches the scan project.

## Development

```bash
bun run bootstrap
bun run bootstrap:check
bun run s11tnext:check
bun run typecheck
bun run lint
bun run format
bun run test
bun run build
bun run verify
bun run verify:strict
```

`bun run verify` is the fast local gate. It checks the committed S11tnext
catalog pair, then runs typecheck, lint, format check, tests, build, bundle,
audit, and artifact tracking. `bun run verify:strict` is the closeout gate and
additionally runs Web/critical coverage and browser E2E.

LLMへ送る固定のsystem/userメッセージは`contexts/**/*.context.toml`で管理します。変更時は
`bun run s11tnext:lint`、`bun run s11tnext:build`を実行し、
`.s11tnext/catalog.json`と`.s11tnext/catalog.generated.ts`を同時にcommit
してください。生成物は直接編集しません。provider経路では生成された
`invocation.role`を使用し、監査には本文を複製せず`messageHash`と
`promptSequenceHash`を保存します。

For the Static Intelligence source contract, use the fixture gate as well:

```bash
bun run fixture:static-intelligence-source
```

Expected result: one JSON object on stdout with `ok: true`, MCP tool names present, redaction checks passing, stable hashes/material ids, and no temp paths or unsafe marker strings in final output. If it fails, inspect the named failed check before relying on the MCP or knowledge-source surface.

### Test Runner Split

Frontend/domain tests that do not import `bun:sqlite` can run with Vitest:

```bash
bunx vitest run web/src/domains/scans/report-quality.test.ts
```

API and scan-module tests that import `bun:sqlite` must run through Bun:

```bash
bun test api/modules/scans/scan-review-runner.test.ts
bun test api/modules/scans/report-builder.test.ts
```

The package `test` script and `scripts/verify.ts` already apply this split.

## Git Diff Target Scans

Use the `diff-source-baseline` profile to scan files changed by a commit,
merge-base range, or the current working tree. Resolve a preview first when
scanning mutable working-tree content:

```bash
bun run scan:profile -- \
  --project-path . \
  --profile diff-source-baseline \
  --target working-tree \
  --base HEAD \
  --include-untracked true \
  --preview true
```

Commit and branch-like range targets use `--target commit --head <ref>` and
`--target range --base <ref> --head <ref>`. The Scans UI exposes the same
target selector, coverage preview, and target digest.

V1 scans the whole content of each changed file in the resolved target
snapshot. A finding is therefore related to a changed file or the target
dependency state; it does not prove that the selected commit introduced the
finding. Deleted, excluded, binary, unsupported, and oversized paths remain
visible as coverage records. Diff scans do not automatically invoke an LLM
review.

## NightWorkers Security Scan Provider

The feature-flagged `/api/integrations/nightworkers/v1` API exposes scoped
project security scans, resumable events, redacted findings, and asynchronous
Markdown reports to NightWorkers. It uses dedicated hashed bearer credentials;
browser cookies are not accepted as integration authorization.

For migration order, credential creation/rotation/revocation, canary checks,
monitoring, and rollback, follow the
[NightWorkers security scan provider runbook](docs/nightworkers-security-scan-provider-runbook.md).

## Operational Checks

Apply migrations:

```bash
bun run db:migrate
```

Confirm the `finding_decisions.metadata` migration on local SQLite:

```bash
sqlite3 data/vuln-workbench.sqlite "select count(*) from pragma_table_info('finding_decisions') where name='metadata';"
```

Expected output:

```text
1
```

Runtime scan/reproduction/DAST/dynamic/report outputs under `artifacts/` are generated data and should not be committed. Check tracked artifact state before committing:

```bash
git ls-files artifacts
git diff --cached --name-only -- artifacts
```

## Concept and Active Planning Documents

Product boundaries and active, incomplete plans are:

- `spec/vuln-workbench-concept.md`
- `spec/static-intelligence-layer-concept.md`
- `spec/contextstill-static-intelligence-bridge-concept.md`
- `spec/project-scan-exploration-reduction-mcp-concept.md`
- `spec/static-intelligence-coding-agent-consumer-companion-plan.md`
- `spec/phase-46-security-release-readiness-plan.md`
- `spec/phase-48-quality-reliability-hardening-plan.md`

Completed implementation plans are removed from the working tree and remain available in Git history.
