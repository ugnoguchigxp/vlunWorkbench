# Scanner adapters

vulnWorkbench separates scanner orchestration from scanner distribution. The
core registry accepts only adapters whose upstream engine is MIT or
Apache-2.0. Engines under other or proprietary licenses must use the optional
adapter path and are disabled by default.

## Included adapters

| Adapter | Engine license | Distribution |
| --- | --- | --- |
| `gitleaks` | MIT | core |
| `osv` | Apache-2.0 | core |
| `trivy` | Apache-2.0 | core |
| `semgrep` | LGPL-2.1-or-later | optional; engine not in core toolbox |

The manifest, runner factory, normalized finding converter, default command,
and Docker first-argument allowlist form one `StaticScannerAdapter` contract.
`runToolIntoExistingScan` depends only on that contract; adding an adapter does
not require another tool-specific branch in the profile runner.

## Enable the Semgrep adapter

For host execution, install the Semgrep executable separately and opt in:

```bash
VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep bun run dev
```

For Docker execution, build and select the separate adapter image:

```bash
bun run docker:toolbox:build
bun run docker:plugin:semgrep:build
```

Set the Runtime Settings scanner image to
`vuln-workbench-toolbox-semgrep:local` and set
`VULN_WORKBENCH_OPTIONAL_SCANNER_ADAPTERS=semgrep`. This exposes the optional
`semgrep-baseline` scan profile and `semgrep-path-recheck` reproduction profile.
`bun run scan:semgrep -- ...` is also an explicit opt-in CLI entry point.

## Add another adapter

1. Implement `StaticScannerAdapter` in `api/plugins/scanners/`. Keep all
   tool-specific option mapping inside `createRunner`.
2. Mark the manifest as `core` only for an MIT or Apache-2.0 engine. The
   registry rejects other licenses in that tier.
3. Add core adapters to `BUILTIN_STATIC_SCANNER_ADAPTERS`, or add non-core
   adapters to the optional adapter map and require an explicit environment
   opt-in.
4. If Docker execution is supported, provide a separate image for non-core
   engines. The adapter registry installs its narrow binary/first-argument
   execution policy when the adapter is registered.
5. Add a profile only when it accurately reflects the adapter's availability;
   never add a non-core adapter to a standard profile.

Adapter source code is not a declaration that the external engine is
redistributed. Record exact engine and packaged-dependency licenses before
publishing any optional image.
