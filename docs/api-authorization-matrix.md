# API authorization matrix

This matrix is the release contract for the HTTP API. Route-local ownership
checks always apply in addition to the authentication level shown here.

| Route surface | Read | Mutation / execution | Additional boundary |
| --- | --- | --- | --- |
| `/api/health`, `/api/health/ready` | Public | N/A | Readiness returns only a generic state. |
| `/api/auth/login`, `/api/auth/refresh` | Public | Public | Normalized-email rate limit; refresh-cookie rotation. |
| `/api/auth/me`, `/api/auth/logout` | Authenticated | Authenticated | Session user only. |
| `/api/admin/**` | Admin | Admin | User lifecycle administration. |
| `/api/settings/system-context` | Authenticated | Authenticated | Per-user settings. |
| `/api/settings/llm/**` | Admin | Admin | Global provider settings, Codex status, and health checks. |
| `/api/sources/**` | Authenticated | Admin | Source health/tree/search/history are shared reads; folder/page/reindex writes are global administration. |
| `/api/projects` | Authenticated | Authenticated | Registration requires an existing, readable directory; its canonical path is stored. |
| `/api/projects/folder-picker` | Admin | Admin | Host filesystem discovery is never exposed to members. |
| `/api/projects/:projectId/**` | Project member | Project member | Project ownership lookup; path availability is revalidated before execution. |
| `/api/scans/**`, `/api/findings/**`, `/api/scan-reports/**` | Project member | Project member | Access follows the owning project through scan/finding/report relations. |
| `/api/reproduction-runs/**`, `/api/dynamic-runs/**`, `/api/dast-runs/**` | Project member | Project member | Bounded profiles only; project path is revalidated immediately before execution. |
| `/api/projects/:projectId/assessments/**`, `/api/projects/:projectId/active-assessment-runs/**` | Project owner | Project owner | Same-project engagement, target, encrypted auth contexts, cumulative RoE budget, and canonical origin/path/method scope are enforced before execution. |
| `/api/diagnostic-reports/**`, `/api/finding-reviews/**`, `/api/finding-decisions/**` | Project member | Project member | Access follows the related scan or finding. |
| `/api/static-intelligence/**` | Project member | Project member | Read/build access follows the related project or scan. |
| `/api/artifacts/**` | Authenticated owner | Authenticated owner | Artifact path is resolved from persisted metadata, never a caller path. |
| `/api/search/**`, `/api/agentic-search/**`, `/api/chat/**` | Authenticated | Authenticated | User-scoped conversations and bounded retrieval inputs. |
| `/api/scan-profiles` | Authenticated | N/A | Read-only profile catalog. |

## Enforcement and tests

- `api/app/hono.ts` installs authentication before protected route
  registration.
- `requireAdmin` and `requireAdminForMutation` provide the global admin
  boundary.
- Route repositories resolve project ownership without accepting a user-supplied
  ownership claim.
- `api/app/hono.test.ts`, `api/middleware/auth.test.ts`,
  `api/routes/settings.route.test.ts`, `api/routes/sources.route.test.ts`, and
  the project/scan/finding route tests are the executable contract.
- Any new endpoint must update this matrix and add an unauthenticated,
  wrong-role, or wrong-owner test as applicable.
