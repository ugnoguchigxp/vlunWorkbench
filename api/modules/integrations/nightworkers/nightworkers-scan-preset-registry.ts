import type {
	IntegrationCapabilities,
	IntegrationScanPreset,
	IntegrationScanSelection,
	IntegrationTargetKind,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import { getProfileById, SCAN_PROFILES } from "../../scans/profiles";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";

type PresetTargetDefinition = {
	profileRef: string;
	warnings?: string[];
};

const PRESET_DEFINITIONS: Array<{
	id: IntegrationScanPreset["id"];
	displayName: string;
	description: string;
	recommended: boolean;
	targets: Partial<Record<IntegrationTargetKind, PresetTargetDefinition>>;
}> = [
	{
		id: "quick",
		displayName: "クイック",
		description: "主要な静的・シークレット・依存関係検査を短時間で実行します。",
		recommended: false,
		targets: {
			working_tree: { profileRef: "diff-source-baseline" },
			full: { profileRef: "source-baseline" },
		},
	},
	{
		id: "standard",
		displayName: "標準",
		description:
			"日常利用向けの静的・シークレット・依存関係・設定検査を実行します。",
		recommended: true,
		targets: {
			working_tree: { profileRef: "diff-basic-security" },
			full: { profileRef: "basic-security" },
		},
	},
	{
		id: "deep",
		displayName: "詳細",
		description:
			"生成物やinstalled dependency treeを含む詳細な静的検査を実行します。",
		recommended: false,
		targets: {
			full: {
				profileRef: "detailed-security",
				warnings: ["通常より長い実行時間と多くのCPU・メモリを使用します。"],
			},
		},
	},
];

function supportedIntegrationTargets(
	profile: ScanProfile,
): IntegrationTargetKind[] {
	const supported = profile.supportedTargets ?? ["full"];
	return (["working_tree", "full"] as const).filter((kind) =>
		supported.includes(kind),
	);
}

function stepId(step: ScanProfileStep): string {
	if (step.kind === "static_tool") return step.toolId;
	if (step.kind === "dast") return `dast:${step.profileId}`;
	return `${step.kind}:${step.adapter}`;
}

function toolCategory(toolId: string): string {
	if (toolId === "gitleaks") return "secret";
	if (toolId === "osv") return "dependency";
	if (toolId === "trivy") return "filesystem";
	if (toolId === "semgrep") return "static";
	return "security";
}

function profileCategories(profile: ScanProfile): string[] {
	const categories = new Set(
		profile.tools.map((tool) => toolCategory(tool.toolId)),
	);
	for (const step of profile.steps ?? []) {
		if (step.kind === "dast" || step.kind === "runtime_scanner") {
			categories.add("runtime");
		} else if (step.kind === "api_schema_scan") {
			categories.add("api");
		} else if (step.kind === "sbom_export") {
			categories.add("sbom");
		} else if (step.kind === "container_image_scan") {
			categories.add("container");
		}
	}
	return [...categories];
}

function profileRequirements(profile: ScanProfile): string[] {
	const requirements = new Set<string>();
	for (const step of profile.steps ?? []) {
		if (
			step.kind === "dast" ||
			step.kind === "runtime_scanner" ||
			step.kind === "api_schema_scan"
		) {
			requirements.add("runtime_project_start");
		}
		if (step.kind === "container_image_scan") {
			requirements.add("existing_container_image");
		}
	}
	return [...requirements];
}

function profileWarnings(profile: ScanProfile): string[] {
	const warnings: string[] = [];
	if (profileRequirements(profile).includes("runtime_project_start")) {
		warnings.push(
			"対象アプリケーションの自動起動とlocal HTTP accessが必要です。",
		);
	}
	if (profile.scope?.includeInstalledDependencies) {
		warnings.push(
			"installed dependency treeを含むため実行時間が長くなります。",
		);
	}
	return warnings;
}

function resolveProfile(profileRef: string): ScanProfile {
	const profile = getProfileById(profileRef);
	if (!profile?.enabled) {
		throw new NightworkersIntegrationError(
			"profile_not_allowed",
			"The requested scan profile is not available.",
		);
	}
	return profile;
}

export function listNightworkersPresets(
	allowedProfileRefs: readonly string[],
): IntegrationScanPreset[] {
	const allowed = new Set(allowedProfileRefs);
	return PRESET_DEFINITIONS.map((preset) => ({
		id: preset.id,
		displayName: preset.displayName,
		description: preset.description,
		recommended: preset.recommended,
		targets: (["working_tree", "full"] as const).flatMap((kind) => {
			const definition = preset.targets[kind];
			if (!definition || !allowed.has(definition.profileRef)) return [];
			const profile = resolveProfile(definition.profileRef);
			if (!supportedIntegrationTargets(profile).includes(kind)) return [];
			return [
				{
					kind,
					profileRef: profile.id,
					estimatedDurationSeconds: {
						min: Math.max(1, Math.floor(profile.defaultTimeoutSec / 6)),
						max: profile.defaultTimeoutSec,
					},
					toolCategories: profileCategories(profile),
					warnings: [
						...(definition.warnings ?? []),
						...profileWarnings(profile),
					],
				},
			];
		}),
	}));
}

export function listNightworkersSelectableProfiles(
	allowedProfileRefs: readonly string[],
): IntegrationCapabilities["selectableProfiles"] {
	const allowed = new Set(allowedProfileRefs);
	return SCAN_PROFILES.filter(
		(profile) =>
			profile.enabled &&
			allowed.has(profile.id) &&
			supportedIntegrationTargets(profile).length > 0,
	).map((profile) => ({
		ref: profile.id,
		name: profile.name,
		description: profile.description,
		supportedTargets: supportedIntegrationTargets(profile),
		requirements: profileRequirements(profile),
		warnings: profileWarnings(profile),
	}));
}

export function resolveNightworkersProfile(params: {
	selection: IntegrationScanSelection;
	targetKind: IntegrationTargetKind;
	allowedProfileRefs: readonly string[];
}): ScanProfile {
	const allowed = new Set(params.allowedProfileRefs);
	let profileRef: string;
	if (params.selection.mode === "preset") {
		const presetId = params.selection.presetId;
		const preset = PRESET_DEFINITIONS.find(
			(candidate) => candidate.id === presetId,
		);
		if (!preset) {
			throw new NightworkersIntegrationError(
				"preset_not_found",
				"The requested scan preset is not available.",
			);
		}
		const target = preset.targets[params.targetKind];
		if (!target) {
			throw new NightworkersIntegrationError(
				"target_not_supported",
				"The selected preset does not support this target.",
			);
		}
		profileRef = target.profileRef;
	} else {
		profileRef = params.selection.profileRef;
	}
	if (!allowed.has(profileRef)) {
		throw new NightworkersIntegrationError(
			"profile_not_allowed",
			"The requested scan profile is not allowed for this integration.",
		);
	}
	const profile = resolveProfile(profileRef);
	if (!supportedIntegrationTargets(profile).includes(params.targetKind)) {
		throw new NightworkersIntegrationError(
			"target_not_supported",
			"The selected profile does not support this target.",
		);
	}
	return profile;
}

export function profileToolSteps(profile: ScanProfile) {
	const steps = profile.steps?.length
		? profile.steps
		: profile.tools.map(
				(tool): ScanProfileStep => ({ kind: "static_tool", ...tool }),
			);
	return steps.map((step) => ({
		id: stepId(step),
		name: step.displayName,
		category:
			step.kind === "static_tool"
				? toolCategory(step.toolId)
				: step.kind === "dast" || step.kind === "runtime_scanner"
					? "runtime"
					: step.kind,
		required: step.required,
		availability:
			step.kind === "static_tool"
				? ("available" as const)
				: ("conditional" as const),
		...(step.kind === "static_tool"
			? {}
			: { reason: "実行時の環境要件を確認します。" }),
	}));
}
