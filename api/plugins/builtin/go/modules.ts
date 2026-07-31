import type {
	DependencyCoverage,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { matchesAnyPluginGlob } from "../../../modules/project-capabilities/path-patterns";
import { inventoryPaths } from "../helpers";

const PLUGIN_ID = "build.go-modules";
const PRIMARY_GLOBS = ["go.mod", "**/go.mod"] as const;
const COMPANION_GLOBS = [
	"go.sum",
	"**/go.sum",
	"go.work",
	"**/go.work",
] as const;
const LIMITATIONS = [
	"go_mod_declared_dependencies_only",
	"dependency_resolution_not_performed",
	"transitive_dependency_provenance_unverified",
] as const;

export type GoModuleDirectiveSummary = {
	modulePath: string | null;
	requires: Array<{ module: string; version: string; indirect: boolean }>;
	limitationCodes: string[];
};

export function parseGoModule(content: string): GoModuleDirectiveSummary {
	const modulePath = content.match(/^\s*module\s+([^\s]+)\s*$/m)?.[1] ?? null;
	const requires: Array<{
		module: string;
		version: string;
		indirect: boolean;
	}> = [];
	const limitations = new Set<string>();
	const addRequire = (line: string) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//")) return;
		const match = trimmed.match(/^([^\s]+)\s+(v[^\s]+)(\s+\/\/\s*indirect)?$/);
		if (match?.[1] && match[2]) {
			requires.push({
				module: match[1],
				version: match[2],
				indirect: Boolean(match[3]),
			});
			return;
		}
		limitations.add("go_mod_require_unparsed");
	};
	for (const match of content.matchAll(/^\s*require\s+([^\s(][^\n]*)$/gm))
		addRequire(match[1] ?? "");
	for (const block of content.matchAll(/^\s*require\s*\(([\s\S]*?)^\s*\)/gm)) {
		for (const line of (block[1] ?? "").split(/\r?\n/)) addRequire(line);
	}
	if (/^\s*replace\s+/m.test(content))
		limitations.add("go_mod_replace_resolution_not_performed");
	if (/^\s*exclude\s+/m.test(content))
		limitations.add("go_mod_exclude_partial");
	if (/^\s*toolchain\s+/m.test(content))
		limitations.add("go_toolchain_download_forbidden");
	if (/^\s*use\s+/m.test(content))
		limitations.add("go_workspace_resolution_partial");
	return {
		modulePath,
		requires: requires.sort((left, right) =>
			left.module.localeCompare(right.module),
		),
		limitationCodes: [...limitations].sort(),
	};
}

export const goModulesPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "build_system",
		displayName: "Go Modules",
		requires: { allOf: ["language.go"], oneOf: [] },
		declaredCapabilities: ["dependency_detection", "dependency_scan"],
	},
	detectors: [
		{
			id: "detect.build.go-modules",
			pluginId: PLUGIN_ID,
			fileGlobs: [...PRIMARY_GLOBS, ...COMPANION_GLOBS],
			async detect(context) {
				const primaryPaths = inventoryPaths(context, PRIMARY_GLOBS);
				const limitations = new Set<string>(LIMITATIONS);
				for (const filePath of primaryPaths.slice(0, 50)) {
					const read = await context.readText(filePath);
					if (!read.ok) {
						limitations.add(`go_mod_${read.reason}`);
						continue;
					}
					for (const code of parseGoModule(read.text).limitationCodes) {
						limitations.add(code);
					}
				}
				if (inventoryPaths(context, ["go.work", "**/go.work"]).length > 0) {
					limitations.add("go_workspace_resolution_partial");
				}
				return {
					detected: primaryPaths.length > 0,
					confidence:
						primaryPaths.length > 0 ? ("high" as const) : ("low" as const),
					evidence: primaryPaths.map((filePath) => ({
						path: filePath,
						kind: "manifest" as const,
					})),
					limitations: [...limitations].sort(),
				};
			},
		},
	],
	dependencyProviders: [
		{
			id: "dependency.go-modules",
			pluginId: PLUGIN_ID,
			ecosystem: "Go",
			primaryGlobs: PRIMARY_GLOBS,
			lockGlobs: [],
			companionGlobs: COMPANION_GLOBS,
			excludeGlobs: [
				"vendor/**",
				"**/vendor/**",
				".cache/go-build/**",
				"**/.cache/go-build/**",
				"pkg/mod/**",
				"**/pkg/mod/**",
			],
			coverage(paths): DependencyCoverage {
				if (
					!paths.some((value) => matchesAnyPluginGlob(value, PRIMARY_GLOBS))
				) {
					return {
						coverageEffect: "gap",
						reasonCode: "go_mod_input_missing",
						limitationCodes: ["go_mod_input_missing"],
					};
				}
				const limitationCodes: string[] = [...LIMITATIONS];
				if (
					paths.some((value) =>
						matchesAnyPluginGlob(value, ["go.work", "**/go.work"]),
					)
				) {
					limitationCodes.push("go_workspace_resolution_partial");
				}
				return {
					coverageEffect: "partial",
					reasonCode: "go_mod_declared_dependencies_only",
					limitationCodes,
				};
			},
		},
	],
	sourceAnalyzers: [],
	endpointExtractors: [],
	semgrepRules: [],
	startPlanners: [],
};
