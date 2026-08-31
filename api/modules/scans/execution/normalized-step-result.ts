import {
	normalizedProfileStepResultSchema,
	type NormalizedProfileStepResult,
} from "../../../../shared/schemas/scan-profile-step-result.schema";
import { scanReasonCodeSchema } from "../../../../shared/schemas/scan-reason-code.schema";
import type { ScanProfileStepResult } from "./profile-runner";

export function normalizeProfileStepResult(
	result: ScanProfileStepResult,
): NormalizedProfileStepResult {
	const rawReasonCodes =
		result.kind === "dast"
			? (result.limitationCodes ?? [])
			: result.reasonCode
				? [result.reasonCode]
				: [];
	const reasonCodes = rawReasonCodes.filter(
		(code) => scanReasonCodeSchema.safeParse(code).success,
	);
	const failed = result.status === "failed";
	const skipped = result.status === "skipped";
	const blocked = reasonCodes.includes("preflight_failed");
	const artifactIds = "artifactIds" in result ? (result.artifactIds ?? []) : [];
	return normalizedProfileStepResultSchema.parse({
		stepId: stepIdFor(result),
		kind: result.kind,
		adapter: adapterFor(result),
		required: result.required,
		execution: failed
			? "failed"
			: blocked
				? "blocked"
				: skipped
					? "not_executed"
					: "completed",
		applicability:
			"applicability" in result && result.applicability === "not_applicable"
				? "not_applicable"
				: "applicable",
		coverageEffect:
			"coverageEffect" in result
				? (result.coverageEffect ?? (failed || skipped ? "gap" : "covered"))
				: result.kind === "dast"
					? (result.coverageStatus ?? (failed || skipped ? "gap" : "covered"))
					: failed || skipped
						? "gap"
						: "covered",
		reasonCodes:
			reasonCodes.length > 0 ? reasonCodes : failed ? ["execution_failed"] : [],
		findingCount: result.findingCount,
		evidenceRefs: artifactIds.map((id) => `artifact:${id}`),
		artifactIds,
		childRunRefs:
			result.kind === "dast" && result.dastRunId
				? [`dast-run:${result.dastRunId}`]
				: [],
		cleanupState:
			result.kind === "dast" && result.autoTarget
				? "completed"
				: "not_required",
	});
}

function stepIdFor(result: ScanProfileStepResult): string {
	if (result.kind === "static_tool") return result.toolId;
	if (result.kind === "dast") return `dast:${result.profileId}`;
	return result.stepId;
}

function adapterFor(result: ScanProfileStepResult): string {
	if (result.kind === "static_tool") return result.toolId;
	if (result.kind === "dast") return result.profileId;
	return result.adapter;
}
