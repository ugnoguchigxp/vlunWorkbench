import type {
	DependencyCoverage,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { matchesAnyPluginGlob } from "../../../modules/project-capabilities/path-patterns";
import { inventoryPaths } from "../helpers";

const PLUGIN_ID = "build.python-requirements";
const PRIMARY_GLOBS = [
	"requirements.txt",
	"requirements-*.txt",
	"requirements/*.txt",
	"**/requirements.txt",
	"**/requirements-*.txt",
	"**/requirements/*.txt",
] as const;
const COMPANION_GLOBS = [
	"pyproject.toml",
	"setup.cfg",
	"setup.py",
	"Pipfile",
	"poetry.lock",
	"uv.lock",
	"pdm.lock",
	"**/pyproject.toml",
	"**/setup.cfg",
	"**/setup.py",
] as const;
const LIMITATIONS = [
	"python_requirements_pinned_entries_only",
	"dependency_resolution_not_performed",
	"transitive_dependency_provenance_unverified",
] as const;

export type PythonRequirementEntry = {
	line: number;
	name: string | null;
	version: string | null;
	status: "pinned" | "unsupported";
	limitationCode: string | null;
};

export function parsePythonRequirements(
	content: string,
): PythonRequirementEntry[] {
	const output: PythonRequirementEntry[] = [];
	for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const unsupported = unsupportedRequirement(line);
		if (unsupported) {
			output.push({
				line: index + 1,
				name: null,
				version: null,
				status: "unsupported",
				limitationCode: unsupported,
			});
			continue;
		}
		const match = line.match(
			/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]+\])?==([^\s;#]+)(?:\s+#.*)?$/,
		);
		if (match?.[1] && match[2] && isConcretePythonVersion(match[2])) {
			output.push({
				line: index + 1,
				name: match[1],
				version: match[2],
				status: "pinned",
				limitationCode: null,
			});
		} else {
			const name =
				match?.[1] ?? line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1] ?? null;
			output.push({
				line: index + 1,
				name,
				version: null,
				status: "unsupported",
				limitationCode: match
					? "python_requirement_version_not_concrete"
					: "python_requirement_not_exactly_pinned",
			});
		}
	}
	return output;
}

function isConcretePythonVersion(value: string): boolean {
	return /^(?:\d+!)?\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?(?:\+[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/i.test(
		value,
	);
}

export const pythonRequirementsPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "build_system",
		displayName: "Python requirements",
		requires: { allOf: ["language.python"], oneOf: [] },
		declaredCapabilities: ["dependency_detection", "dependency_scan"],
	},
	detectors: [
		{
			id: "detect.build.python-requirements",
			pluginId: PLUGIN_ID,
			fileGlobs: [...PRIMARY_GLOBS, ...COMPANION_GLOBS],
			async detect(context) {
				const primaryPaths = inventoryPaths(context, PRIMARY_GLOBS);
				const evidence = primaryPaths.map((filePath) => ({
					path: filePath,
					kind: "manifest" as const,
				}));
				const limitations = new Set<string>(LIMITATIONS);
				for (const filePath of primaryPaths.slice(0, 50)) {
					const read = await context.readText(filePath);
					if (!read.ok) {
						limitations.add(`python_requirements_${read.reason}`);
						continue;
					}
					for (const entry of parsePythonRequirements(read.text)) {
						if (entry.limitationCode) limitations.add(entry.limitationCode);
					}
				}
				return {
					detected: primaryPaths.length > 0,
					confidence: primaryPaths.length > 0 ? "high" : "low",
					evidence,
					limitations: [...limitations].sort(),
				};
			},
		},
	],
	dependencyProviders: [
		{
			id: "dependency.python-requirements",
			pluginId: PLUGIN_ID,
			ecosystem: "PyPI",
			primaryGlobs: PRIMARY_GLOBS,
			lockGlobs: PRIMARY_GLOBS,
			companionGlobs: COMPANION_GLOBS,
			excludeGlobs: [
				".venv/**",
				"**/.venv/**",
				"venv/**",
				"**/venv/**",
				"**/site-packages/**",
				"build/**",
				"dist/**",
			],
			coverage(paths): DependencyCoverage {
				if (
					!paths.some((value) => matchesAnyPluginGlob(value, PRIMARY_GLOBS))
				) {
					return {
						coverageEffect: "gap",
						reasonCode: "python_requirements_input_missing",
						limitationCodes: ["python_requirements_input_missing"],
					};
				}
				return {
					coverageEffect: "partial",
					reasonCode: "python_requirements_pinned_entries_only",
					limitationCodes: [...LIMITATIONS],
				};
			},
		},
	],
	sourceAnalyzers: [],
	endpointExtractors: [],
	semgrepRules: [],
	startPlanners: [],
};

function unsupportedRequirement(line: string): string | null {
	if (/^(?:-r|--requirement)\b/.test(line))
		return "python_requirement_include_unsupported";
	if (/^(?:-c|--constraint)\b/.test(line))
		return "python_requirement_constraint_unsupported";
	if (/^(?:-e|--editable)\b/.test(line))
		return "python_requirement_editable_unsupported";
	if (/^(?:--index-url|--extra-index-url|--trusted-host)\b/.test(line))
		return "python_private_index_resolution_not_performed";
	if (line.includes(";"))
		return "python_requirement_environment_marker_unsupported";
	if (/\b(?:https?|git\+|file):|^\.?\.?\//i.test(line))
		return "python_requirement_url_or_path_unsupported";
	return null;
}
