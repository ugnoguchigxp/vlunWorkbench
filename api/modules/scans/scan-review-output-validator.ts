import type { AutomatedScanReviewOutput } from "../../../shared/schemas/automated-diagnostic.schema";
import { automatedScanReviewOutputSchema } from "../../../shared/schemas/automated-diagnostic.schema";
import { LlmProviderExecutionError } from "../../providers/types";
import { assertJapaneseTextFields } from "../llm-language";
import type { ScanReviewBundle } from "./scan-review-bundle";

class StructuredScanReviewOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StructuredScanReviewOutputError";
	}
}

function extractJsonObject(input: string): string | null {
	const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? input;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end < start) return null;
	return candidate.slice(start, end + 1);
}

function assertBundleReferences(
	output: AutomatedScanReviewOutput,
	bundle: ScanReviewBundle,
): void {
	const findingIds = new Set(bundle.findings.map((finding) => finding.id));
	const referencedFindingIds = [
		...output.findingTriageHints.map((hint) => ({
			path: "findingTriageHints.findingId",
			findingId: hint.findingId,
		})),
		...output.findingAssessments.map((assessment) => ({
			path: "findingAssessments.findingId",
			findingId: assessment.findingId,
		})),
		...output.improvementRequest.priorityPlan.flatMap((item, index) =>
			item.findingIds.map((findingId) => ({
				path: `improvementRequest.priorityPlan.${index}.findingIds`,
				findingId,
			})),
		),
		...output.improvementRequest.implementationTasks.flatMap((item, index) =>
			item.findingIds.map((findingId) => ({
				path: `improvementRequest.implementationTasks.${index}.findingIds`,
				findingId,
			})),
		),
	];
	const invalidFindingIds = referencedFindingIds.filter(
		(item) => !findingIds.has(item.findingId),
	);
	if (invalidFindingIds.length > 0) {
		throw new StructuredScanReviewOutputError(
			`scan review output referenced IDs outside the saved bundle: ${invalidFindingIds
				.map((item) => `${item.path}=${item.findingId}`)
				.join(", ")}`,
		);
	}

	const assessmentCounts = new Map<string, number>();
	for (const assessment of output.findingAssessments) {
		assessmentCounts.set(
			assessment.findingId,
			(assessmentCounts.get(assessment.findingId) ?? 0) + 1,
		);
	}
	const invalidAssessmentCoverage = [...findingIds].filter(
		(findingId) => assessmentCounts.get(findingId) !== 1,
	);
	if (
		invalidAssessmentCoverage.length > 0 ||
		output.findingAssessments.length !== findingIds.size
	) {
		throw new StructuredScanReviewOutputError(
			"findingAssessments must contain exactly one assessment for every finding in the saved bundle.",
		);
	}

	const allowedEvidenceRefs = new Map<string, Set<string>>([
		["finding", findingIds],
		[
			"evidence",
			new Set(
				bundle.findings.flatMap((finding) =>
					finding.evidence.map((evidence) => evidence.id),
				),
			),
		],
		["artifact", new Set(bundle.artifacts.map((artifact) => artifact.id))],
		[
			"verification",
			new Set([
				...bundle.verification.reproductions.map((row) => row.id),
				...bundle.verification.dynamicRuns.map((row) => row.id),
				...bundle.verification.dastRuns.map((row) => row.id),
			]),
		],
	]);
	const invalidEvidenceRefs = output.findingAssessments.flatMap(
		(assessment, assessmentIndex) =>
			assessment.evidenceRefs
				.filter((ref) => !allowedEvidenceRefs.get(ref.kind)?.has(ref.id))
				.map(
					(ref) =>
						`findingAssessments.${assessmentIndex}.evidenceRefs=${ref.kind}:${ref.id}`,
				),
	);
	if (invalidEvidenceRefs.length > 0) {
		throw new StructuredScanReviewOutputError(
			`scan review output referenced evidence outside the saved bundle: ${invalidEvidenceRefs.join(", ")}`,
		);
	}

	if (bundle.findings.length === 0) return;
	const emptyFindingReferences = [
		...(output.improvementRequest.priorityPlan.length === 0
			? ["improvementRequest.priorityPlan"]
			: []),
		...output.improvementRequest.priorityPlan.flatMap((item, index) =>
			item.findingIds.length === 0
				? [`improvementRequest.priorityPlan.${index}.findingIds`]
				: [],
		),
		...(output.improvementRequest.implementationTasks.length === 0
			? ["improvementRequest.implementationTasks"]
			: []),
		...output.improvementRequest.implementationTasks.flatMap((item, index) =>
			item.findingIds.length === 0
				? [`improvementRequest.implementationTasks.${index}.findingIds`]
				: [],
		),
	];
	if (emptyFindingReferences.length > 0) {
		throw new StructuredScanReviewOutputError(
			`scan review output omitted finding references for non-empty bundle: ${emptyFindingReferences.join(", ")}`,
		);
	}
}

function assertJapaneseOutput(output: AutomatedScanReviewOutput): void {
	assertJapaneseTextFields(output as unknown as Record<string, unknown>, [
		"summary",
		"riskOverview",
		"priorityNotes",
		"coverageNotes",
		"falsePositiveHotspots",
		"recommendedNextActions",
		"confidenceNotes",
		"systemicRiskThemes",
		"limitations",
		"improvementRequest.title",
		"improvementRequest.objective",
		"improvementRequest.scope",
		"improvementRequest.acceptanceCriteria",
		"improvementRequest.constraints",
		"improvementRequest.nonGoals",
		"improvementRequest.handoffPrompt",
	]);
	for (const [index, assessment] of output.findingAssessments.entries()) {
		assertIndexedJapaneseFields(
			assessment as unknown as Record<string, unknown>,
			[
				"criticalityRationale",
				"businessImpact",
				"remediation",
				"assumptions",
				"unknowns",
			],
			`findingAssessments.${index}`,
		);
	}
	for (const [index, hint] of output.findingTriageHints.entries()) {
		assertIndexedJapaneseFields(
			hint as unknown as Record<string, unknown>,
			["note"],
			`findingTriageHints.${index}`,
		);
	}
	for (const [
		index,
		item,
	] of output.improvementRequest.priorityPlan.entries()) {
		assertIndexedJapaneseFields(
			item as unknown as Record<string, unknown>,
			["rationale"],
			`improvementRequest.priorityPlan.${index}`,
		);
	}
	for (const [
		index,
		item,
	] of output.improvementRequest.implementationTasks.entries()) {
		assertIndexedJapaneseFields(
			item as unknown as Record<string, unknown>,
			["title", "body"],
			`improvementRequest.implementationTasks.${index}`,
		);
	}
}

function assertIndexedJapaneseFields(
	value: Record<string, unknown>,
	paths: string[],
	prefix: string,
): void {
	try {
		assertJapaneseTextFields(value, paths);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const field = paths.find((path) => message.includes(path));
		throw new Error(
			field ? message.replace(field, `${prefix}.${field}`) : message,
		);
	}
}

export function parseAutomatedScanReviewOutput(
	responseContent: string,
	bundle: ScanReviewBundle,
	options: { enforceJapanese: boolean } = { enforceJapanese: true },
): AutomatedScanReviewOutput {
	const jsonText = extractJsonObject(responseContent);
	if (!jsonText) {
		throw new StructuredScanReviewOutputError(
			"LLM response did not contain a valid JSON object.",
		);
	}
	try {
		const output = automatedScanReviewOutputSchema.parse(JSON.parse(jsonText));
		assertBundleReferences(output, bundle);
		if (options.enforceJapanese) assertJapaneseOutput(output);
		return output;
	} catch (error) {
		if (error instanceof StructuredScanReviewOutputError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new StructuredScanReviewOutputError(message);
	}
}

export function formatScanReviewRunError(error: unknown): string {
	if (error instanceof LlmProviderExecutionError) {
		return `llm_provider_execution_failed: ${error.message}`;
	}
	if (error instanceof StructuredScanReviewOutputError) {
		return `llm_structured_output_validation_failed: ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}
