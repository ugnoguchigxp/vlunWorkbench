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
