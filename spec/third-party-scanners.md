# Third-party scanner distribution record

Scanner execution stays outside the target repository. The repository owns the command policy, output redaction, artifact metadata, and adapter contracts; scanner binaries/images and their update operations are managed separately. Core distribution is limited to MIT/Apache-2.0 engines. Other licenses require an explicitly enabled optional adapter and a separately built image.

| Component | Intended use | License | Pin and data status |
| --- | --- | --- | --- |
| Semgrep `1.171.0` | optional owned-rule static analysis with JSON output | LGPL-2.1-or-later (engine; packaged dependencies require inventory) | Not in the core toolbox or standard profiles; separately built adapter image, explicitly enabled with `VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep` |
| Gitleaks `8.30.1` | secret detection | MIT (upstream) | source commit and source archive SHA-256 pinned; built with the pinned Go toolchain |
| OSV-Scanner `2.4.0` | lockfile / manifest dependency analysis | Apache-2.0 (upstream) | source commit and archive SHA-256 pinned; toolbox build embeds a hashed npm offline database with a 168-hour freshness limit |
| Nuclei engine `v3.11.0` / owned safe template set | safe, allowlisted loopback web templates | MIT (upstream) | pinned in toolbox; template root is `docker/toolbox/nuclei-safe-templates` |
| ZAP official image `zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2` (`2.17.0`) | Docker-only baseline passive scan through a bounded local gateway | Apache-2.0 (core; image dependencies require inventory) | immutable multi-platform image index; amd64 `c558ee87358911ab17278c70991e856f57793e115d9cd0f88ca475cf82907a1a`, arm64 `1110082c94217b6e9592b18934740108839a44c02f1d0e961e4933bbb98bab45` |
| Trivy `0.72.0` | filesystem vulnerability, CycloneDX SBOM, existing-image scan | Apache-2.0 (upstream) | source commit/archive and patched Go dependencies pinned; toolbox build embeds a hashed vulnerability DB with a 168-hour freshness limit |
| Schemathesis `4.24.2` | bounded read-only API schema checks | MIT (upstream; Python dependencies require inventory) | pinned in toolbox |

Source URLs: [Semgrep](https://pypi.org/project/semgrep/1.171.0/), [Gitleaks](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), [OSV-Scanner](https://github.com/google/osv-scanner/releases/tag/v2.4.0), [Nuclei](https://github.com/projectdiscovery/nuclei/releases/tag/v3.11.0), [Nuclei templates](https://github.com/projectdiscovery/nuclei-templates/releases/tag/v10.4.4), [ZAP image](https://hub.docker.com/r/zaproxy/zap-stable/tags), [Schemathesis](https://pypi.org/project/schemathesis/4.24.2/), [Trivy](https://github.com/aquasecurity/trivy/releases/tag/v0.72.0).

Verification date: 2026-07-30. This file records the distribution gate, not a legal conclusion. Before shipping a toolbox or image, record the exact dependency license/NOTICE inventory and checksum output. Automatic template, add-on, vulnerability database, or registry credential updates are not part of a scan.

`scripts/prepare-scanner-data.ts` is the only supported data refresh path. It
copies owned Semgrep rules, downloads the OSV npm offline database and Trivy
vulnerability database, hashes each data tree, and emits a manifest with source
references, generation time, freshness limit, and ecosystem coverage. The
result is supplied to `docker/toolbox/Dockerfile` as the named `scanner-data`
build context by `scripts/build-toolbox-image.ts`. A direct Docker build without
that named context is intentionally not the release build path.

`bun run verify:toolbox-offline` starts the core image with
`--network none`, 4 GiB memory, 2 CPUs, and a 512 PID limit and requires valid
JSON from OSV-Scanner and Trivy. The output records the image digest
and the embedded manifest hash. OSV coverage is currently npm-only; other
ecosystems remain an explicit coverage limitation.

When the optional adapter is enabled, the default Semgrep configuration is `owned`, not registry `auto`. The
`curated-sast-v1` catalog currently contains 45 repository-owned rules across
five languages. This is a reproducible curated SAST layer; its measured
capability remains limited to the checked-in rule catalog and fixtures.
`--config auto` remains an explicit developer exploration option and is recorded
as `reproducible=false`; a custom unpinned configuration is treated the same way.
No third-party community rules are redistributed by this repository.

The toolbox rebuilds Gitleaks, OSV-Scanner, and Nuclei from checksum-verified
release source with Go 1.26.5. Trivy 0.72.0 is rebuilt by
`scripts/build-toolbox-image.ts` with patched containerd, gRPC, and ORAS
dependencies before it is copied into the final image. CI performs the same
source build in the Docker `trivy-binary` stage.

Exception owner: vulnWorkbench maintainers. The following four time-bounded
exceptions expire on 2026-10-24. `CVE-2026-34040` is scoped
to the `github.com/docker/docker` package embedded in OSV-Scanner. The issue
requires a Docker daemon using body-inspecting AuthZ plugins; vulnWorkbench
does not mount a Docker socket into the toolbox and invokes OSV-Scanner only
for filesystem analysis. `CVE-2026-52869`, `CVE-2026-52870`, and
`CVE-2026-59950` are scoped to the MCP Python SDK version required by Semgrep;
they affect HTTP/WebSocket MCP server transports or experimental MCP task
handlers, none of which the Semgrep CLI starts. Exact package paths and PURLs
are constrained in `.trivyignore.yaml`.

ZAP Baseline does not require host Java or a host ZAP installation. The `runtime-zap-baseline` profile runs the official image with a fixed passive command and sends requests only to the ephemeral gateway. The gateway forwards read-only GET/HEAD/OPTIONS requests within the configured path, rate, and request budget; it does not perform active attacks, authenticated scans, Ajax crawling, or browser automation.

Authenticated browser checks use the application's pinned Playwright
development dependency and a locally installed pinned Chromium build; browser
binaries are not distributed in the scanner toolbox. Active ZAP/API attack
profiles and external benchmark corpora are not distributed by this release and
must not be inferred from the passive ZAP or owned-fixture capability results.
