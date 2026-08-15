import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
	DiffToolApplicability,
	ResolvedScanTarget,
} from "../../../shared/schemas/scan-target.schema";
import type { SecurityIntelligenceAssessmentV1 } from "../../../shared/schemas/security-intelligence-assessment.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import type { AppDatabase } from "../../db";
import {
	findings,
	projects,
	scanArtifacts,
	scanRuns,
	toolRuns,
} from "../../db/schema";
import { ArtifactStorage } from "../scans/artifact-storage";
import {
	observeDependencyChange,
	toolLabel,
} from "./dependency-change-observer";
import {
	failSecurityAssessmentInput as fail,
	type PersistedDependencyToolResult,
	parseDependencyToolResults,
	parseSecurityAssessmentInput as parseOrFail,
	persistedDependencyFindingMetadataSchema,
	persistedDependencyScanMetadataSchema,
	persistedDependencyToolRunMetadataSchema,
	SecurityAssessmentInputError,
} from "./persisted-dependency-assessment.schema";
import {
	buildDependencyAssessment,
	type DependencyAssessmentEvidenceInput,
	type DependencyVerificationInput,
} from "./security-assessment-builder";
import {
	assertReferencedArtifactIntegrity,
	loadVerifiedDiffManifest,
} from "./security-assessment-integrity";

export type DependencyAssessmentRequest = {
	scanRunId: string;
	expectedProjectId?: string;
	ownerUserId?: string;
	expectedSourceRevision?: string;
	generatedAt?: Date;
};

export { SecurityAssessmentInputError };

export async function buildPersistedDependencyAssessment(params: {
	db: AppDatabase;
	request: DependencyAssessmentRequest;
	artifactStorage?: ArtifactStorage;
	producerVersion?: string;
}): Promise<SecurityIntelligenceAssessmentV1> {
	const storage = params.artifactStorage ?? new ArtifactStorage();
	const scanRun = await params.db.query.scanRuns.findFirst({
		where: eq(scanRuns.id, params.request.scanRunId),
	});
	if (!scanRun) fail("scan_run_not_found");
	const project = await params.db.query.projects.findFirst({
		where: eq(projects.id, scanRun.projectId),
	});
	if (!project) fail("scan_project_not_found");
	assertRequestBinding({ request: params.request, scanRun, project });
	if (!scanRun.completedAt) fail("scan_run_not_completed");

	const metadata = parseOrFail(
		persistedDependencyScanMetadataSchema,
		scanRun.metadata,
		"scan_metadata_invalid",
	);
	const artifactRows = await params.db.query.scanArtifacts.findMany({
		where: eq(scanArtifacts.scanRunId, scanRun.id),
	});
	const manifestArtifact = artifactRows.find(
		(artifact) => artifact.id === metadata.diffManifestArtifactId,
	);
	if (manifestArtifact?.kind !== "diff_manifest") {
		fail("diff_manifest_not_found");
	}
	if (
		artifactRows.filter((artifact) => artifact.kind === "diff_manifest")
			.length !== 1
	) {
		fail("diff_manifest_ambiguous");
	}
	const parsedManifest = await loadVerifiedDiffManifest({
		storage,
		artifact: manifestArtifact,
		metadataTarget: metadata.target,
	});

	const sourceRevision = sourceRevisionForTarget(metadata.target);
	if (
		params.request.expectedSourceRevision !== undefined &&
		params.request.expectedSourceRevision !== sourceRevision
	) {
		fail("source_revision_mismatch");
	}
	const scanRunRef = `scan-run:${scanRun.id}`;
	const targetDigest = `sha256:${metadata.target.targetDigest}`;
	const manifestEvidence = evidence({
		ref: `artifact:${manifestArtifact.id}`,
		kind: "scan_artifact",
		scanRunRef,
		targetDigest,
		digest: `sha256:${manifestArtifact.sha256}`,
	});

	const persistedToolResults = parseDependencyToolResults(metadata.toolResults);
	assertUniqueToolResults(persistedToolResults);
	await assertReferencedArtifactIntegrity({
		storage,
		results: persistedToolResults,
		artifactRows,
	});
	const [toolRunRows, findingRows] = await Promise.all([
		params.db.query.toolRuns.findMany({
			where: eq(toolRuns.scanRunId, scanRun.id),
		}),
		params.db.query.findings.findMany({
			where: eq(findings.scanRunId, scanRun.id),
		}),
	]);
	const observation = observeDependencyChange({
		manifest: parsedManifest,
		toolApplicability: metadata.diffToolApplicability,
	});
	const verifications = buildVerifications({
		observationChanged: observation.dependencyStateChanged,
		toolApplicability: metadata.diffToolApplicability,
		manifestEvidence,
		results: persistedToolResults,
		toolRunRows,
		artifactRows,
		findingRows,
		projectId: project.id,
		scanRunRef,
		targetDigest,
		rawTargetDigest: metadata.target.targetDigest,
	});
	addExecutionLimitations(observation, verifications);

	return buildDependencyAssessment({
		producerVersion: params.producerVersion ?? "1.0.0",
		projectRef: `project:${project.id}`,
		scanRunRef,
		profileRef: scanRun.profile,
		completedAt: scanRun.completedAt.toISOString(),
		generatedAt: (params.request.generatedAt ?? new Date()).toISOString(),
		target: { sourceRevision, targetDigest },
		manifestEvidence,
		observation,
		verifications,
	});
}

function buildVerifications(params: {
	observationChanged: boolean;
	toolApplicability: readonly DiffToolApplicability[];
	manifestEvidence: DependencyAssessmentEvidenceInput;
	results: PersistedDependencyToolResult[];
	toolRunRows: Array<typeof toolRuns.$inferSelect>;
	artifactRows: Array<typeof scanArtifacts.$inferSelect>;
	findingRows: Array<typeof findings.$inferSelect>;
	projectId: string;
	scanRunRef: string;
	targetDigest: string;
	rawTargetDigest: string;
}): DependencyVerificationInput[] {
	const dependencyApplicability = params.toolApplicability.filter(
		(tool) => tool.toolId === "osv" || tool.toolId === "trivy",
	);
	if (
		new Set(dependencyApplicability.map((tool) => tool.toolId)).size !==
		dependencyApplicability.length
	) {
		fail("duplicate_dependency_tool_applicability");
	}
	if (dependencyApplicability.length === 0) {
		return [
			{
				toolId: "dependency",
				required: params.observationChanged,
				status: params.observationChanged ? "unavailable" : "not_applicable",
				reasonCode: params.observationChanged
					? "dependency_tool_not_configured"
					: "dependency_change_not_observed",
				summary: params.observationChanged
					? "No dependency scanner result was stored for the saved diff."
					: "Dependency verification was not applicable to the saved diff.",
				evidenceRefs: [params.manifestEvidence],
				findingRefs: [],
			},
		];
	}
	for (const result of params.results) {
		if (
			!dependencyApplicability.some((tool) => tool.toolId === result.toolId)
		) {
			fail("tool_result_applicability_missing");
		}
	}
	return dependencyApplicability.map((applicability) => {
		const result = params.results.find(
			(candidate) => candidate.toolId === applicability.toolId,
		);
		if (!result) {
			return missingToolVerification(applicability, params.manifestEvidence);
		}
		if (
			result.applicability !== undefined &&
			result.applicability !== applicability.applicability
		) {
			fail("tool_applicability_result_mismatch");
		}
		if (
			applicability.applicability === "not_applicable" &&
			result.status !== "skipped"
		) {
			fail("tool_applicability_result_mismatch");
		}
		const toolRun = result.toolRunId
			? params.toolRunRows.find((row) => row.id === result.toolRunId)
			: null;
		if (result.toolRunId && !toolRun) fail("tool_run_binding_mismatch");
		if (
			(result.status === "completed" || result.status === "failed") &&
			!toolRun
		) {
			fail("tool_run_missing");
		}
		if (toolRun) {
			if (toolRun.toolName !== result.toolId) fail("tool_run_name_mismatch");
			if (toolRun.status !== result.status) fail("tool_run_status_mismatch");
			const runMetadata = parseOrFail(
				persistedDependencyToolRunMetadataSchema,
				toolRun.metadata,
				"tool_run_target_missing",
			);
			if (runMetadata.scanTarget.targetDigest !== params.rawTargetDigest) {
				fail("tool_run_target_mismatch");
			}
		}

		const dependencyFindings = params.findingRows.filter(
			(finding) =>
				finding.sourceTool === result.toolId &&
				isTargetBoundDependencyFinding(finding, params.rawTargetDigest),
		);
		if (result.findingCount !== dependencyFindings.length) {
			fail("tool_result_finding_count_mismatch");
		}
		for (const finding of dependencyFindings) {
			if (finding.projectId !== params.projectId) {
				fail("finding_project_mismatch");
			}
		}
		const evidenceRefs: DependencyAssessmentEvidenceInput[] = [
			params.manifestEvidence,
		];
		if (toolRun) {
			evidenceRefs.push(
				evidence({
					ref: `tool-run:${toolRun.id}`,
					kind: "tool_run",
					scanRunRef: params.scanRunRef,
					targetDigest: params.targetDigest,
					digest: sha256(
						canonicalStringifySecurityIntelligenceValue({
							completedAt: toolRun.completedAt?.toISOString() ?? null,
							exitCode: toolRun.exitCode,
							id: toolRun.id,
							status: toolRun.status,
							toolName: toolRun.toolName,
							toolVersion: toolRun.toolVersion,
						}),
					),
				}),
			);
		}
		for (const artifactId of result.artifactIds ?? []) {
			const artifact = params.artifactRows.find((row) => row.id === artifactId);
			if (!artifact || artifact.toolRunId !== result.toolRunId) {
				fail("tool_artifact_binding_mismatch");
			}
			evidenceRefs.push(
				evidence({
					ref: `artifact:${artifact.id}`,
					kind: "scan_artifact",
					scanRunRef: params.scanRunRef,
					targetDigest: params.targetDigest,
					digest: `sha256:${artifact.sha256}`,
				}),
			);
		}
		for (const finding of dependencyFindings) {
			evidenceRefs.push(
				evidence({
					ref: `finding:${finding.id}`,
					kind: "finding",
					scanRunRef: params.scanRunRef,
					targetDigest: params.targetDigest,
					digest: sha256(
						canonicalStringifySecurityIntelligenceValue({
							fingerprint: finding.fingerprint,
							id: finding.id,
							ruleId: finding.ruleId,
							sourceTool: finding.sourceTool,
						}),
					),
				}),
			);
		}
		const status = verificationStatus(result);
		return {
			toolId: result.toolId,
			required: result.required && status !== "not_applicable",
			status,
			reasonCode: verificationReason(result, status, dependencyFindings.length),
			summary: verificationSummary(
				result.toolId,
				status,
				dependencyFindings.length,
			),
			evidenceRefs,
			findingRefs: dependencyFindings.map((finding) => `finding:${finding.id}`),
		};
	});
}

function missingToolVerification(
	applicability: {
		toolId: string;
		applicability: string;
		reasonCode: string | null;
	},
	manifestEvidence: DependencyAssessmentEvidenceInput,
): DependencyVerificationInput {
	if (applicability.toolId !== "osv" && applicability.toolId !== "trivy") {
		fail("dependency_tool_id_invalid");
	}
	const applicable = applicability.applicability === "applicable";
	return {
		toolId: applicability.toolId,
		required: applicable,
		status: applicable ? "unavailable" : "not_applicable",
		reasonCode: applicable
			? "dependency_tool_result_missing"
			: (applicability.reasonCode ?? "dependency_verification_not_applicable"),
		summary: applicable
			? `${toolLabel(applicability.toolId)} result was not stored for the saved diff.`
			: `${toolLabel(applicability.toolId)} was not applicable to the saved diff.`,
		evidenceRefs: [manifestEvidence],
		findingRefs: [],
	};
}

function isTargetBoundDependencyFinding(
	finding: typeof findings.$inferSelect,
	targetDigest: string,
): boolean {
	const metadata = persistedDependencyFindingMetadataSchema.safeParse(
		finding.metadata,
	);
	if (!metadata.success) fail("finding_target_missing");
	if (metadata.data.scanTarget.targetDigest !== targetDigest) {
		fail("finding_target_mismatch");
	}
	return metadata.data.diffRelation.kind === "target_state_dependency";
}

function verificationStatus(
	result: PersistedDependencyToolResult,
): DependencyVerificationInput["status"] {
	if (result.applicability === "not_applicable") return "not_applicable";
	if (result.status === "completed") return "tested";
	if (result.status === "failed") return "failed";
	return "not_tested";
}

function verificationReason(
	result: PersistedDependencyToolResult,
	status: DependencyVerificationInput["status"],
	findingCount: number,
): string {
	if (status === "tested") {
		return findingCount > 0
			? "completed_with_findings"
			: "completed_without_findings";
	}
	if (status === "failed") return "tool_execution_failed";
	return result.reasonCode ?? "verification_not_completed";
}

function verificationSummary(
	toolId: "osv" | "trivy",
	status: DependencyVerificationInput["status"],
	findingCount: number,
): string {
	const label = toolLabel(toolId);
	if (status === "tested") {
		return findingCount > 0
			? `${label} completed and reported dependency findings.`
			: `${label} completed without reporting dependency findings.`;
	}
	if (status === "failed") return `${label} execution failed.`;
	if (status === "not_applicable") {
		return `${label} was not applicable to the saved diff.`;
	}
	return `${label} verification was not completed.`;
}

function addExecutionLimitations(
	observation: ReturnType<typeof observeDependencyChange>,
	verifications: readonly DependencyVerificationInput[],
): void {
	for (const verification of verifications) {
		if (verification.status === "tested") continue;
		observation.limitationCodes.push(verification.reasonCode);
	}
	observation.limitationCodes = canonicalStrings(observation.limitationCodes);
}

function assertRequestBinding(params: {
	request: DependencyAssessmentRequest;
	scanRun: typeof scanRuns.$inferSelect;
	project: typeof projects.$inferSelect;
}): void {
	if (
		params.request.expectedProjectId !== undefined &&
		params.request.expectedProjectId !== params.scanRun.projectId
	) {
		fail("project_binding_mismatch");
	}
	if (
		params.request.ownerUserId !== undefined &&
		params.request.ownerUserId !== params.project.ownerUserId
	) {
		fail("project_owner_mismatch");
	}
}

function sourceRevisionForTarget(target: ResolvedScanTarget): string {
	return target.headSha ?? `working-tree/${target.targetDigest}`;
}

function assertUniqueToolResults(
	results: readonly PersistedDependencyToolResult[],
): void {
	if (new Set(results.map((result) => result.toolId)).size !== results.length) {
		fail("duplicate_dependency_tool_result");
	}
}

function evidence(
	input: Omit<DependencyAssessmentEvidenceInput, "targetRole">,
): DependencyAssessmentEvidenceInput {
	return { ...input, targetRole: "assessment_target" };
}

function sha256(value: string): `sha256:${string}` {
	return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
}
