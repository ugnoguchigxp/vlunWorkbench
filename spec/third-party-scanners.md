# Third-party scanner distribution record

Phase 41 keeps scanner execution outside the target repository. The repository owns the command policy, output redaction, and artifact metadata; scanner binaries/images and their update operations are managed separately.

| Component | Intended use | License | Pin status |
| --- | --- | --- | --- |
| Nuclei engine `v3.8.0` / owned safe template set | safe, allowlisted loopback web templates | MIT (upstream) | pinned in toolbox; template root is `docker/toolbox/nuclei-safe-templates` |
| ZAP official image `zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2` (`2.17.0`) | Docker-only baseline passive scan through a bounded local gateway | Apache-2.0 (core; image dependencies require inventory) | immutable multi-platform image index; amd64 `c558ee87358911ab17278c70991e856f57793e115d9cd0f88ca475cf82907a1a`, arm64 `1110082c94217b6e9592b18934740108839a44c02f1d0e961e4933bbb98bab45` |
| Trivy | filesystem vulnerability, CycloneDX SBOM, existing-image scan | Apache-2.0 (upstream) | existing tool pin; image/SBOM modes use the same binary |
| Schemathesis `4.22.4` | bounded read-only API schema checks | MIT (upstream; Python dependencies require inventory) | pinned in toolbox |

Source URLs: [Nuclei](https://github.com/projectdiscovery/nuclei/releases/tag/v3.8.0), [Nuclei templates](https://github.com/projectdiscovery/nuclei-templates/releases/tag/v10.4.4), [ZAP image](https://hub.docker.com/r/zaproxy/zap-stable/tags), [Schemathesis](https://pypi.org/project/schemathesis/4.22.4/), [Trivy](https://github.com/aquasecurity/trivy).

Verification date: 2026-07-14. This file records the distribution gate, not a legal conclusion. Before shipping a toolbox or image, record the exact dependency license/NOTICE inventory and checksum output. Automatic template, add-on, vulnerability database, or registry credential updates are not part of a scan.

ZAP Baseline does not require host Java or a host ZAP installation. The `runtime-zap-baseline` profile runs the official image with a fixed passive command and sends requests only to the ephemeral gateway. The gateway forwards read-only GET/HEAD/OPTIONS requests within the configured path, rate, and request budget; it does not perform active attacks, authenticated scans, Ajax crawling, or browser automation.
