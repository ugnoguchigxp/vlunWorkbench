import {
	pluginExecutionSummaryV1Schema,
	type PluginExecutionSummaryV1,
} from "../../../shared/schemas/project-capability-plan.schema";
import { builtInTechnologyPluginRegistry } from "../../plugins/builtin";
import { escapeTableCell } from "./report-builder-helpers";

export function readPluginExecutionSummary(
	metadata: Record<string, unknown> | null | undefined,
): PluginExecutionSummaryV1 | null {
	const parsed = pluginExecutionSummaryV1Schema.safeParse(
		metadata?.technologyPlugins,
	);
	return parsed.success ? parsed.data : null;
}

export function renderTechnologyCoverage(
	lines: string[],
	metadata: Record<string, unknown> | null | undefined,
): void {
	lines.push("## Technology Coverage");
	const summary = readPluginExecutionSummary(metadata);
	if (!summary) {
		lines.push(
			"No versioned technology capability plan was persisted for this scan. Registered scanner data must not be interpreted as measured project coverage.",
		);
		lines.push("");
		return;
	}
	lines.push(`- **Registry digest:** ${summary.registryDigest}`);
	lines.push(
		"| Plugin | Detected | Executed | Support | Coverage | Limitation |",
	);
	lines.push("| --- | --- | --- | --- | --- | --- |");
	const activeIds = new Set(summary.capabilityPlan.activePluginIds);
	for (const detection of summary.detections.filter(
		(item) => item.detected || activeIds.has(item.pluginId),
	)) {
		const plugin = builtInTechnologyPluginRegistry.get(detection.pluginId);
		const results = summary.pluginResults.filter(
			(result) => result.pluginId === detection.pluginId,
		);
		const executed = results.some((result) => result.status === "completed");
		const coverage = worstCoverage(
			results.map((result) => result.coverageEffect),
		);
		const limitations = [
			...detection.limitations,
			...results.flatMap((result) => result.limitationCodes),
			...(activeIds.has(detection.pluginId)
				? ["release_evidence_not_attached_to_scan"]
				: ["plugin_requirements_not_satisfied"]),
		];
		lines.push(
			`| ${escapeTableCell(plugin?.manifest.displayName ?? detection.pluginId)} | ${detection.detected ? "yes" : "no"} | ${executed ? "yes" : "no"} | ${activeIds.has(detection.pluginId) ? "partial" : "unverified"} | ${coverage} | ${escapeTableCell([...new Set(limitations)].join(", ") || "-")} |`,
		);
	}
	lines.push("");
	lines.push(
		"`finding 0`は、上表でgapまたはpartialとなった言語・依存関係・runtime surfaceの安全性を証明しません。",
	);
	lines.push("");
}

function worstCoverage(
	values: Array<"covered" | "partial" | "gap">,
): "covered" | "partial" | "gap" | "not_executed" {
	if (values.includes("gap")) return "gap";
	if (values.includes("partial")) return "partial";
	if (values.includes("covered")) return "covered";
	return "not_executed";
}
