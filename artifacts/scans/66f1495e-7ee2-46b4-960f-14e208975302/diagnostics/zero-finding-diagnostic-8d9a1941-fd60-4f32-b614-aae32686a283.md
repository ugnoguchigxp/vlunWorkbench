# Zero Finding Diagnostic Summary

## Result
No normalized findings were produced by scan 66f1495e-7ee2-46b4-960f-14e208975302. Diagnostic context includes 107 attack surface items and 10 security check results.

Project: todolist (e0851efa-2968-4773-a197-033ff37a7edf)  
Scan: 66f1495e-7ee2-46b4-960f-14e208975302 / detailed-security / completed

## Checked Categories
| Category | Inventory Items | Check Results |
| --- | ---: | ---: |
| api_route | 22 | 0 |
| artifact | 0 | 1 |
| auth | 0 | 2 |
| auth_boundary | 37 | 0 |
| config | 0 | 2 |
| configuration_boundary | 27 | 0 |
| database_write | 9 | 0 |
| execution | 0 | 3 |
| execution_boundary | 1 | 0 |
| external_call | 1 | 0 |
| file_path_boundary | 10 | 0 |
| path | 0 | 1 |
| scan | 0 | 1 |

## Attack Surface Inventory
| Category | Kind | Name | Location | Confidence |
| --- | --- | --- | --- | --- |
| api_route | hono_route | GET * | api/app/hono.ts:139 | medium |
| api_route | hono_route | GET / | api/routes/health.route.ts:4 | medium |
| api_route | hono_route | GET / | api/routes/todo.route.ts:45 | medium |
| api_route | hono_route | GET /me | api/routes/auth.route.ts:46 | medium |
| api_route | hono_route | GET /protected | api/middleware/auth.test.ts:41 | medium |
| api_route | hono_route | GET Access-Control-Allow-Credentials | api/app/hono.test.ts:83 | medium |
| api_route | hono_route | GET Access-Control-Allow-Origin | api/app/hono.test.ts:82 | medium |
| api_route | hono_route | GET Access-Control-Allow-Origin | api/app/hono.test.ts:90 | medium |
| api_route | hono_route | GET Content-Type | api/app/hono.test.ts:114 | medium |
| api_route | hono_route | GET authUser | api/middleware/auth.test.ts:42 | medium |
| api_route | hono_route | GET authUser | api/modules/auth/context.ts:12 | medium |
| api_route | hono_mount | MOUNT /api | api/app/hono.ts:135 | medium |
| api_route | hono_mount | MOUNT /auth | api/routes/auth.route.test.ts:56 | medium |
| api_route | hono_route | PATCH /:id | api/routes/todo.route.ts:69 | medium |
| api_route | hono_route | PATCH /:id/completion | api/routes/todo.route.ts:90 | medium |
| api_route | hono_route | POST / | api/routes/todo.route.ts:51 | medium |
| api_route | hono_route | POST /api/test-generic-error | api/app/hono.test.ts:60 | medium |
| api_route | hono_route | POST /api/test-hono-http-exception | api/app/hono.test.ts:56 | medium |
| api_route | hono_route | POST /api/test-http-error | api/app/hono.test.ts:52 | medium |
| api_route | hono_route | POST /login | api/routes/auth.route.ts:22 | medium |
| api_route | hono_route | POST /logout | api/routes/auth.route.ts:40 | medium |
| api_route | hono_route | POST /refresh | api/routes/auth.route.ts:31 | medium |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:13 | high |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:23 | high |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:33 | high |
| auth_boundary | auth_guard | AuthService | api/cli/auth-create-admin.ts:5 | high |
| auth_boundary | auth_guard | AuthService | api/cli/auth-create-admin.ts:73 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.test.ts:6 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.test.ts:38 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.ts:7 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.ts:11 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.test.ts:5 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.test.ts:9 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.test.ts:12 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.test.ts:48 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.ts:58 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.test.ts:6 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.test.ts:53 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.test.ts:59 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.ts:6 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.ts:16 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:3 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:6 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:17 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:27 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:28 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:33 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.test.ts:45 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.ts:11 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/routes/auth.route.ts:12 | high |

## Passed Checks
- Authentication cookie security is reviewed: Authentication cookie security settings were observed.
- Production JWT secret is enforced: JWT secret configuration handling was observed.
- Tool execution uses structured arguments: Execution boundaries were observed and no shell option signal was detected.
- Repository and artifact paths use scope guards: Path normalization or scoped workspace guards were observed.
- Zero-finding scan has diagnostic coverage context: The zero-finding scan has 107 inventory items and 4 tool runs available for coverage context.

## Warnings and Manual Review
- [manual_review] Artifact downloads are scoped to owner: Artifact access exists, but ownership enforcement was not deterministically proven for every download path.
- [manual_review] Admin routes require admin guard: Admin route guard was not confirmed from inventory.
- [manual_review] Project routes require authentication: Could not confirm authentication middleware for project workflow routes from inventory.
- [manual_review] Runner environment scrubs sensitive values: Sensitive environment scrubbing was not confirmed.

## Coverage Gaps
- artifact.download_scoped_to_owner: Review artifact and diagnostic report download routes for scan project ownership checks.
- auth.admin_routes_require_admin: Review admin routes and ensure requireAdmin is applied after authentication.
- auth.required_for_project_routes: Review Hono middleware registration for project, scan, finding, and report routes.
- execution.docker_no_socket_mount: Run attack surface inventory with execution boundary extraction.
- execution.runner_scrubs_sensitive_env: Review scanner and Docker runner environment construction.

## Residual Risk
- zero_finding_interpretation: No normalized findings does not prove that vulnerabilities do not exist.
- coverage_gap: Some diagnostic categories were not checked or require manual review.
- runtime_behavior: Runtime and authenticated browser behavior may remain untested unless DAST/dynamic checks were run separately.

## Recommended Next Actions
- Review manual_review and not_checked security check results.: Close diagnostic coverage gaps before treating the scan as low risk.

This report does not claim that the project is safe. It describes checked evidence, unchecked areas, and residual risk for this scan.
