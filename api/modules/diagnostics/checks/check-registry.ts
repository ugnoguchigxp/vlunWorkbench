import type { SecurityCheckDefinition } from "../types";

export const SECURITY_CHECK_DEFINITIONS: SecurityCheckDefinition[] = [
	{
		checkId: "auth.required_for_project_routes",
		title: "Project routes require authentication",
		category: "auth_boundary",
		severityHint: "high",
		description:
			"Project, scan, finding, report, reproduction, dynamic, and DAST routes should be protected by authentication middleware.",
		inputKinds: ["api_route", "auth_boundary"],
	},
	{
		checkId: "auth.admin_routes_require_admin",
		title: "Admin routes require admin guard",
		category: "auth_boundary",
		severityHint: "high",
		description: "Admin API routes should be protected by requireAdmin.",
		inputKinds: ["api_route", "auth_boundary"],
	},
	{
		checkId: "artifact.download_scoped_to_owner",
		title: "Artifact downloads are scoped to owner",
		category: "artifact_access",
		severityHint: "high",
		description:
			"Artifact and report download endpoints should verify project ownership before reading stored artifact paths.",
		inputKinds: ["artifact_access", "api_route"],
	},
	{
		checkId: "path.repo_access_uses_scope_guard",
		title: "Repository and artifact paths use scope guards",
		category: "file_path_boundary",
		severityHint: "high",
		description:
			"Repo and artifact path access should use path normalization, relative checks, or scoped workspaces.",
		inputKinds: ["file_path_boundary"],
	},
	{
		checkId: "execution.no_shell_string_for_tool_runs",
		title: "Tool execution uses structured arguments",
		category: "execution_boundary",
		severityHint: "high",
		description:
			"Tool and runner execution should use structured argument arrays instead of shell command strings.",
		inputKinds: ["execution_boundary"],
	},
	{
		checkId: "execution.runner_scrubs_sensitive_env",
		title: "Runner environment scrubs sensitive values",
		category: "execution_boundary",
		severityHint: "high",
		description:
			"Scanner and Docker runners should not inherit LLM/API keys, tokens, passwords, or private credentials.",
		inputKinds: ["execution_boundary", "configuration_boundary"],
	},
	{
		checkId: "execution.docker_no_socket_mount",
		title: "Docker runners do not mount Docker socket",
		category: "execution_boundary",
		severityHint: "critical",
		description:
			"Docker-based scan, dynamic, reproduction, and DAST runners should not mount the host Docker socket.",
		inputKinds: ["execution_boundary"],
	},
	{
		checkId: "config.production_jwt_secret_required",
		title: "Production JWT secret is enforced",
		category: "configuration_boundary",
		severityHint: "high",
		description:
			"Production configuration should reject missing, weak, or default JWT signing secrets.",
		inputKinds: ["configuration_boundary"],
	},
	{
		checkId: "config.cookie_security_reviewed",
		title: "Authentication cookie security is reviewed",
		category: "configuration_boundary",
		severityHint: "medium",
		description:
			"Authentication cookies should use httpOnly, SameSite, and environment-aware Secure attributes.",
		inputKinds: ["configuration_boundary", "auth_boundary"],
	},
	{
		checkId: "scan.zero_finding_has_coverage_context",
		title: "Zero-finding scan has diagnostic coverage context",
		category: "diagnostic_coverage",
		severityHint: "info",
		description:
			"A scan with no normalized findings should still have inventory and check results that explain checked and unchecked areas.",
		inputKinds: ["api_route", "security_check_result"],
	},
];
