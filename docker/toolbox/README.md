# vulnWorkbench Docker Toolbox

This image contains the scan tools used by the Docker runner:

- Gitleaks
- OSV-Scanner
- Trivy
- zizmor
- Nuclei
- Schemathesis
- Cosign
- slsa-verifier

Build locally:

```bash
bun run docker:toolbox:build
```

Smoke check:

```bash
docker run --rm --network none vuln-workbench-toolbox:local gitleaks version
docker run --rm --network none vuln-workbench-toolbox:local osv-scanner --version
docker run --rm --network none vuln-workbench-toolbox:local trivy --version
docker run --rm --network none vuln-workbench-toolbox:local st --version
docker run --rm --network none vuln-workbench-toolbox:local cosign version
docker run --rm --network none vuln-workbench-toolbox:local zizmor --version
docker run --rm --network none vuln-workbench-toolbox:local slsa-verifier version
```

The runner mounts the target repository at `/workspace/repo` as read-only and writes tool output through `/workspace/out`.
Cosign attestation verification uses the same read-only mount and always runs
with Docker networking disabled. The production Sigstore trusted root is
tree-locked in scanner data and passed with `--trusted-root`, so Rekor inclusion
and certificate checks do not fall back to a runtime TUF download.
zizmor inspects checked-out GitHub Actions workflow/action files with
`--offline`; it does not require a CI job, GitHub token, or GitHub API access.
slsa-verifier checks a local artifact and local provenance against explicit
source, builder, and ref expectations. It also does not require CI, but its
Sigstore TUF trust-root refresh requires the SLSA profile's explicit Docker
`--network default` exception. Other toolbox scans remain network-disabled.
The image pins its base digest and verifies every downloaded release asset
against the upstream checksum manifest. Both `linux/amd64` and `linux/arm64`
are supported.

Run it without ambient privileges:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --tmpfs /workspace/out:rw,noexec,nosuid,size=256m \
  vuln-workbench-toolbox:local gitleaks version
```

Semgrep is intentionally not part of this core image because its engine is
LGPL-2.1-or-later. To opt in, build the separate adapter image and select it in
Runtime Settings:

```bash
bun run docker:plugin:semgrep:build
VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep bun run dev
```

Set the Docker scanner image to `vuln-workbench-toolbox-semgrep:local` when the
optional adapter should run in Docker. The adapter image extends the core image;
it is not built or distributed by the default toolbox build.
The legacy optional-adapter setting selects Semgrep as `preferred`: an absent
or failed engine is reported as a SAST coverage gap without failing the core
profile. Use `VULN_WORKBENCH_REQUIRED_SCANNER_ADAPTERS=semgrep` only when
Semgrep must be an admission requirement.

Schemathesis runs directly for the host-gateway path. In an isolated runtime
namespace it is launched through `vwb-schemathesis-readonly-gateway`. The
wrapper reads an ephemeral, read-only policy file, injects any saved API auth
headers only toward the target, enforces the exact OpenAPI operation list or
GraphQL Query-only POST endpoint, and keeps credentials out of argv and logs.

After building the core image, qualify the wrapper with a real Schemathesis run
plus Query/Mutation and auth-redaction checks:

```bash
bun run qualify:schemathesis-gateway
```
