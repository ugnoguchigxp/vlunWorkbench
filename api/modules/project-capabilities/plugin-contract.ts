import type {
	ProjectPluginDetection,
	TechnologyPluginManifestV1,
} from "../../../shared/schemas/technology-plugin.schema";
import type {
	ExtractedEndpoint,
	SourceInput,
} from "../threat-models/endpoint-extractors/types";
import type { ProjectInventoryEntry } from "../static-intelligence/project-structure/inventory";
import type { AnalyzerOutput } from "../static-intelligence/project-structure/analyzers/types";

export type PluginInventoryEntry = {
	path: string;
	sizeBytes: number;
};

export type BoundedTextResult =
	| { ok: true; text: string; sizeBytes: number }
	| {
			ok: false;
			reason: "not_found" | "not_text" | "file_too_large" | "budget_exhausted";
	  };

export type PluginContext = {
	inventory: readonly PluginInventoryEntry[];
	readText: (relativePath: string) => Promise<BoundedTextResult>;
	limits: {
		maxFiles: number;
		maxFileBytes: number;
		maxTotalBytes: number;
	};
};

export type DetectorResult = Omit<ProjectPluginDetection, "pluginId">;

export type ProjectDetector = {
	id: string;
	pluginId: string;
	fileGlobs: readonly string[];
	exclusiveGroup?: string;
	priority?: number;
	detect(context: PluginContext): Promise<DetectorResult> | DetectorResult;
};

export type DependencyCoverage = {
	coverageEffect: "covered" | "partial" | "gap";
	reasonCode: string | null;
	limitationCodes: string[];
};

export type DependencyProvider = {
	id: string;
	pluginId: string;
	ecosystem: "npm" | "Maven" | "PyPI" | "Go";
	primaryGlobs: readonly string[];
	lockGlobs: readonly string[];
	companionGlobs: readonly string[];
	excludeGlobs: readonly string[];
	coverage(paths: readonly string[]): DependencyCoverage;
};

export type SourceAnalyzerContribution = {
	id: string;
	pluginId: string;
	version: string;
	extensions: readonly string[];
	coverageEffect?: "covered" | "partial" | "gap";
	limitationCodes?: readonly string[];
	analyze(entry: ProjectInventoryEntry, bytes: Uint8Array): AnalyzerOutput;
};

export type EndpointExtractorContribution = {
	id: string;
	pluginId: string;
	extensions: readonly string[];
	frameworks: readonly string[];
	coverageEffect?: "covered" | "partial" | "gap";
	limitationCodes?: readonly string[];
	extract(source: SourceInput): ExtractedEndpoint[];
};

export type SemgrepRuleContribution = {
	pluginId: string;
	rulesetId: string;
	path: string;
	digest: `sha256:${string}`;
	language: string;
};

export type DastStartPlanV1 = {
	schemaVersion: 1;
	pluginId: string;
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	readinessPaths: string[];
	requiresProjectCodeConsent: boolean;
	requestedNetwork: "none";
};

export type StartPlannerContext = PluginContext & {
	port: number;
	requestedPortExplicit: boolean;
	activePluginIds: readonly string[];
};

export type StartPlanner = {
	id: string;
	pluginId: string;
	plan(
		context: StartPlannerContext,
	): Promise<DastStartPlanV1 | null> | DastStartPlanV1 | null;
};

export type TechnologyPluginV1 = {
	manifest: TechnologyPluginManifestV1;
	detectors: readonly ProjectDetector[];
	dependencyProviders: readonly DependencyProvider[];
	sourceAnalyzers: readonly SourceAnalyzerContribution[];
	endpointExtractors: readonly EndpointExtractorContribution[];
	semgrepRules: readonly SemgrepRuleContribution[];
	startPlanners: readonly StartPlanner[];
};
