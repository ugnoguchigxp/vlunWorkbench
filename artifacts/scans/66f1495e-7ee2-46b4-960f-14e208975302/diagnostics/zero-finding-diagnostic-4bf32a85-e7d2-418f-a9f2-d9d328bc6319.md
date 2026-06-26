# Zero Finding Diagnostic Summary

## Result
No normalized findings were produced by scan 66f1495e-7ee2-46b4-960f-14e208975302. Diagnostic context includes 64 attack surface items and 10 security check results.

Project: todolist (e0851efa-2968-4773-a197-033ff37a7edf)  
Scan: 66f1495e-7ee2-46b4-960f-14e208975302 / detailed-security / completed

## Checked Categories
| Category | Inventory Items | Check Results |
| --- | ---: | ---: |
| api_route | 12 | 0 |
| artifact_access | 0 | 1 |
| auth_boundary | 16 | 2 |
| configuration_boundary | 15 | 2 |
| database_write | 9 | 0 |
| diagnostic_coverage | 0 | 1 |
| execution_boundary | 1 | 3 |
| external_call | 1 | 0 |
| file_path_boundary | 10 | 1 |

## Attack Surface Inventory
| Category | Kind | Name | Location | Confidence |
| --- | --- | --- | --- | --- |
| api_route | hono_route | GET * | api/app/hono.ts:139 | medium |
| api_route | hono_route | GET / | api/routes/health.route.ts:4 | medium |
| api_route | hono_route | GET / | api/routes/todo.route.ts:45 | medium |
| api_route | hono_route | GET /me | api/routes/auth.route.ts:46 | medium |
| api_route | hono_route | GET authUser | api/modules/auth/context.ts:12 | medium |
| api_route | hono_mount | MOUNT /api | api/app/hono.ts:135 | medium |
| api_route | hono_route | PATCH /:id | api/routes/todo.route.ts:69 | medium |
| api_route | hono_route | PATCH /:id/completion | api/routes/todo.route.ts:90 | medium |
| api_route | hono_route | POST / | api/routes/todo.route.ts:51 | medium |
| api_route | hono_route | POST /login | api/routes/auth.route.ts:22 | medium |
| api_route | hono_route | POST /logout | api/routes/auth.route.ts:40 | medium |
| api_route | hono_route | POST /refresh | api/routes/auth.route.ts:31 | medium |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:13 | high |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:23 | high |
| auth_boundary | auth_guard | AuthService | api/app/hono.ts:33 | high |
| auth_boundary | auth_guard | AuthService | api/cli/auth-create-admin.ts:5 | high |
| auth_boundary | auth_guard | AuthService | api/cli/auth-create-admin.ts:73 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.ts:7 | high |
| auth_boundary | auth_guard | AuthService | api/middleware/auth.ts:11 | high |
| auth_boundary | auth_guard | AuthService | api/modules/auth/auth.service.ts:58 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.ts:6 | high |
| auth_boundary | auth_guard | AuthService | api/routes/auth.route.ts:16 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/modules/auth/context.ts:11 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/routes/auth.route.ts:12 | high |
| auth_boundary | auth_guard | getAuthContextUser | api/routes/auth.route.ts:47 | high |
| auth_boundary | auth_guard | requireAuth | api/app/hono.ts:12 | high |
| auth_boundary | auth_guard | requireAuth | api/app/hono.ts:122 | high |
| auth_boundary | auth_guard | requireAuth | api/middleware/auth.ts:26 | high |
| configuration_boundary | security_config | CORS_ORIGINS | api/app/env.ts:47 | medium |
| configuration_boundary | security_config | CORS_ORIGINS | api/app/env.ts:107 | medium |
| configuration_boundary | security_config | JWT_SECRET | api/app/env.ts:51 | medium |
| configuration_boundary | security_config | JWT_SECRET | api/app/env.ts:86 | medium |
| configuration_boundary | security_config | JWT_SECRET | api/app/env.ts:89 | medium |
| configuration_boundary | security_config | JWT_SECRET | api/app/env.ts:121 | medium |
| configuration_boundary | security_config | csrf | api/app/hono.ts:4 | medium |
| configuration_boundary | security_config | csrf | api/app/hono.ts:78 | medium |
| configuration_boundary | security_config | httpOnly | api/modules/auth/auth-cookies.ts:38 | medium |
| configuration_boundary | security_config | httpOnly | api/modules/auth/auth-cookies.ts:46 | medium |
| configuration_boundary | security_config | httpOnly | web/src/views/home-view.tsx:11 | medium |
| configuration_boundary | security_config | sameSite | api/modules/auth/auth-cookies.ts:40 | medium |
| configuration_boundary | security_config | sameSite | api/modules/auth/auth-cookies.ts:48 | medium |
| configuration_boundary | security_config | secureHeaders | api/app/hono.ts:9 | medium |
| configuration_boundary | security_config | secureHeaders | api/app/hono.ts:64 | medium |
| database_write | db_write | db.delete | api/modules/auth/token.service.ts:87 | medium |
| database_write | db_write | db.delete | api/modules/auth/token.service.ts:121 | medium |
| database_write | db_write | db.insert | api/modules/auth/auth.service.ts:148 | medium |
| database_write | db_write | db.insert | api/modules/auth/token.service.ts:56 | medium |
| database_write | db_write | db.insert | api/routes/todo.route.ts:55 | medium |
| database_write | db_write | db.update | api/modules/auth/auth.service.ts:117 | medium |
| database_write | db_write | db.update | api/modules/auth/token.service.ts:12 | medium |

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
