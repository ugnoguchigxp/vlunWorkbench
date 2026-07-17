# Project Structure Scanner rollout

`PROJECT_STRUCTURE_SCANNER_MODE` controls Project Structure v2 rollout. The
legacy `STATIC_INTELLIGENCE_PROJECT_STRUCTURE_MODE` name remains accepted while
deployments migrate.

| Mode | Build/persist | Primary read path |
| --- | --- | --- |
| `v1` | v2 scanner with v1 compatibility artifact only | v1 |
| `dual` | atomic v2 + v1 + export triple | v1 |
| `v2` or `v2_preferred` | atomic v2 + v1 + export triple | v2, with historical v1 fallback |

The scanner always uses the canonical v2 analysis pipeline. `v1` is a rollback
mode for persisted/read contracts, not a return to the removed duplicate file
walker. Existing v2 artifacts are retained when rolling back.

Every build emits one `project_structure_comparison` JSON event containing only
mode, duration, aggregate file/reference counts, and diagnostic counts. Paths,
source text, config values, and excluded secret names are never logged.

Promotion checks:

1. `dual`: CSS false positives are zero, v1 contract tests pass, and incomplete
   v2 triples are rejected.
2. `v2_preferred`: readiness isolation, module candidates, Web/API, MCP, and
   historical v1 fallback tests pass.
3. Rollback: set the mode to `v1`; no database migration or artifact deletion is
   required.
