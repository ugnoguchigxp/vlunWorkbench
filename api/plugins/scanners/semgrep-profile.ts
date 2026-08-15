import type {
	ScanProfile,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";

export function buildOptionalSemgrepProfile(
	scope: ScanScopePolicy,
): ScanProfile {
	return {
		id: "semgrep-baseline",
		name: "Semgrep SAST（任意 adapter）",
		description:
			"外部導入した Semgrep engine と vulnWorkbench 所有ルールを使う任意 SAST profile です。core toolbox には engine を含みません。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 600,
		scope,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis (optional)",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "curated-sast-v1" },
			},
		],
	};
}
