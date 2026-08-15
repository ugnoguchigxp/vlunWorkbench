import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import {
	pluginExecutionSummaryV1Schema,
	type PluginExecutionSummaryV1,
	type ProjectCapabilityPlanV1,
	type ProjectCapabilityStepV1,
} from "../../../shared/schemas/project-capability-plan.schema";
import {
	projectPluginDetectionSchema,
	type ProjectPluginDetection,
} from "../../../shared/schemas/technology-plugin.schema";
import { builtInTechnologyPluginRegistry } from "../../plugins/builtin";
import { buildProjectInventory } from "../static-intelligence/project-structure/inventory";
import type {
	PluginContext,
	PluginInventoryEntry,
	TechnologyPluginV1,
} from "./plugin-contract";
import { matchesAnyPluginGlob, normalizePluginPath } from "./path-patterns";
import type { TechnologyPluginRegistry } from "./plugin-registry";
import {
	buildProjectCapabilityPlan,
	worstCapabilityCoverage,
} from "./capability-plan-builder";

export const DEFAULT_PLUGIN_LIMITS = {
	maxFiles: 20_000,
	maxFileBytes: 2 * 1024 * 1024,
	maxTotalBytes: 32 * 1024 * 1024,
} as const;

export type ProjectCapabilityAnalysis = {
	detections: ProjectPluginDetection[];
	capabilityPlan: ProjectCapabilityPlanV1;
	context: PluginContext;
};

export async function analyzeProjectCapabilities(
	repoPath: string,
	registry: TechnologyPluginRegistry = builtInTechnologyPluginRegistry,
): Promise<ProjectCapabilityAnalysis> {
	const context = await createPluginContext(repoPath);
	const detections = await detectProjectPlugins(context, registry);
	const activePlugins = activePluginsForDetections(detections, registry);
	const capabilityPlan = await buildProjectCapabilityPlan({
		context,
		detections,
		activePlugins,
		registry,
	});
	return { detections, capabilityPlan, context };
}

export async function detectProjectPlugins(
	context: PluginContext,
	registry: TechnologyPluginRegistry = builtInTechnologyPluginRegistry,
): Promise<ProjectPluginDetection[]> {
	const output: ProjectPluginDetection[] = [];
	for (const plugin of registry.plugins()) {
		const results = [];
		for (const detector of plugin.detectors) {
			results.push(await detector.detect(context));
		}
		const evidence = uniqueEvidence(
			results.flatMap((result) => result.evidence),
		);
		const detected = results.some((result) => result.detected);
		const detection = {
			pluginId: plugin.manifest.id,
			detected,
			confidence: detected
				? highestConfidence(
						results
							.filter((result) => result.detected)
							.map((result) => result.confidence),
					)
				: "low",
			evidence,
			limitations: [
				...new Set(results.flatMap((result) => result.limitations)),
			].sort((left, right) => left.localeCompare(right)),
		} satisfies ProjectPluginDetection;
		output.push(projectPluginDetectionSchema.parse(detection));
	}
	return output;
}

export function activePluginsForDetections(
	detections: readonly ProjectPluginDetection[],
	registry: TechnologyPluginRegistry = builtInTechnologyPluginRegistry,
): TechnologyPluginV1[] {
	const detectedIds = new Set(
		detections
			.filter((detection) => detection.detected)
			.map((detection) => detection.pluginId),
	);
	const activeIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const plugin of registry.plugins()) {
			if (
				activeIds.has(plugin.manifest.id) ||
				!detectedIds.has(plugin.manifest.id)
			) {
				continue;
			}
			const allSatisfied = plugin.manifest.requires.allOf.every((dependency) =>
				activeIds.has(dependency),
			);
			const oneSatisfied =
				plugin.manifest.requires.oneOf.length === 0 ||
				plugin.manifest.requires.oneOf.some((dependency) =>
					activeIds.has(dependency),
				);
			if (allSatisfied && oneSatisfied) {
				activeIds.add(plugin.manifest.id);
				changed = true;
			}
		}
	}
	return registry
		.plugins()
		.filter((plugin) => activeIds.has(plugin.manifest.id));
}

export function detectAffectedPluginsFromPaths(
	paths: readonly string[],
	registry: TechnologyPluginRegistry = builtInTechnologyPluginRegistry,
): string[] {
	const normalized = paths.map(normalizePluginPath);
	return registry
		.plugins()
		.filter((plugin) =>
			plugin.detectors.some((detector) =>
				normalized.some((candidate) =>
					matchesAnyPluginGlob(candidate, detector.fileGlobs),
				),
			),
		)
		.map((plugin) => plugin.manifest.id);
}

export function dependencyProvidersForPaths(
	paths: readonly string[],
	registry: TechnologyPluginRegistry = builtInTechnologyPluginRegistry,
) {
	const normalized = paths.map(normalizePluginPath);
	return registry
		.dependencyProviders()
		.filter((provider) =>
			normalized.some((candidate) =>
				matchesAnyPluginGlob(candidate, [
					...provider.primaryGlobs,
					...provider.companionGlobs,
				]),
			),
		);
}

export function buildPluginExecutionSummary(params: {
	detections: ProjectPluginDetection[];
	capabilityPlan: ProjectCapabilityPlanV1;
	stepResults: Array<{
		kind: string;
		status: string;
		toolId?: string;
		coverageEffect?: string;
		reasonCode?: string | null;
		error?: string | null;
	}>;
}): PluginExecutionSummaryV1 {
	const resultByStep = new Map(
		params.stepResults.map((result) => [
			result.kind === "static_tool" && result.toolId
				? result.toolId
				: result.kind,
			result,
		]),
	);
	const pluginResults = params.capabilityPlan.steps.flatMap((step) =>
		step.pluginIds.map((pluginId) => {
			const scannerStepId = scannerStepForCapabilityStep(step.stepId);
			const execution = resultByStep.get(scannerStepId);
			const scannerExecutionMissing =
				step.applicability === "applicable" &&
				!execution &&
				isExecutionBackedCapabilityStep(step.stepId);
			const status =
				step.applicability === "not_applicable"
					? "skipped"
					: executionStatus(execution?.status);
			const executionCoverage:
				| ProjectCapabilityStepV1["coverageEffect"]
				| null =
				execution?.coverageEffect === "gap" ||
				execution?.coverageEffect === "partial" ||
				execution?.coverageEffect === "covered"
					? execution.coverageEffect
					: null;
			const coverageEffect =
				status === "failed" || scannerExecutionMissing
					? "gap"
					: worstCapabilityCoverage([
							step.coverageEffect,
							...(executionCoverage ? [executionCoverage] : []),
						]);
			const limitationCodes = [
				...new Set([
					...step.limitationCodes,
					...(scannerExecutionMissing ? ["capability_step_not_executed"] : []),
					...(execution?.reasonCode ? [execution.reasonCode] : []),
					...knownExecutionLimitations(execution?.error),
				]),
			].sort();
			return {
				pluginId,
				capability: step.stepId,
				status,
				coverageEffect,
				limitationCodes,
			};
		}),
	);
	return pluginExecutionSummaryV1Schema.parse({
		schemaVersion: 1,
		registryDigest: params.capabilityPlan.registryDigest,
		detections: params.detections,
		capabilityPlan: params.capabilityPlan,
		pluginResults,
	});
}

async function createPluginContext(repoPath: string): Promise<PluginContext> {
	const inventory = await buildProjectInventory({
		projectPath: repoPath,
		maxFiles: DEFAULT_PLUGIN_LIMITS.maxFiles,
		maxHashBytes: DEFAULT_PLUGIN_LIMITS.maxFileBytes,
	});
	const entriesByPath = new Map(
		inventory.entries.map((entry) => [entry.path, entry]),
	);
	const readCache = new Map<
		string,
		Promise<Awaited<ReturnType<PluginContext["readText"]>>>
	>();
	let consumedBytes = 0;
	let readSequence = Promise.resolve();
	return {
		inventory: inventory.entries.map(
			(entry): PluginInventoryEntry => ({
				path: entry.path,
				sizeBytes: entry.sizeBytes,
			}),
		),
		limits: { ...DEFAULT_PLUGIN_LIMITS },
		async readText(relativePath) {
			const normalized = normalizePluginPath(relativePath);
			const cached = readCache.get(normalized);
			if (cached) return cached;
			const entry = entriesByPath.get(normalized);
			if (!entry) return { ok: false, reason: "not_found" };
			const pending = readSequence.then(() =>
				readBoundedInventoryText({
					absolutePath: entry.absolutePath,
					remainingBytes: DEFAULT_PLUGIN_LIMITS.maxTotalBytes - consumedBytes,
					onBytesRead(bytesRead) {
						consumedBytes += bytesRead;
					},
				}),
			);
			readSequence = pending.then(
				() => undefined,
				() => undefined,
			);
			readCache.set(normalized, pending);
			return pending;
		},
	};
}

async function readBoundedInventoryText(params: {
	absolutePath: string;
	remainingBytes: number;
	onBytesRead(bytesRead: number): void;
}): ReturnType<PluginContext["readText"]> {
	const handle = await fs
		.open(
			params.absolutePath,
			fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
		)
		.catch(() => null);
	if (!handle) return { ok: false, reason: "not_found" };
	try {
		const initialStat = await handle.stat().catch(() => null);
		if (!initialStat?.isFile()) return { ok: false, reason: "not_found" };
		if (initialStat.size > DEFAULT_PLUGIN_LIMITS.maxFileBytes) {
			return { ok: false, reason: "file_too_large" };
		}
		if (initialStat.size > params.remainingBytes) {
			return { ok: false, reason: "budget_exhausted" };
		}

		const bytes = Buffer.alloc(initialStat.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const result = await handle.read(
				bytes,
				offset,
				bytes.byteLength - offset,
				offset,
			);
			if (result.bytesRead === 0) break;
			offset += result.bytesRead;
		}
		params.onBytesRead(offset);
		const finalStat = await handle.stat().catch(() => null);
		if (!finalStat) return { ok: false, reason: "not_found" };
		if (finalStat.size > DEFAULT_PLUGIN_LIMITS.maxFileBytes) {
			return { ok: false, reason: "file_too_large" };
		}
		if (finalStat.size > params.remainingBytes) {
			return { ok: false, reason: "budget_exhausted" };
		}
		if (finalStat.size !== initialStat.size || offset !== initialStat.size) {
			return { ok: false, reason: "not_found" };
		}
		if (bytes.includes(0)) return { ok: false, reason: "not_text" };
		return {
			ok: true,
			text: bytes.toString("utf8"),
			sizeBytes: bytes.byteLength,
		};
	} finally {
		await handle.close();
	}
}

function highestConfidence(
	values: readonly ProjectPluginDetection["confidence"][],
): ProjectPluginDetection["confidence"] {
	if (values.includes("high")) return "high";
	if (values.includes("medium")) return "medium";
	return "low";
}

function uniqueEvidence(
	values: ProjectPluginDetection["evidence"],
): ProjectPluginDetection["evidence"] {
	const byKey = new Map(
		values.map((value) => [`${value.kind}\0${value.path}`, value]),
	);
	return [...byKey.values()].sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.kind.localeCompare(right.kind),
	);
}

function scannerStepForCapabilityStep(stepId: string): string {
	if (stepId === "semgrep") return "semgrep";
	if (stepId.startsWith("dependency:")) return "osv";
	if (stepId === "dast_start") return "dast";
	return stepId;
}

function isExecutionBackedCapabilityStep(stepId: string): boolean {
	return (
		stepId === "semgrep" ||
		stepId.startsWith("dependency:") ||
		stepId === "dast_start"
	);
}

function executionStatus(
	status: string | undefined,
): "completed" | "failed" | "skipped" {
	if (status === "completed") return "completed";
	if (
		status === undefined ||
		status === "skipped" ||
		status === "not_applicable"
	) {
		return "skipped";
	}
	return "failed";
}

function knownExecutionLimitations(error: string | null | undefined): string[] {
	if (!error) return [];
	return [
		"project_code_execution_consent_required",
		"project_code_execution_sandbox_required",
		"target_start_not_supported",
	].filter((code) => error.includes(code));
}
