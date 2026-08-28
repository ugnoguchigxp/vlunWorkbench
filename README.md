# vulnWorkbench

[![Bun](https://img.shields.io/badge/Bun-1.3.14-black?logo=bun)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono)](https://hono.dev/)
[![React](https://img.shields.io/badge/React-19-20232a?logo=react)](https://react.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local-07405e?logo=sqlite)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE.md)

English | [日本語](README.jp.md)

vulnWorkbench is a local application that collects results from several security scanners and turns them into reports whose supporting evidence can be traced. It can inspect source code, dependencies, configuration, build artifacts, and running Web applications. It records not only what was found, but also what was tested, what could not run, and what remains unknown.

“Workbench” is intentional: this is not one more scanner. It is the place where scan preparation, execution, evidence, review, comparison, and reporting are kept together.

> [!IMPORTANT]
> vulnWorkbench is not a replacement for a professional penetration test. A penetration test is a broader assessment in which specialists try to compromise a system as an attacker would. The versioned v1.0.0 evidence still marks the measured professional-capability claim as `not_met`. See [Measured limits](#measured-limits).

## Why this project exists

Running several scanners creates a practical problem: every tool uses a different output format, and a failed or skipped check can easily look like a clean result. An AI summary by itself also makes it difficult to trace a conclusion back to the original scanner output.

vulnWorkbench preserves this order of work:

```text
local project
  → preflight checks
  → bounded scanner execution and saved evidence
  → normalized findings
  → deterministic report from saved records
  → optional evidence-constrained LLM review
  → final report and implementation handoff
```

**Evidence** means the scanner output, logs, file location, runtime conditions, and other saved facts supporting a conclusion. An **LLM** (large language model) is an AI model that reads and writes language. In this application, an LLM does not freely browse the repository. It receives a bounded bundle assembled from records already saved by vulnWorkbench.

If no LLM route is configured, or an LLM response fails schema validation, the scanner-backed report still completes when possible. The missing AI stage is recorded as an explicit limitation instead of being hidden.

## What it can do

- Register a local repository as a project.
- Run several scanners through a reusable scan profile.
- Scan a full repository, one commit, a Git range, or the uncommitted working tree.
- Normalize tool output into findings with severity, location, and evidence.
- Distinguish completed, failed, skipped, and not-applicable checks.
- Compare a scan with an earlier run and identify new, unchanged, or regressed findings.
- Download the stored scanner findings as text without AI summaries or remediation advice.
- Ask an LLM to assess evidence strength, false-positive likelihood, exploitability, business impact, priority, and remediation.
- Produce a Markdown report and a standalone handoff prompt for a developer or coding agent.
- Expose bounded code-structure and security information to external agents without returning source bodies.

A **scan profile** is a saved execution menu: it defines the scope, required tools, timeouts, result policy, and failure behavior. Profiles make repeated runs comparable and avoid rebuilding every scanner command by hand.

## Quick start

### Requirements

- [Bun](https://bun.sh/) 1.3.14
- A local terminal
- For actual scans, either the binaries required by the selected profile or Docker

Bun is the runtime and package manager used to execute the TypeScript application, install dependencies, and run tests. This repository is verified with Bun 1.3.14.

Development mode runs scanners directly on the host by default. For example, the `baseline` profile requires the `gitleaks` and `osv-scanner` executables. If you select Docker execution, build the scanner toolbox image first.

### Install and start

```bash
git clone https://github.com/ugnoguchigxp/vlunWorkbench.git
cd vulnWorkbench
bun install --frozen-lockfile
bun run bootstrap
bun run dev
```

`bun run bootstrap` performs three operations:

1. Copies `.env.example` to `.env` if `.env` is missing.
2. Applies SQLite migrations. A migration updates the database structure while preserving existing data.
3. Creates or confirms the local administrator `admin@example.com` and prints a generated password on first setup.

Open [http://localhost:29831](http://localhost:29831) and sign in with the credentials printed by the command. Re-running bootstrap preserves the current administrator password. Reset it only when needed:

```bash
bun run bootstrap -- --reset-admin-password
```

Check the local environment after setup:

```bash
bun run bootstrap:check
```

The check covers `.env`, the database, migrations, the admin account, the port, the SQLite vector extension, the execution policy, and registered scanner binaries. A missing scanner is reported as `WARN`: the Web application can still start, but profiles that require that scanner cannot complete.

### Run the first scan in the UI

1. In **Projects**, register the absolute path of the repository to inspect. The native folder picker is available to administrators on macOS.
2. Open **Scans** and select the project.
3. Start with the `baseline` profile and review its preflight result.
4. Run the scan and inspect each tool’s progress and findings.
5. To use an LLM, configure an endpoint under **Settings > AI・モデル**, then select models under **Settings > タスクルーティング**.
6. Open the report and review coverage, limitations, evidence, and remediation guidance.

A **preflight** is the check performed before scanner execution. It confirms that required tools, files, Docker images, permissions, and target inputs are available. A missing required dependency blocks the run before partial output can be mistaken for a valid assessment.

## How results are stored

One issue candidate reported by a scanner is called a **finding**. A finding is not automatically a confirmed vulnerability; scanners can report false positives, meaning results that look suspicious but are not exploitable problems.

| Record | Meaning |
| --- | --- |
| Scan run | One complete scan attempt, including its target, profile, timestamps, and outcome. |
| Tool run | One scanner process inside a scan, including its version, exit code, and logs. |
| Finding | A normalized issue candidate with severity, rule, location, and stable fingerprint. |
| Evidence | The location, bounded snippet, reproduction data, or other fact supporting a finding. |
| Artifact | A stored file such as raw scanner output, a log, or a generated report. |
| Coverage | What was checked and what was skipped, inapplicable, blocked, or incomplete. |
| Review | An LLM or human assessment based on saved records. It does not rewrite the scanner source record. |

The code calls the base output a **deterministic report**. Here, “deterministic” means that the same saved records produce the same sections and aggregations. It does not mean that newly generated LLM prose will be identical on every request.

Zero findings never means “proven safe.” If required checks failed or coverage was insufficient, the result is marked `inconclusive` or `not_tested` rather than clean.

## Scanner roles

| Tool | Role in vulnWorkbench |
| --- | --- |
| Gitleaks | Searches source and artifacts for credentials, API keys, and other secrets. |
| OSV-Scanner | Matches dependency names and versions against known vulnerability data. This is SCA: Software Composition Analysis, or inspection of third-party components. |
| Trivy | Inspects dependencies, filesystems, container images, secrets, and configuration; it can also create an SBOM. |
| zizmor | Checks GitHub Actions permissions, unpinned references, and unsafe input handling. CI means automated build and test workflows. |
| Semgrep | Applies source-code rules without running the application. This is SAST: Static Application Security Testing. Semgrep is optional and disabled by default. |
| Nuclei | Sends a bounded number of requests using the repository’s pinned safe template set. |
| ZAP Baseline | Crawls and passively inspects Web traffic. The baseline profile does not send active attack payloads. |
| Schemathesis | Reads OpenAPI or GraphQL schemas and checks bounded, read-only API operations. OpenAPI describes an API’s routes and input shapes. |
| Cosign / slsa-verifier | Verifies artifact signatures and provenance. Provenance records which source, builder, and process produced an artifact. |

An **SBOM** (Software Bill of Materials) is an inventory of the libraries and versions contained in software. It is not itself a vulnerability verdict; it is the component list used for later impact analysis.

Semgrep is separated from the core toolbox because it has a different licensing and distribution boundary. Build and opt into it explicitly:

```bash
bun run docker:plugin:semgrep:build
VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep bun run dev
```

The optional mode records a limitation and continues if Semgrep is unavailable. Use `VULN_WORKBENCH_REQUIRED_SCANNER_ADAPTERS=semgrep` only when its absence should block the run.

For Docker execution, select `vuln-workbench-toolbox-semgrep:local` as the scanner image under **Settings > スキャン実行**. Host execution requires the `semgrep` executable on the host.

## Common scan profiles

| Profile ID | Purpose |
| --- | --- |
| `baseline` | Fast secret and dependency check with Gitleaks and OSV-Scanner. |
| `basic-security` | Adds Trivy configuration and filesystem checks to the baseline concerns. |
| `change-gate` | Strictly inspects a commit, range, or working-tree change. High and Critical findings can fail the gate. |
| `source-assurance` | Runs Gitleaks, OSV-Scanner, Trivy, and applicable zizmor checks across the repository. Semgrep is added only when enabled. |
| `dependency-supply-chain` | Checks dependencies, creates an SBOM, and verifies either a signature bundle or SLSA provenance. |
| `runtime-web-safe` | Runs passive DAST, Nuclei safe checks, and ZAP Baseline against an isolated local target. |
| `api-schema-readonly` | Checks bounded read-only OpenAPI operations or Query-only GraphQL. |
| `container-image-security` | Scans an existing image reference or image archive with Trivy; it does not build the image. |
| `full-security-scan` | Legacy composite of static checks, SBOM generation, and passive Web checks. It is not an active attack profile. |

**DAST** (Dynamic Application Security Testing) sends HTTP requests to a running application and inspects real responses. A passive check stays close to ordinary browsing and response observation. An active check sends unusual or state-changing input, so it requires separate authorization and containment.

The canonical stable and experimental profile inventory is documented in the [generated capability table](spec/generated/security-capability-table.html) and `api/modules/scans/profile-catalog.ts`.

## Docker execution

Build the core toolbox if you do not want to install every scanner on the host. The build verifies pinned source archives and checksums and embeds prepared offline vulnerability data.

```bash
bun run docker:toolbox:build
```

Then select `docker` and `vuln-workbench-toolbox:local` under **Settings > スキャン実行**. The default Docker policy disables networking and applies limits of 4 GiB memory, 2 CPUs, and 512 PIDs. A PID is a running process identifier; the limit prevents a container from creating an unbounded number of processes.

Profiles that automatically start a target application need the separate isolated runtime. The following command verifies the local Docker daemon, builds and qualifies the runtime image, resolves images to immutable IDs, and stores the resulting hashes in SQLite:

```bash
bun run runtime-isolation:auto-configure
```

The isolated runtime places the target, optional database, and HTTP scanners inside a disposable container namespace. A namespace is Docker’s boundary for separating processes and networking from the host. The currently qualified dependency-install paths for automatic startup are npm with `package-lock.json` and Bun with a Bun lockfile.

## CLI examples

### Register a path and run the baseline

```bash
bun run scan:profile -- \
  --project-path /path/to/repository \
  --create-project true \
  --profile baseline \
  --timeout-sec 600 \
  --report-output report.md
```

CLI profile scans wait for the automated diagnostic and final report by default. If the LLM stage is unavailable, `report.md` receives the base report with recorded limitations. Use `--automated-diagnostic false` for an intentional scanner-only run.

### Preview a working-tree gate

```bash
bun run scan:profile -- \
  --project-path /path/to/repository \
  --profile change-gate \
  --target working-tree \
  --base HEAD \
  --include-untracked true \
  --preview true
```

`--target commit` selects one commit, `--target range` selects the difference between two Git references, and `--target working-tree` selects uncommitted changes. The complete contents of changed files are scanned, so a finding in a changed file is not proof that the selected change introduced it.

The preview includes a SHA-256 digest of the resolved target. SHA-256 is a content hash: changing the target changes the digest, which lets an execution verify that it is still scanning the previewed input.

### Rebuild a report

```bash
bun run report:scan -- \
  --scan-run-id <scan-run-id> \
  --format markdown \
  --summary-mode deterministic \
  --output report.md
```

Use `--summary-mode deterministic_with_llm_summary` to add a short LLM summary to the base report.

### Back up the database

```bash
bun run backup:create -- --output backups/vuln-workbench.sqlite
bun run backup:verify -- --input backups/vuln-workbench.sqlite
```

Back up `LLM_SETTINGS_ENCRYPTION_KEY` separately. A database backup cannot recover encrypted provider credentials without the matching key.

## LLM routing and credentials

Administrators register providers and models under **Settings > AI・モデル** and map each task to a model under **Settings > タスクルーティング**. Task routing means that finding review, report summarization, and search can use different provider/model combinations.

| Task | Purpose |
| --- | --- |
| `finding_review` | Review one finding and its saved evidence. |
| `scan_review` | Prioritize a complete scan and produce triage, remediation, and a standalone handoff. |
| `report_summary` | Add a short AI-generated summary to an existing base report. |
| `evidence_context` | Reshape saved evidence for a later bounded task. |
| `agentic_search` | Perform multi-step search over configured local knowledge sources. |

Stored API keys are encrypted with AES-256-GCM, an authenticated encryption method that both hides the value and detects modification. Generate a 32-byte key and set `LLM_SETTINGS_ENCRYPTION_KEY` in `.env` before storing provider credentials:

```bash
openssl rand -base64 32
```

The encryption key is not stored in SQLite. Losing it makes stored API keys unrecoverable. LLM credentials are not passed into scanner containers or target-project processes.

## Storage and architecture

By default, structured records are stored in `data/vuln-workbench.sqlite`; scanner output, logs, and reports are stored below `artifacts/scans/`. These are runtime files and should not be committed.

File-backed SQLite mutations are serialized through one **Writer process** per database. SQLite is an embedded database stored in one file. Web requests and CLI processes keep read-only connections, while inserts, updates, and deletes are sent to the Writer. This prevents multiple processes from opening independent write paths.

```bash
bun run db:writer:health
bun run db:boundary
```

If the Writer is unavailable, the application fails the mutation instead of falling back to an unsafe direct write. The supported deployment is one local application instance and one Writer. Remote databases, multi-node writers, and several application hosts sharing one file are unsupported.

| Path | Responsibility |
| --- | --- |
| `api/app/` | Hono HTTP application composition and startup. Hono is a lightweight TypeScript Web framework. |
| `api/routes/` | HTTP endpoints for authentication, projects, scans, findings, settings, and reports. |
| `api/modules/scans/` | Profiles, execution, normalization, evidence, comparison, and reporting. |
| `api/modules/runtime-isolation/` | Qualification and execution of disposable Docker target environments. |
| `api/modules/static-intelligence/` | Bounded code-structure and scanner-backed data for external agents. |
| `web/src/` | The React user interface. React builds the UI from reusable components. |
| `shared/schemas/` | Data contracts and validation shared by the API and UI. |
| `drizzle/` | Forward SQLite migrations. Drizzle is the TypeScript database layer. |
| `contexts/` | Versioned system and user messages sent to LLM providers. |
| `spec/` | Product specifications, design decisions, plans, and release evidence. |
| `scripts/` | Setup, build, test, benchmark, and verification commands. |

## Technology detection

Built-in technology plugins inspect project files to identify languages, dependency managers, and frameworks. These plugins are repository-owned detection rules and analyzers; they are not arbitrary third-party code loaded at runtime.

| Environment | Current built-in coverage |
| --- | --- |
| TypeScript-focused | npm-compatible dependencies, Hono, Express, Fastify, TypeScript/JavaScript structure analysis, and Semgrep rules. |
| Java | Maven, Gradle, Spring Boot / Spring MVC, structure analysis, and route extraction. |
| Python | requirements-style dependencies, FastAPI, Flask, and Django. Structure analysis is bounded and cannot fully resolve dynamic imports. |
| Go | Go Modules, `net/http`, Gin, and Echo. Structure analysis does not perform full type checking or reproduce every build constraint. |

Detecting a language does not guarantee that every runtime profile can automatically start that project. The persisted preflight and coverage records are authoritative for each scan.

## Static Intelligence and MCP

vulnWorkbench can publish saved diagnostic results and lightweight code structure for external coding agents. This read model is called **Static Intelligence**. It exposes file names, imports and exports, package relationships, route candidates, and evidence references without returning source-code bodies.

**MCP** (Model Context Protocol) is a standard interface through which AI applications call external tools. The bundled MCP server is read-only except for one explicit preparation action, which queues background generation. It does not start security scanners, run verification commands, or apply patches.

```bash
bun run mcp:static-intelligence -- --list-tools
bun run mcp:static-intelligence -- --smoke
```

Path-based MCP access is fail-closed. Set `STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS` in `.env` to a comma-separated list of absolute parent directories; an empty value rejects every project path.

Build one generation from an existing scan:

```bash
bun run intelligence:build -- \
  --scan-run-id <scan-run-id> \
  --include-semantic false \
  --pretty true
```

**Semantic search** looks for meaning rather than exact word matches. With `--include-semantic false`, generation uses structure and scanner records without calling an external embedding model.

NightWorkers integration APIs are present but disabled by default. vulnWorkbench remains the evidence source; task compilation, code changes, and verification orchestration belong to the integrating system.

## Security boundaries

- API access requires authentication, projects are owner-scoped, and sensitive settings are administrator-only.
- Commands are built as executable-and-argument arrays rather than interpolated shell strings.
- Docker execution enforces memory, CPU, PID, output-size, and timeout limits.
- Scanner, reproduction, dynamic, and DAST containers are not given the Docker socket.
- Ordinary DAST rejects public Internet targets. Loopback and private targets require explicit permission.
- Active DAST rejects production targets and requires valid Rules of Engagement, exact methods and paths, request budgets, expiry, and a reset contract.
- **Rules of Engagement (RoE)** are the recorded authorization defining where, when, how, and how often an active assessment may operate.
- LLM bundles are bounded and redacted, and prompts prohibit claims about repository or runtime data outside the saved bundle.
- Static Intelligence omits source bodies and arbitrary string literals.

Before production-like use, replace the development `JWT_SECRET` and configure HTTPS, secure cookies, CORS origins, trusted proxy ranges, and encryption keys. CORS controls which Web origins may call the API. See [SECURITY.md](SECURITY.md) for the release and incident policy.

## Measured limits

The versioned [Phase 55 professional-capability evidence](spec/evidence/phase-55-diagnostic-professional-capability.json) records an overall claim status of `not_met`. Its OWASP Benchmark totals were recall 0.7993, precision 0.9536, and false-positive rate 0.0399.

- **Recall** is the fraction of prepared vulnerable cases that were detected.
- **Precision** is the fraction of reported findings that were correct in the benchmark.
- **False-positive rate** is the fraction of prepared safe cases incorrectly reported as vulnerable.

Those numbers alone do not satisfy the release claim. In the same evidence, the OSV gate and the authoritative Linux Juice Shop evidence did not pass all release conditions, and no `passingBenchmarkRunId` was recorded. Juice Shop is an intentionally vulnerable Web application used for security testing.

Current exclusions and material limitations include:

- Network appliances, cloud configuration, Active Directory, mobile, wireless, and social-engineering assessment.
- Complex browser-authenticated ZAP active scanning.
- Active attacks against production and unbounded fuzzing.
- Arbitrary scanner scripts without a registered bounded adapter.
- Remote databases, multi-node deployment, and multiple Writers.
- Treating zero findings as proof of safety.
- Applying automatic patches. The application produces remediation guidance and handoff material, not code changes.

**Fuzzing** feeds a program many unexpected inputs to find crashes or unsafe behavior. vulnWorkbench has bounded experimental lab profiles, but fuzzing is not part of the default assessment path.

## Development and verification

Run the normal repository gate with:

```bash
bun run verify
```

It checks the SQLite write boundary, versioned LLM messages, TypeScript types, lint and formatting, source-size policy, specification files, tests, Web build, bundle size, dependency audit, and generated-artifact tracking.

The strict closeout gate adds security-capability tests, coverage, DAST qualification, and browser end-to-end tests. An end-to-end (E2E) test exercises the user-facing flow across the browser, API, and storage layers.

```bash
bun run verify:strict
git diff --check
```

UI and pure TypeScript tests run under Vitest. API tests that use `bun:sqlite` run under Bun’s test runner. `bun run test` applies this split automatically.

The specification index is [spec/index.html](spec/index.html):

```bash
bun run docs
bun run docs:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements, [CHANGELOG.md](CHANGELOG.md) for release history, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

vulnWorkbench is released under the [MIT License](LICENSE.md). Each integrated scanner and container image remains subject to its own upstream license.
