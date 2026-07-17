# ZAP Baseline Recovery Implementation Plan

Status: implementation-ready
Owner: Luna
Scope: recover the existing `zap-baseline` integration without adding active scan or authenticated scan

## 1. Objective

Recover ZAP Baseline so that vulnWorkbench can:

1. run the official ZAP image through a dedicated Docker adapter;
2. reach only the auto-started local target through a bounded gateway;
3. generate and validate a ZAP JSON report;
4. normalize one finding per alert instance;
5. redact secrets before any persistent artifact or database write;
6. distinguish findings, tool failure, target failure, and coverage gaps;
7. return a failing CLI status when the standalone ZAP scan itself fails.

ZAP must remain a baseline passive scan. This plan does not add active scan, authenticated scan, Ajax spider, browser automation, or user-supplied ZAP options.

## 2. Confirmed Current Failures

The implementation must not be considered recovered until all of these are addressed:

- The image reference uses `:sha256-...` instead of an immutable `@sha256:...` reference.
- The recorded digest is an ARM64 manifest rather than a multi-platform image index.
- The generic Docker runner mounts output at `/workspace/out`; `zap-baseline.py` requires `/zap/wrk`.
- The generic runner overrides the image user, `HOME`, and `PATH` in ways that are incompatible with the official ZAP image.
- The auto-started Vite target rejects `Host: host.docker.internal`.
- The normalizer reads `alert.url`, `alert.param`, and `alert.evidence`, while real ZAP reports store these values in `alert.instances[]`.
- Raw ZAP reports are persisted before redaction.
- Any parseable JSON, including `{}`, is currently accepted as a successful zero-finding scan.
- Target connection failures are reported as `invalid_structured_output`.
- `zap-baseline.py -h` is stored as the tool version even though it is only usage text.
- The standalone `scan:zap-baseline` command defaults to host execution and can return exit code 0 when the ZAP step failed.
- ZAP spider requests do not honor the vulnWorkbench request count and rate limits.
- There is no ZAP runner fixture test or ZAP normalizer test.

## 3. Locked Architecture Decisions

These decisions are part of the implementation contract.

### 3.1 ZAP is Docker-only

- Do not support host execution for `zap-baseline`.
- Do not search for or execute a host `zap-baseline.py`.
- Do not let the upstream script launch its own `weekly` image.
- Reject host execution with `policy_rejected`.

### 3.2 ZAP gets a dedicated runner

Do not add ZAP-specific exceptions to the generic toolbox runner.

Create a dedicated `ZapBaselineRunner` responsible for:

- image selection;
- Docker command construction;
- target gateway lifecycle;
- container preflight;
- ZAP execution;
- timeout and cleanup;
- report validation;
- redaction and artifact storage;
- exit-code interpretation.

Nuclei must continue using the current generic runtime scanner path.

### 3.3 Use the official image's runtime user

- Do not pass `--user 65532:65532`.
- Do not override `HOME`.
- Do not replace the image `PATH`.
- Do not use `--read-only` in the recovery change.

The official image writes under `/home/zap`. Attempts to combine a read-only root with a replacement home caused the current ZAP/OpenJDK image to terminate with `SIGBUS`.

The container remains ephemeral and receives only one writable host mount: the temporary `/zap/wrk` output directory.

### 3.4 Use a pinned multi-platform image index

Use an immutable multi-platform index reference:

```text
zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2
```

The currently verified image contains ZAP `2.17.0` and resolves to:

- `linux/amd64`: `sha256:c558ee87358911ab17278c70991e856f57793e115d9cd0f88ca475cf82907a1a`
- `linux/arm64`: `sha256:1110082c94217b6e9592b18934740108839a44c02f1d0e961e4933bbb98bab45`

Before merging, verify the index and both child manifests again and update `spec/third-party-scanners.md`.

### 3.5 Put a bounded local gateway between ZAP and the target

ZAP must not connect directly to the application process.

Create an ephemeral HTTP gateway that:

- forwards only to the prepared loopback target;
- accepts only `GET`, `HEAD`, and `OPTIONS`;
- rewrites the upstream `Host` header to the target's loopback host;
- enforces allowed and excluded paths;
- enforces a maximum number of forwarded target requests;
- enforces the configured target request rate;
- strips secret-bearing request headers;
- blocks or rewrites redirects outside the target origin;
- returns a synthetic `204` response after the target request budget is exhausted;
- records forwarded, blocked, and out-of-scope request counts;
- stops in `finally`, including timeout and error paths.

This gateway solves both the Vite `host.docker.internal` rejection and the missing ZAP request budget without binding the application itself to `0.0.0.0`.

### 3.6 Keep ZAP options closed

The only allowed scan arguments are:

```text
-t <gateway-origin>
-m <fixed-spider-minutes>
-T <fixed-passive-wait-minutes>
-J zap-report.json
```

The adapter must reject or make impossible:

- `zap-full-scan.py`
- `-j`
- `-U`
- `-n`
- `--hook`
- `-z`
- add-on installation or update options
- arbitrary user-provided arguments

## 4. Target File Layout

Create:

- `api/modules/runtime-scans/zap-baseline-runner.ts`
- `api/modules/runtime-scans/zap-baseline-runner.test.ts`
- `api/modules/runtime-scans/zap-image-policy.ts`
- `api/modules/runtime-scans/zap-report-schema.ts`
- `api/modules/runtime-scans/zap-normalizer.test.ts`
- `api/modules/runtime-scans/fixtures/zap-report-2.17.0.json`
- `api/modules/dast/container-target-gateway.ts`
- `api/modules/dast/container-target-gateway.test.ts`

Modify:

- `api/modules/runtime-scans/runtime-scanner-runner.ts`
- `api/modules/runtime-scans/zap-normalizer.ts`
- `api/modules/runtime-scans/command-contracts.ts`
- `api/modules/runtime-scans/command-contracts.test.ts`
- `api/modules/scans/profile-runner.ts`
- `api/modules/scans/profiles.ts`
- `api/modules/scans/artifact-storage.ts`
- `api/modules/scans/repositories.ts`
- `api/modules/scans/repositories.test.ts`
- `api/modules/scans/summary-builder.ts`
- `api/modules/dast/target-validator.ts`
- `shared/schemas/scan-profile.schema.ts`
- `package.json`
- `README.md`
- `spec/third-party-scanners.md`
- `web/src/api.ts`
- `web/src/domains/scans/scan-profile-display.ts`

Modify additional tests only where the changed contract requires it.

Do not modify unrelated static-intelligence or project-structure work.

## 5. Implementation Tasks

### Task 1: Add the image policy

Implement `zap-image-policy.ts`.

Required exports:

```ts
export const ZAP_VERSION = "2.17.0";
export const ZAP_STABLE_IMAGE =
  "zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2";
export const ZAP_REPORT_FILENAME = "zap-report.json";
```

Requirements:

- Remove the current digest-tag constant from `runtime-scanner-runner.ts`.
- Store the image reference in tool-run metadata.
- Obtain the runtime version from the validated report's `@version` field.
- Do not use `zap-baseline.py -h` as a version check.

Verification:

- Image reference contains `@sha256:`.
- Unit test rejects a tag-shaped `:sha256-...` reference.
- Tool metadata records both the image index digest and report version.

### Task 2: Implement the bounded container target gateway

Implement `container-target-gateway.ts` with a small typed API:

```ts
export type ContainerTargetGatewayOptions = {
  upstreamOrigin: string;
  allowedPaths: string[];
  excludedPaths: string[];
  maxRequests: number;
  rateLimitPerSec: number;
  dockerBin?: string;
};

export type PreparedContainerTargetGateway = {
  hostOrigin: string;
  containerOrigin: string;
  metrics: () => {
    forwardedRequests: number;
    budgetBlockedRequests: number;
    methodBlockedRequests: number;
    pathBlockedRequests: number;
    redirectBlockedResponses: number;
  };
  stop: () => Promise<void>;
};
```

Behavior:

1. Validate `upstreamOrigin` with the existing loopback target rules.
2. Bind to an interface reachable only from the local host and Docker bridge:
   - Docker Desktop: loopback gateway supported by `host.docker.internal`.
   - Linux: resolve and bind the Docker bridge gateway address; add `host.docker.internal:host-gateway`.
   - If a safe bridge address cannot be established, fail closed with `target_unreachable_from_container`.
   - Never fall back to `0.0.0.0`.
3. Forward only read-only methods.
4. Build the upstream URL from the validated upstream origin and incoming path.
5. Reuse `isPathAllowed` for path enforcement.
6. Remove these request headers before forwarding:
   - `authorization`
   - `cookie`
   - `proxy-authorization`
   - `x-api-key`
   - `x-auth-token`
   - `x-csrf-token`
7. Replace the forwarded `Host` header with the upstream host.
8. Use manual redirect handling.
9. Rewrite same-origin `Location` headers from the upstream origin to the gateway origin.
10. Strip out-of-origin `Location` headers and increment `redirectBlockedResponses`.
11. Delay forwarded requests according to `rateLimitPerSec`.
12. Forward no more than `maxRequests` requests to the application.
13. After the budget is exhausted, return `204` with:

```text
X-Vuln-Workbench-Gateway: budget-blocked
Cache-Control: no-store
Content-Security-Policy: default-src 'none'
X-Content-Type-Options: nosniff
```

14. Use an `AbortController` for upstream timeouts.
15. Make `stop()` idempotent.

Tests:

- forwards a valid GET;
- rewrites `Host`;
- strips secret headers;
- rejects POST without reaching the upstream;
- enforces path allow and exclude lists;
- stops forwarding after the exact request budget;
- applies rate limiting using fake timers;
- rewrites same-origin redirects;
- blocks external redirects;
- stops cleanly after upstream failure;
- never binds `0.0.0.0`.

### Task 3: Implement the dedicated Docker runner

Implement `zap-baseline-runner.ts`.

Suggested constructor:

```ts
export class ZapBaselineRunner {
  constructor(
    private readonly storage: ArtifactStorage,
    private readonly execution: ToolExecutionConfig,
  ) {}
}
```

The constructor or `run()` must reject any execution config whose runner is not Docker.

Required Docker command shape:

```text
docker run --rm
  --name <generated-name>
  --network default
  --cap-drop ALL
  --security-opt no-new-privileges
  --memory <configured-or-2g>
  --cpus <configured-or-2>
  --pids-limit 512
  --shm-size 512m
  -v <temporary-output-directory>:/zap/wrk:rw
  --entrypoint /zap/zap-baseline.py
  <pinned-image>
  -t <gateway-container-origin>
  -m 1
  -T 3
  -J zap-report.json
```

Linux may additionally use:

```text
--add-host host.docker.internal:host-gateway
```

Do not include:

- target repository mount;
- Docker socket mount;
- tool cache mount;
- host environment secrets;
- user override;
- HOME override;
- PATH override;
- privileged mode;
- arbitrary ZAP arguments.

Preflight:

- Start the bounded gateway first.
- Run a container-network preflight against the gateway before starting ZAP.
- Invoke `python3` directly as the image entrypoint; do not invoke a shell.
- Treat connection errors as `target_unreachable_from_container`.
- Treat HTTP 401 or 403 as `authentication_required`.
- Do not start the ZAP scan when preflight fails.

Execution:

- Accept ZAP exit codes `0`, `1`, and `2` only when a valid report exists.
- Treat exit code `3` as execution failure.
- Treat timeout as `timed_out`.
- Kill and remove the named container on timeout.
- Always stop the gateway and remove the temporary output directory.
- Capture redacted stdout and stderr artifacts.
- Record gateway metrics in execution metadata.

Do not call the generic `runToolProcess()` for the ZAP scan.

Tests:

- exact Docker argument contract;
- no prohibited mount, environment, user, or flag;
- exit `0` plus valid zero-alert report succeeds;
- exit `1` plus valid report succeeds with findings;
- exit `2` plus valid report succeeds with findings;
- exit `3` fails;
- missing report fails;
- truncated report fails;
- parseable but structurally invalid `{}` report fails;
- target preflight failure returns `target_unreachable_from_container`;
- 401/403 preflight returns `authentication_required`;
- timeout removes the container and stops the gateway;
- successful execution stops the gateway;
- gateway budget metrics are returned.

### Task 4: Add a schema for the ZAP report

Implement `zap-report-schema.ts` with Zod.

The schema must validate at least:

```ts
{
  "@programName": string,
  "@version": string,
  site: Array<{
    "@name"?: string,
    "@host"?: string,
    "@port"?: string,
    "@ssl"?: string,
    alerts?: Array<{
      pluginid: string,
      alertRef?: string,
      name?: string,
      alert?: string,
      riskcode: string,
      confidence?: string,
      desc?: string,
      solution?: string,
      reference?: string,
      cweid?: string,
      wascid?: string,
      instances?: Array<{
        uri: string,
        method?: string,
        param?: string,
        attack?: string,
        evidence?: string,
        otherinfo?: string
      }>
    }>
  }>
}
```

Requirements:

- Allow unknown fields for forward compatibility.
- Require `site` to exist.
- An empty `site` array is valid only when the report is otherwise a valid ZAP report.
- Reject `{}`, arrays, truncated JSON, and reports without ZAP identity fields.
- Return a typed parsed report to the normalizer.

Use a sanitized real ZAP `2.17.0` report as the fixture.

### Task 5: Correct the normalizer

Change `normalizeZap` to accept both the validated report and origin mapping:

```ts
normalizeZap(report, {
  upstreamOrigin,
  gatewayOrigin,
})
```

Normalization rules:

1. Iterate through every `site`, `alert`, and `instance`.
2. Create one finding for each alert instance.
3. When an alert has no instances, create one fallback finding using the site origin.
4. Replace the gateway origin in instance URIs with the original upstream origin.
5. Remove URL fragments.
6. Redact sensitive query values before storage and fingerprinting.
7. Map risk:
   - `3` -> `high`
   - `2` -> `medium`
   - `1` -> `low`
   - `0` -> `info`
   - unknown -> `unknown`
8. Preserve ZAP confidence in finding metadata:

```ts
metadata: {
  zapConfidenceCode,
  zapConfidenceLabel,
  cweId,
  wascId,
  method,
}
```

The shared `confidence` field may remain `static` until its global schema is expanded.

Fingerprint input:

```text
zap:<pluginId>:<normalized-redacted-url>:<parameter>:<sha256(redacted-evidence)>
```

Evidence:

- Do not store the complete alert object for every instance.
- Store a compact redacted object containing rule, URL, method, parameter, evidence, attack, confidence, CWE, WASC, and reference.
- Limit the evidence snippet to 4,000 characters.
- Convert ZAP HTML descriptions and solutions to readable plain text without adding a new HTML parser dependency.

Tests:

- real fixture produces the expected instance count;
- no normalized finding has path `unknown` when the fixture contains an instance URI;
- findings from different URLs have different fingerprints;
- identical findings remain stable across `host.docker.internal` and loopback origins;
- query tokens are redacted;
- evidence and attack values are redacted;
- evidence is truncated to 4,000 characters;
- risk mappings are correct;
- confidence metadata is preserved;
- empty valid report produces zero findings;
- alert without instances produces one fallback finding.

### Task 6: Redact before persistence

Change the ZAP artifact flow:

1. Read and parse the temporary report.
2. Validate the report schema.
3. Redact the complete report object.
4. Serialize the redacted report.
5. Persist only the redacted serialization.
6. Delete the unredacted temporary directory in `finally`.

Extend `ArtifactStorage` with a narrowly scoped way to write a private text artifact:

```ts
saveTextArtifact(
  scanRunId,
  subDir,
  content,
  filename,
  options?: { mode?: number },
)
```

For ZAP artifacts and logs use mode `0o600`.

Do not change the behavior of unrelated artifact producers in this recovery change.

Tests:

- a GitHub-style token is absent from the stored report;
- authorization, cookie, and token-shaped values are absent;
- the returned `rawJson` and stored artifact contain the same redacted content;
- persisted ZAP artifact mode is `0600`;
- the unredacted temporary file no longer exists after success;
- the unredacted temporary file no longer exists after failure.

### Task 7: Integrate the runner into profile orchestration

In `runRuntimeScannerIntoExistingScan`:

- construct `ZapBaselineRunner` only for `zap-baseline`;
- keep `RuntimeScannerRunner` for Nuclei;
- pass the prepared target origin, allowed/excluded paths, maximum request count, and rate limit to ZAP;
- use report `@version` as `toolVersion`;
- persist gateway metrics in tool-run metadata;
- keep findings and evidence attached to the redacted raw artifact.

Add typed ZAP options to `runtimeScannerStepSchema` instead of an untyped record:

```ts
{
  maxRequests: number;       // default 20, maximum 100
  rateLimitPerSec: number;   // default 2, maximum 10
  spiderMinutes: 1;          // z.literal(1)
  passiveWaitMinutes: 3;     // z.literal(3)
}
```

Do not expose spider or wait values as arbitrary CLI input.

Tool-run version handling:

- Create the running tool row with `toolVersion: null`.
- Extend `ScanRepository.updateToolRunStatus()` with an optional `toolVersion`.
- After a valid report is parsed, update the row with the report's `@version`.
- On failure before a valid report exists, leave `toolVersion` null and preserve the pinned image reference in metadata.
- Add a repository test proving that status, exit code, version, and metadata can be updated together.

Result semantics:

- valid report with alerts: completed with findings;
- valid report without alerts: completed with zero findings;
- ZAP exit 1 or 2 with valid report: completed;
- preflight failure: failed with a specific reason code;
- report validation failure: failed with `invalid_structured_output`;
- timeout: failed with `timed_out`;
- Docker or ZAP failure: failed with `execution_failed`.

### Task 8: Correct profile and CLI failure semantics

Add a dedicated profile:

```text
runtime-zap-baseline
```

Properties:

- category: `detailed`
- only step: ZAP Baseline
- ZAP step is required
- failure policy: `fail_profile`
- target: auto project start
- default max requests: 20
- default rate: 2 requests/second

Update:

```json
"scan:zap-baseline": "bun run api/cli/scan-profile.ts -- --profile runtime-zap-baseline --runner docker"
```

The dedicated runner must still reject host execution even if an environment policy attempts to select it.

For composite profiles:

- Keep ZAP optional in `full-security-scan`.
- Keep ZAP in `runtime-web-safe` only after the bounded gateway tests pass.
- If the gateway cannot be made reliable on a supported platform, remove ZAP from `runtime-web-safe` and keep it only in `runtime-zap-baseline` and `full-security-scan`.

Tests:

- standalone success exits 0;
- standalone ZAP failure exits non-zero;
- standalone target failure exits non-zero;
- composite optional ZAP failure returns `completed_with_warnings`;
- composite ZAP findings do not fail the profile;
- host runner request is rejected for ZAP;
- Nuclei behavior is unchanged.

### Task 9: Update summaries, UI, and documentation

Summary and UI must show:

- ZAP status;
- report version;
- image digest;
- finding count;
- forwarded target request count;
- budget-blocked request count;
- specific reason code;
- coverage effect.

Add `toolVersion` to `ToolSummary` and the corresponding web API type instead of reading it from an untyped metadata field.

Add Japanese reason labels for at least:

- `target_unreachable_from_container`
- `authentication_required`
- `policy_rejected`
- `invalid_structured_output`
- `timed_out`
- `execution_failed`

Documentation:

- Correct the Docker image syntax in `spec/third-party-scanners.md`.
- Record the multi-platform index and ZAP version.
- State that Java is contained in the ZAP image and is not a host dependency.
- State that ZAP is Docker-only.
- Explain that the gateway limits requests sent to the target.
- Clarify that ZAP Baseline spiders GET/HEAD resources but does not perform active attacks.
- Document the standalone profile and its failure semantics.

## 6. Security Invariants

All of these must be tested:

- ZAP never receives a target repository mount.
- ZAP never receives the Docker socket.
- ZAP never receives host credentials or secret environment variables.
- ZAP cannot execute user-provided command-line options.
- ZAP only targets the ephemeral gateway origin.
- The gateway only forwards to the validated loopback target.
- The gateway forwards only read-only methods.
- The gateway never forwards more than the configured target request budget.
- The gateway blocks out-of-origin redirects.
- The application is not rebound to `0.0.0.0`.
- Unredacted ZAP output never enters persistent artifact storage.
- Findings and evidence do not contain raw tokens or cookie values.
- A structurally invalid report can never produce a successful zero-finding scan.
- A failed standalone ZAP run can never return CLI exit code 0.

## 7. Verification Commands

Run targeted tests first:

```bash
bun test api/modules/dast/container-target-gateway.test.ts
bun test api/modules/runtime-scans/zap-baseline-runner.test.ts
bun test api/modules/runtime-scans/zap-normalizer.test.ts
bun test api/modules/runtime-scans/command-contracts.test.ts
bun test api/modules/runtime-scans/runtime-scanner-runner.test.ts
bun test api/modules/scans/profile-runner.test.ts
bun test api/modules/scans/tools/tool-process-runner.test.ts
```

Then run repository gates:

```bash
bun run typecheck
bun run lint
bun run format:check
bun run build:web
bun run verify
```

Live verification:

```bash
bun run scan:zap-baseline -- \
  --project-path /path/to/local-vite-fixture \
  --create-project true \
  --timeout-sec 300 \
  --final-report false \
  --json
```

Expected live result:

- runner is Docker;
- profile is `runtime-zap-baseline`;
- profile outcome is `completed`;
- ZAP step is completed;
- exit code is 0, 1, or 2;
- a valid redacted `zap-report.json` artifact exists;
- finding paths use the original loopback origin, not `unknown` or `host.docker.internal`;
- tool version is `2.17.0`;
- target forwarded request count is at most 20;
- no source repository mount appears in execution metadata;
- no ZAP container remains after completion.

Failure live checks:

1. Stop or reject the target and verify `target_unreachable_from_container`.
2. Return 401/403 and verify `authentication_required`.
3. Force a timeout and verify container and gateway cleanup.
4. Return an external redirect and verify the external trap server receives zero requests.
5. Include a fake token in a response and verify it is absent from the stored artifact and finding evidence.

## 8. Pull Request Sequence

Implement in reviewable slices.

### PR 1: Dedicated execution foundation

- image policy;
- dedicated Docker command builder;
- Docker-only enforcement;
- output mount;
- timeout and cleanup;
- runner unit tests.

PR 1 is not complete until a valid fixture report can be produced through the dedicated runner test path.

### PR 2: Bounded target gateway

- gateway implementation;
- request and path limits;
- Host rewrite;
- redirect policy;
- container preflight;
- gateway tests.

PR 2 is not complete until Vite is reachable without binding the application to `0.0.0.0`.

### PR 3: Report schema, normalization, and redaction

- Zod report schema;
- real sanitized fixture;
- instance-based normalizer;
- stable fingerprints;
- private redacted artifact storage;
- tests.

PR 3 is not complete while any fixture finding has path `unknown`.

### PR 4: Orchestration and user-facing semantics

- profile-runner integration;
- dedicated profile;
- CLI script;
- failure semantics;
- summary/UI/docs;
- regression tests.

PR 4 is not complete while a failed standalone ZAP scan returns exit code 0.

### PR 5: Cross-platform and live verification

- ARM64 and AMD64 verification;
- Docker Desktop and Linux bridge verification;
- external redirect trap;
- timeout cleanup;
- final repository gates.

Do not claim cross-platform support until the corresponding live lane passes.

## 9. Non-goals

Do not add:

- ZAP full scan;
- active scanner;
- authenticated contexts;
- session or cookie handoff;
- Ajax spider;
- browser automation;
- arbitrary target URLs;
- public internet targets;
- private network targets;
- user-supplied ZAP config files;
- user-supplied ZAP hooks or command options;
- automatic image or add-on updates;
- changes to Nuclei or Schemathesis behavior beyond regression fixes required by shared types.

## 10. Definition of Done

The recovery is complete only when:

1. the standalone ZAP command uses the pinned official Docker image;
2. no host Java or host ZAP installation is required;
3. the Vite fixture is reachable from ZAP without exposing the app on `0.0.0.0`;
4. no more than the configured number of requests reach the target;
5. a real ZAP report is structurally validated;
6. each alert instance is normalized with a real URL;
7. secrets are redacted before persistence;
8. exit codes and reason codes are correct;
9. failed standalone execution returns non-zero;
10. timeout cleanup leaves no gateway or container;
11. targeted tests and repository verification pass;
12. documentation accurately describes the image, version, execution boundary, and remaining non-goals.

## 11. Luna Handoff Instruction

Use this document as the implementation source of truth.

Before editing:

1. inspect the current dirty worktree;
2. preserve unrelated user changes;
3. capture the existing ZAP failure as a baseline;
4. implement the PR sequence in order;
5. do not weaken a security invariant to make a live test pass;
6. if a safe Docker bridge cannot be established on a platform, return a coverage gap instead of binding to all interfaces;
7. report every deviation from this plan before expanding scope.
