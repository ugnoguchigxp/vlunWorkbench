import {
	type LlmWarningGroupImprovementRequest,
	llmWarningGroupImprovementRequestSchema,
	type ScanImprovementRequest,
	scanImprovementRequestSchema,
} from "../../../../shared/schemas/scan.schema";
import { assertJapaneseTextFields } from "../../llm-language";
import { StructuredImprovementRequestError } from "./scan-improvement-request-builder";
import type { ImprovementRequestIssueBundle } from "./scan-improvement-issue-bundle";

/**
 * Validates the compact warning-group response, then restores saved issue and
 * finding membership. The model cannot select either audit identifier directly.
 */
export function parseWarningGroupChunkImprovementRequest(
	content: string,
	bundle: ImprovementRequestIssueBundle,
): ScanImprovementRequest {
	let request: LlmWarningGroupImprovementRequest;
	try {
		request = llmWarningGroupImprovementRequestSchema.parse(
			JSON.parse(extractJsonObject(content)),
		);
	} catch (error) {
		if (error instanceof StructuredImprovementRequestError) throw error;
		throw new StructuredImprovementRequestError(
			error instanceof Error ? error.message : String(error),
		);
	}
	assertJapaneseRequest(request);
	assertWarningGroupReferences(request, bundle);
	assertWarningGroupTaskCoverage(request, bundle);
	assertPrioritySemantics(request, bundle);
	assertEvidenceReferences(request, bundle);
	return expandWarningGroupRequest(request, bundle);
}

function extractJsonObject(content: string): string {
	const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? content;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end < start) {
		throw new StructuredImprovementRequestError(
			"LLM response did not contain a valid JSON object.",
		);
	}
	return candidate.slice(start, end + 1);
}

function assertJapaneseRequest(
	request: LlmWarningGroupImprovementRequest,
): void {
	assertJapaneseTextFields(request as unknown as Record<string, unknown>, [
		"title",
		"objective",
		"scope",
		"acceptanceCriteria",
		"constraints",
		"nonGoals",
		"handoffPrompt",
	]);
	for (const item of request.priorityPlan) {
		assertJapaneseTextFields(item as unknown as Record<string, unknown>, [
			"rationale",
		]);
	}
	for (const item of request.implementationTasks) {
		assertJapaneseTextFields(item as unknown as Record<string, unknown>, [
			"title",
			"body",
		]);
	}
}

function assertWarningGroupReferences(
	request: LlmWarningGroupImprovementRequest,
	bundle: ImprovementRequestIssueBundle,
): void {
	const allowed = new Set(
		bundle.warningGroupManifest.map((item) => item.warningGroupId),
	);
	const referenced = [
		...request.priorityPlan.flatMap((item) => item.warningGroupIds),
		...request.implementationTasks.flatMap((item) => item.warningGroupIds),
	];
	const invalid = [...new Set(referenced.filter((id) => !allowed.has(id)))];
	if (invalid.length > 0) {
		throw new StructuredImprovementRequestError(
			`improvement request referenced warning group IDs outside the saved bundle: ${invalid.join(", ")}`,
		);
	}
}

function assertWarningGroupTaskCoverage(
	request: LlmWarningGroupImprovementRequest,
	bundle: ImprovementRequestIssueBundle,
): void {
	const counts = new Map<string, number>();
	for (const id of request.implementationTasks.flatMap(
		(task) => task.warningGroupIds,
	)) {
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	const expected = bundle.warningGroupManifest.map(
		(item) => item.warningGroupId,
	);
	const missing = expected.filter((id) => !counts.has(id));
	const duplicated = expected.filter((id) => (counts.get(id) ?? 0) > 1);
	if (missing.length > 0 || duplicated.length > 0) {
		throw new StructuredImprovementRequestError(
			[
				"improvement request must cover every warning group exactly once",
				missing.length > 0 ? `missing=${missing.join(",")}` : "",
				duplicated.length > 0 ? `duplicated=${duplicated.join(",")}` : "",
			]
				.filter(Boolean)
				.join(" "),
		);
	}
}

function assertEvidenceReferences(
	request: LlmWarningGroupImprovementRequest,
	bundle: ImprovementRequestIssueBundle,
): void {
	const artifactIds = bundle.artifacts.map((artifact) => artifact.id);
	const groupById = new Map(
		bundle.warningGroups.map((group) => [group.warningGroupId, group]),
	);
	const invalid = request.implementationTasks.flatMap((task) => {
		const groups = task.warningGroupIds.flatMap((id) => {
			const group = groupById.get(id);
			return group ? [group] : [];
		});
		const allowedEvidenceIds = new Set([
			...artifactIds,
			...groups.flatMap((group) =>
				group.representativeEvidence.flatMap((evidence) =>
					[evidence.id, evidence.artifactId].filter(
						(value): value is string => typeof value === "string",
					),
				),
			),
		]);
		const allowedLocationRefs = new Set(
			groups.flatMap((group) =>
				group.locations.map((location) => location.ref),
			),
		);
		return task.evidenceRefs
			.map((reference) => reference.trim())
			.filter(
				(reference) =>
					!allowedEvidenceIds.has(reference) &&
					!allowedLocationRefs.has(reference),
			);
	});
	if (invalid.length > 0) {
		throw new StructuredImprovementRequestError(
			`improvement request referenced evidence outside the saved warning group bundle: ${[...new Set(invalid)].join(", ")}`,
		);
	}
}

function assertPrioritySemantics(
	request: LlmWarningGroupImprovementRequest,
	bundle: ImprovementRequestIssueBundle,
): void {
	const severityById = new Map(
		bundle.warningGroupManifest.map((entry) => [
			entry.warningGroupId,
			entry.severity,
		]),
	);
	const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
	const severityRank = {
		critical: 0,
		high: 1,
		medium: 2,
		low: 3,
		info: 3,
		unknown: 3,
	} as const;
	for (const plan of request.priorityPlan) {
		if (plan.warningGroupIds.length === 0) continue;
		const maximumSeverityRank = plan.warningGroupIds.reduce((maximum, id) => {
			const severity = severityById.get(id) ?? "unknown";
			return Math.min(maximum, severityRank[severity]);
		}, 3);
		if (priorityRank[plan.priority] < maximumSeverityRank) {
			throw new StructuredImprovementRequestError(
				`improvement request priority exceeded saved scanner severity for warning groups: ${plan.warningGroupIds.join(", ")}`,
			);
		}
	}
}

function expandWarningGroupRequest(
	request: LlmWarningGroupImprovementRequest,
	bundle: ImprovementRequestIssueBundle,
): ScanImprovementRequest {
	const manifest = new Map(
		bundle.warningGroupManifest.map((item) => [item.warningGroupId, item]),
	);
	const expand = (warningGroupIds: string[]) => {
		const entries = warningGroupIds.flatMap((id) => {
			const entry = manifest.get(id);
			return entry ? [entry] : [];
		});
		return {
			issueIds: [...new Set(entries.flatMap((entry) => entry.issueIds))],
			findingIds: [
				...new Set(entries.flatMap((entry) => entry.memberFindingIds)),
			],
		};
	};
	return scanImprovementRequestSchema.parse({
		...request,
		priorityPlan: request.priorityPlan.map((plan) => ({
			...plan,
			...expand(plan.warningGroupIds),
		})),
		implementationTasks: request.implementationTasks.map((task) => ({
			...task,
			...expand(task.warningGroupIds),
		})),
	});
}
