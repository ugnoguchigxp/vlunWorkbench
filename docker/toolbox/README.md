# vulnWorkbench Docker Toolbox

This image contains the scan tools used by the Docker runner:

- Gitleaks
- OSV-Scanner
- Trivy
- Nuclei
- Schemathesis

Build locally:

```bash
bun run docker:toolbox:build
```

Smoke check:

```bash
docker run --rm --network none vuln-workbench-toolbox:local gitleaks version
docker run --rm --network none vuln-workbench-toolbox:local osv-scanner --version
docker run --rm --network none vuln-workbench-toolbox:local trivy --version
```

The runner mounts the target repository at `/workspace/repo` as read-only and writes tool output through `/workspace/out`.
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
