export type TechnologyCapabilityRow = {
	key: string;
	pluginId: string;
	capability: string;
	detected: boolean;
	confidence: "low" | "medium" | "high";
	executionStatus: "completed" | "failed" | "skipped" | "not_executed";
	support: "partial" | "gap" | "unsupported" | "unverified";
	coverage: "covered" | "partial" | "gap" | "not_executed";
	limitationCodes: string[];
};

export type TechnologyCoverageDisplay = {
	registryDigest: string;
	rows: TechnologyCapabilityRow[];
};

export function readTechnologyCoverageDisplay(
	metadata: Record<string, unknown> | null | undefined,
): TechnologyCoverageDisplay | null {
	const raw = metadata?.technologyPlugins;
	if (!isRecord(raw) || raw.schemaVersion !== 1) return null;
	const registryDigest =
		typeof raw.registryDigest === "string" ? raw.registryDigest : null;
	const plan = isRecord(raw.capabilityPlan) ? raw.capabilityPlan : null;
	if (!registryDigest || !plan || !Array.isArray(plan.activePluginIds))
		return null;
	const activeIds = new Set(
		plan.activePluginIds.filter(
			(value): value is string => typeof value === "string",
		),
	);
	const detections = Array.isArray(raw.detections)
		? raw.detections.filter(isRecord)
		: [];
	const detectionByPlugin = new Map(
		detections
			.filter((item) => typeof item.pluginId === "string")
			.map((item) => [item.pluginId as string, item]),
	);
	const rows: TechnologyCapabilityRow[] = [];
	for (const result of Array.isArray(raw.pluginResults)
		? raw.pluginResults.filter(isRecord)
		: []) {
		if (
			typeof result.pluginId !== "string" ||
			typeof result.capability !== "string"
		)
			continue;
		const detection = detectionByPlugin.get(result.pluginId);
		const coverage = coverageValue(result.coverageEffect);
		const executionStatus = executionValue(result.status);
		rows.push({
			key: `${result.pluginId}:${result.capability}`,
			pluginId: result.pluginId,
			capability: result.capability,
			detected: detection?.detected === true,
			confidence: confidenceValue(detection?.confidence),
			executionStatus,
			support:
				executionStatus === "failed" || coverage === "gap"
					? "gap"
					: activeIds.has(result.pluginId)
						? "partial"
						: "unverified",
			coverage,
			limitationCodes: stringArray(result.limitationCodes),
		});
	}
	const resultKeys = new Set(rows.map((row) => row.key));
	for (const step of Array.isArray(plan.steps) ? plan.steps.filter(isRecord) : []) {
		if (typeof step.stepId !== "string" || !Array.isArray(step.pluginIds)) continue;
		for (const pluginId of step.pluginIds.filter(
			(value): value is string => typeof value === "string",
		)) {
			const key = `${pluginId}:${step.stepId}`;
			if (resultKeys.has(key)) continue;
			const detection = detectionByPlugin.get(pluginId);
			const coverage = coverageValue(step.coverageEffect);
			rows.push({
				key,
				pluginId,
				capability: step.stepId,
				detected: detection?.detected === true,
				confidence: confidenceValue(detection?.confidence),
				executionStatus: "not_executed",
				support:
					coverage === "gap"
						? "gap"
						: coverage === "partial"
							? "partial"
							: "unverified",
				coverage,
				limitationCodes: stringArray(step.limitationCodes),
			});
		}
	}
	const detectedGoFramework = detections.some(
		(item) =>
			typeof item.pluginId === "string" &&
			item.pluginId.startsWith("framework.go.") &&
			item.detected === true &&
			stringArray(item.limitations).includes("go_dast_auto_start_unsupported"),
	);
	if (detectedGoFramework) {
		rows.push({
			key: "language.go:dast_start",
			pluginId: "language.go",
			capability: "dast_start",
			detected: true,
			confidence: confidenceValue(
				detectionByPlugin.get("language.go")?.confidence,
			),
			executionStatus: "not_executed",
			support: "unsupported",
			coverage: "not_executed",
			limitationCodes: ["go_dast_auto_start_unsupported"],
		});
	}
	return {
		registryDigest,
		rows: rows.sort(
			(left, right) =>
				left.pluginId.localeCompare(right.pluginId) ||
				left.capability.localeCompare(right.capability),
		),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function coverageValue(value: unknown): TechnologyCapabilityRow["coverage"] {
	return value === "covered" || value === "partial" || value === "gap"
		? value
		: "not_executed";
}

function executionValue(
	value: unknown,
): TechnologyCapabilityRow["executionStatus"] {
	return value === "completed" || value === "failed" || value === "skipped"
		? value
		: "not_executed";
}

function confidenceValue(
	value: unknown,
): TechnologyCapabilityRow["confidence"] {
	return value === "high" || value === "medium" ? value : "low";
}
