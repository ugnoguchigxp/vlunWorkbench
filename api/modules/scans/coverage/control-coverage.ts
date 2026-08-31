import crypto from "node:crypto";
import type { ScanCoverageResult } from "../../../../shared/schemas/assessment.schema";
import type { AppDatabase } from "../../../db";
import { AssessmentRepository } from "../../assessments/assessment-repository";
import { COVERAGE_CATALOG } from "../../assessments/coverage-catalog";
import { canonicalJson } from "../execution/diff/diff-scan-plan";
import {
	buildScanRunSummary,
	type StepSummary,
	type ToolSummary,
} from "../summary-builder";

type CoverageSource = ToolSummary | StepSummary;
export type AdditionalCoverageSource = {
	key: string;
	status: string;
	findingCount: number;
	reasonCode?: string | null;
	evidenceRefs: ScanCoverageResult["evidenceRefs"];
};

export async function ensureScanCoverageResults(
	db: AppDatabase,
	scanRunId: string,
) {
	const summary = await buildScanRunSummary(db, scanRunId);
	const activeRuns = await db.query.activeAssessmentRuns.findMany({
		where: (fields, { eq }) => eq(fields.scanRunId, scanRunId),
	});
	const additionalSources: AdditionalCoverageSource[] = activeRuns.map(
		(run) => ({
			key:
				run.kind === "authorization_matrix"
					? "api-authorization-matrix"
					: "active-transaction",
			status: run.status,
			findingCount: run.findingCount,
			reasonCode:
				run.status === "completed"
					? null
					: run.status === "failed_cleanup"
						? "cleanup_failed"
						: "active_assessment_inconclusive",
			evidenceRefs: [{ kind: "active_assessment", id: run.id }],
		}),
	);
	const results = buildCoverageResults(summary, additionalSources);
	const snapshotHash = crypto
		.createHash("sha256")
		.update(canonicalJson({ summary, activeRuns, results }))
		.digest("hex");
	return await new AssessmentRepository(db).upsertCoverageResults({
		scanRunId,
		snapshotHash,
		results,
	});
}

export function buildCoverageResults(
	summary: {
		tools: ToolSummary[];
		steps?: StepSummary[];
	},
	additionalSources: AdditionalCoverageSource[] = [],
): ScanCoverageResult[] {
	const sources: Array<{
		key: string;
		value: CoverageSource | AdditionalCoverageSource;
	}> = [
		...summary.tools.map((tool) => ({ key: tool.toolId, value: tool })),
		...(summary.steps ?? []).map((step) => ({
			key:
				step.kind === "dast"
					? step.id
					: step.kind === "api_schema_scan"
						? "api:schema-readonly"
						: step.id,
			value: step,
		})),
		...additionalSources.map((source) => ({
			key: source.key,
			value: source,
		})),
	];
	return COVERAGE_CATALOG.map((control) => {
		const matched = sources.filter((source) =>
			control.automationSources.includes(source.key),
		);
		if (matched.length === 0) {
			return {
				controlId: control.id,
				status: "not_tested",
				method: "automated",
				reasonCode: "profile_did_not_cover_control",
				evidenceRefs: [],
			};
		}
		return combineSourceCoverage(
			control.id,
			matched.map((item) => item.value),
			control.automationLevel,
		);
	});
}

function combineSourceCoverage(
	controlId: string,
	sources: Array<CoverageSource | AdditionalCoverageSource>,
	automationLevel: "full" | "partial",
): ScanCoverageResult {
	const evidenceRefs = sources.flatMap(sourceEvidenceRefs);
	const incompleteActive = sources.find((source) =>
		["inconclusive", "failed_cleanup"].includes(source.status),
	);
	if (incompleteActive) {
		return {
			controlId,
			status: "inconclusive",
			method: "automated",
			reasonCode:
				"reasonCode" in incompleteActive && incompleteActive.reasonCode
					? incompleteActive.reasonCode
					: incompleteActive.status === "failed_cleanup"
						? "cleanup_failed"
						: "active_assessment_inconclusive",
			evidenceRefs,
		};
	}
	if (sources.some((source) => source.status === "failed")) {
		return {
			controlId,
			status: "inconclusive",
			method: "automated",
			reasonCode: "scanner_failed",
			evidenceRefs,
		};
	}
	const completed = sources.filter((source) => source.status === "completed");
	if (completed.length > 0 && evidenceRefs.length > 0) {
		const hasFinding = completed.some((source) => source.findingCount > 0);
		return {
			controlId,
			status: hasFinding
				? "tested_failed"
				: automationLevel === "full"
					? "tested_passed"
					: "inconclusive",
			method: "automated",
			reasonCode: hasFinding
				? "finding_detected"
				: automationLevel === "full"
					? "completed_without_finding"
					: "partial_automation_without_finding",
			evidenceRefs,
		};
	}
	const reasonCodes = sources
		.map((source) => ("reasonCode" in source ? source.reasonCode : null))
		.filter((value): value is string => Boolean(value));
	if (
		reasonCodes.some((reason) =>
			[
				"authentication_required",
				"schema_not_found",
				"tool_unavailable",
				"policy_rejected",
			].includes(reason),
		)
	) {
		return {
			controlId,
			status: "blocked",
			method: "automated",
			reasonCode: reasonCodes[0] ?? "blocked",
			evidenceRefs,
		};
	}
	return {
		controlId,
		status: "not_tested",
		method: "automated",
		reasonCode:
			completed.length > 0 ? "completed_without_evidence" : "scanner_not_run",
		evidenceRefs,
	};
}

function sourceEvidenceRefs(
	source: CoverageSource | AdditionalCoverageSource,
): ScanCoverageResult["evidenceRefs"] {
	if ("evidenceRefs" in source) {
		return source.evidenceRefs;
	}
	if ("toolRunId" in source && source.toolRunId) {
		return [{ kind: "tool_run", id: source.toolRunId }];
	}
	const metadata = source.metadata ?? {};
	const artifactIds = Array.isArray(metadata.artifactIds)
		? metadata.artifactIds.filter((id): id is string => typeof id === "string")
		: [];
	return artifactIds.map((id) => ({ kind: "scan_artifact" as const, id }));
}
