export const VERSION = "v1";
export const NOW = new Date("2026-07-06T12:00:00.000Z");
export const MISSING_SCAN_RUN_ID = "00000000-0000-4000-8000-000000000001";
export const RAW_SNIPPET_MARKER = "SECRET_FIXTURE_SNIPPET_SHOULD_NOT_LEAK";
export const RAW_ARTIFACT_MARKER =
	"SECRET_FIXTURE_ARTIFACT_BODY_SHOULD_NOT_LEAK";
export const RAW_REVIEW_MARKER = "SECRET_FIXTURE_REVIEW_BODY_SHOULD_NOT_LEAK";
export const RAW_TOKEN_MARKER = "SECRET_FIXTURE_TOKEN_SHOULD_NOT_LEAK";
export const RAW_SCANNER_MARKER =
	"SECRET_FIXTURE_SCANNER_STDOUT_SHOULD_NOT_LEAK";
export const REQUIRED_MCP_TOOLS = [
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_guardrail_material",
	"vuln_get_evidence_bundle",
	"vuln_get_verification_commands",
	"vuln_get_project_structure_snapshot",
] as const;
export type FixtureCheck = {
	name: string;
	status: "passed";
	detail?: Record<string, unknown>;
};
export type FixtureOptions = {
	keepTemp: boolean;
	skipMcp: boolean;
};
export type FixturePaths = {
	tempRoot: string;
	dbPath: string;
	artifactRoot: string;
	repoPath: string;
};
export type CommandResult = {
	label: string;
	status: number;
	stdout: string;
	stderr: string;
	payload: Record<string, unknown>;
};
export class FixtureFailure extends Error {
	constructor(
		message: string,
		readonly failedCheck?: string,
	) {
		super(message);
		this.name = "FixtureFailure";
	}
}
