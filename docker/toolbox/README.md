# vulnWorkbench Docker Toolbox

This image contains the scan tools used by the Docker runner:

- Semgrep
- Gitleaks
- OSV-Scanner
- Trivy

Build locally:

```bash
bun run docker:toolbox:build
```

Smoke check:

```bash
docker run --rm --network none vuln-workbench-toolbox:local semgrep --version
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
  vuln-workbench-toolbox:local semgrep --version
```
