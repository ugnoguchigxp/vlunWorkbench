import type { ArtifactStorage } from "./artifact-storage";
import type { NormalizedFinding } from "./normalizers/fixture";
import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
import { normalizeSemgrep } from "./normalizers/semgrep";
import { normalizeTrivy } from "./normalizers/trivy";
import { GitleaksRunner } from "./tools/gitleaks-runner";
import { OsvRunner } from "./tools/osv-runner";
import { SemgrepRunner } from "./tools/semgrep-runner";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";
import { TrivyRunner } from "./tools/trivy-runner";

export function selectStaticTool(params: {
	toolId: string;
	artifactStorage: ArtifactStorage;
	execution: ToolExecutionConfig;
	options: Record<string, unknown>;
}): {
	runner: SemgrepRunner | GitleaksRunner | OsvRunner | TrivyRunner;
	normalizer: (
		rawJson: unknown,
		opts?: { stderr?: string },
	) => NormalizedFinding[];
	toolName: string;
	defaultCommand: string;
} {
	switch (params.toolId) {
		case "semgrep":
			return {
				runner: new SemgrepRunner(params.artifactStorage, params.execution),
				normalizer: normalizeSemgrep,
				toolName: "semgrep",
				defaultCommand: `semgrep scan --config ${params.options.config ?? "curated-sast-v1"}`,
			};
		case "gitleaks":
			return {
				runner: new GitleaksRunner(params.artifactStorage, params.execution),
				normalizer: normalizeGitleaks,
				toolName: "gitleaks",
				defaultCommand: "gitleaks detect",
			};
		case "osv":
			return {
				runner: new OsvRunner(params.artifactStorage, params.execution),
				normalizer: normalizeOsv,
				toolName: "osv",
				defaultCommand: "osv-scanner",
			};
		case "trivy":
			return {
				runner: new TrivyRunner(params.artifactStorage, params.execution),
				normalizer: normalizeTrivy,
				toolName: "trivy",
				defaultCommand: "trivy fs",
			};
		default:
			throw new Error(`Unsupported tool ID: ${params.toolId}`);
	}
}
