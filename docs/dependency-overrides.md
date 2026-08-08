# Dependency override policy

Package overrides are temporary security and reproducibility controls. The
dependency owner reviews them monthly and removes an override once every direct
consumer naturally resolves to the same or a newer patched version.

Owner: vulnWorkbench maintainers
Next review: 2026-08-24
Maximum review interval: 31 days

| Package | Pinned version | Reason |
| --- | --- | --- |
| `@hono/node-server` | `2.0.10` | Keep the transitive Hono adapter on the audited release. |
| `brace-expansion` | `5.0.9` | Exclude vulnerable transitive range used by build tooling. |
| `esbuild` | `0.28.1` | Lock the build service to the audited Vite-compatible release. |
| `fast-uri` | `3.1.5` | Exclude vulnerable JSON-schema resolver versions. |
| `hono` | `4.12.34` | Keep all direct and transitive Hono copies on one audited version. |
| `minimatch` | `10.2.5` | Keep transitive glob consumers on the audited release. |
| `nanoid` | `3.3.17` | Exclude vulnerable identifier generator versions used by PostCSS. |
| `picomatch` | `4.0.4` | Exclude vulnerable glob-matching versions in tooling. |
| `postcss` | `8.5.23` | Keep Tailwind/Vite consumers on one audited parser release. |
| `rollup` | `4.62.0` | Lock the production bundler to the audited release. |
| `undici` | `7.29.0` | Use the audited HTTP transport used by the pinned-address LLM boundary. |
| `js-yaml` | `3.15.1` | Exclude vulnerable YAML parser versions used by gray-matter. |
| `vite` | `8.0.16` | Keep direct and transitive Vite copies aligned. |
| `ws` | `8.21.0` | Exclude vulnerable WebSocket transitive versions. |

`bun run check:audit` blocks moderate, high, and critical advisories. An
exception requires an advisory identifier, non-applicability evidence, owner,
and expiry date in this file; there are currently no exceptions.
