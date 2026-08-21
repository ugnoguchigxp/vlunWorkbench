import type { DastCoverageSummary } from "../../../../shared/schemas/dast-coverage.schema";
import type {
	ProfileToolEntry,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import type {
	DiffManifestEntry,
	ResolvedScanTarget,
} from "../../../../shared/schemas/scan-target.schema";
import type { AppDatabase } from "../../../db";
import type { ArtifactStorage } from "./lifecycle/artifact-storage";
import type { NormalizedFinding } from "../findings/normalizers/fixture";
import { buildMarkdownReport } from "../reporting/report-builder";
import { ScanReportRepository } from "../reporting/report-repository";
import { ArtifactRepository } from "../repositories";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";

export interface ToolResult {
	toolId: string;
	toolRunId: string | null;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	findingCount: number;
	exitCode: number | null;
	error: string | null;
	applicability?: "applicable" | "not_applicable";
	reasonCode?: string | null;
	coverageEffect?: "covered" | "partial" | "gap";
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
}

export type DiffToolExecutionContext = {
	target: ResolvedScanTarget;
	entries: DiffManifestEntry[];
	targetPaths?: string[];
	inputKind: "full_snapshot" | "changed_workspace";
	contextFileCount?: number;
};

export type DastStepResult = {
	kind: "dast";
	profileId: string;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	outcome: string | null;
	verdict?: string | null;
	coverageStatus?: "covered" | "partial" | "gap" | null;
	coverageSummary?: DastCoverageSummary | null;
	limitationCodes?: string[];
	findingCount: number;
	dastRunId: string | null;
	targetOrigin: string | null;
	error: string | null;
	autoTarget?: {
		scriptName: string;
		command: string[];
		port: number;
		origin: string;
		warnings: string[];
	};
};

export type CoverageStepResult = {
	kind:
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	stepId: string;
	adapter: string;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	applicability: "applicable" | "not_applicable";
	reasonCode: string | null;
	coverageEffect: "covered" | "partial" | "gap";
	findingCount: number;
	error: string | null;
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
};

export type ScanProfileStepResult =
	| (ToolResult & { kind: "static_tool" })
	| DastStepResult
	| CoverageStepResult;

export interface ProfileScanResult {
	ok: boolean;
	scanRunId: string;
	profileId: string;
	canonicalProfileId: string;
	executionProfileId: string;
	resultPolicy: "advisory" | "gate";
	gateDecision: "not_requested" | "pass" | "fail" | "blocked";
	status: "completed" | "failed";
	profileOutcome:
		| "completed"
		| "completed_with_warnings"
		| "blocked"
		| "incomplete"
		| "failed";
	runner: "host" | "docker";
	message?: string;
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
}

export interface FinalReportOptions {
	enabled: boolean;
	title?: string;
	includeFalsePositives?: boolean;
	includeDeferred?: boolean;
	includeUndecided?: boolean;
}

export interface FinalReportResult {
	ok: boolean;
	reportId: string | null;
	artifactId: string | null;
	artifactPath: string | null;
	status: "completed" | "failed" | "skipped";
	error: string | null;
}

export type CommonToolRunResult = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	rawJson?: unknown;
	rawJsonArtifact?: {
		path: string;
		sha256: string;
		sizeBytes: number;
	};
	stdoutArtifact?: { path: string; sha256: string; sizeBytes: number };
	stderrArtifact?: { path: string; sha256: string; sizeBytes: number };
	error?: string;
	executionMetadata?: Record<string, unknown>;
};

export function buildBaseExecutionMetadata(execution: ToolExecutionConfig) {
	if (execution.runner === "docker") {
		const docker = execution.docker ?? {};
		return {
			runner: "docker",
			docker: {
				image: docker.image ?? "vuln-workbench-toolbox:local",
				networkMode: docker.networkMode ?? "none",
				mountMode: {
					repo: "read-only",
					output: "read-write",
					cache: docker.toolCacheDir ? "read-write" : "none",
				},
				resourceLimits: {
					memory: docker.memory ?? null,
					cpus: docker.cpus ?? null,
				},
			},
		};
	}
	return { runner: "host" };
}

export function resolveProfileSteps(params: {
	steps?: ScanProfileStep[];
	tools: ProfileToolEntry[];
	stepId?: string;
}): ScanProfileStep[] {
	const steps =
		params.steps ??
		params.tools.map((tool) => ({
			kind: "static_tool" as const,
			...tool,
		}));
	if (!params.stepId) return steps;
	const selected = steps.filter((step) => {
		const id =
			step.kind === "static_tool"
				? step.toolId
				: step.kind === "dast"
					? `dast:${step.profileId}`
					: `${step.kind}:${step.adapter}`;
		return id === params.stepId;
	});
	if (selected.length === 0)
		throw new Error(`Profile step not found: ${params.stepId}`);
	return selected;
}

export async function generateFinalReport(params: {
	db: AppDatabase;
	scanRunId: string;
	artifactStorage: ArtifactStorage;
	options: Required<FinalReportOptions>;
	/** Supplying a claimed record lets finalization preserve one canonical report. */
	reportId?: string;
	stage?: "preliminary" | "canonical_final";
	reportMetadata?: Record<string, unknown>;
}): Promise<FinalReportResult> {
	const reportRepo = new ScanReportRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const reportOptions = {
		includeFalsePositives: params.options.includeFalsePositives,
		includeDeferred: params.options.includeDeferred,
		includeUndecided: params.options.includeUndecided,
		source: "scan-profile-final-report",
		...(params.reportMetadata ?? {}),
	};
	const report = params.reportId
		? await reportRepo.findById(params.reportId)
		: await reportRepo.createReport({
				scanRunId: params.scanRunId,
				format: "markdown",
				title: params.options.title,
				options: reportOptions,
				stage: params.stage ?? "preliminary",
				status: "running",
			});
	if (!report) throw new Error("Final report record was not found.");
	if (report.scanRunId !== params.scanRunId || report.status !== "running") {
		throw new Error("Final report record is not claimed for this scan.");
	}
	if (params.reportId) {
		await reportRepo.updateReportStatus(report.id, "running", {
			options: reportOptions,
		});
	}

	try {
		const markdown = await buildMarkdownReport(params.db, params.scanRunId, {
			includeFalsePositives: params.options.includeFalsePositives,
			includeDeferred: params.options.includeDeferred,
			includeUndecided: params.options.includeUndecided,
			title: params.options.title,
		});
		// A failed post-write DB update can be retried under the same canonical
		// report ID. Keep every attempt immutable rather than colliding on the
		// storage layer's exclusive-create guard.
		const filename = `report-${report.id}-attempt-${report.attemptCount}.md`;
		const saveResult = await params.artifactStorage
			.forOwner({
				scanRunId: params.scanRunId,
				kind: "report",
				id: report.id,
			})
			.saveTextArtifact(params.scanRunId, "reports", markdown, filename);
		const artifact = await artifactRepo.createArtifact({
			scanRunId: params.scanRunId,
			toolRunId: null,
			kind: "report",
			format: "markdown",
			path: saveResult.path,
			sha256: saveResult.sha256,
			sizeBytes: saveResult.sizeBytes,
			metadata: {
				reportId: report.id,
				source: "scan-profile-final-report",
				stage: report.stage,
				...params.reportMetadata,
			},
		});
		await reportRepo.updateReportStatus(report.id, "completed", {
			artifactId: artifact.id,
			summary: markdown.slice(0, 500),
		});
		return {
			ok: true,
			reportId: report.id,
			artifactId: artifact.id,
			artifactPath: saveResult.path,
			status: "completed",
			error: null,
		};
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		await reportRepo.updateReportStatus(report.id, "failed", {
			errorMessage: error,
		});
		return {
			ok: false,
			reportId: report.id,
			artifactId: null,
			artifactPath: null,
			status: "failed",
			error,
		};
	}
}

export function persistedTargetMetadata(target: ResolvedScanTarget) {
	return {
		schemaVersion: target.schemaVersion,
		kind: target.kind,
		projectPrefix: target.projectPrefix,
		baseSha: target.baseSha,
		headSha: target.headSha,
		mergeBaseSha: target.mergeBaseSha,
		includeUntracked: target.includeUntracked,
		targetDigest: target.targetDigest,
		snapshotDigest: target.snapshotDigest,
	};
}

export function buildDiffFindingRelation(
	finding: NormalizedFinding,
	toolId: string,
	entries: DiffManifestEntry[],
): Record<string, unknown> {
	const metadata = finding.metadata ?? {};
	const dependencyFinding =
		toolId === "osv" ||
		(toolId === "trivy" &&
			("vulnerabilityId" in metadata || "packageName" in metadata));
	const locationPath = normalizeFindingPath(finding.primaryLocation.path);
	if (dependencyFinding) {
		return {
			kind: "target_state_dependency",
			path: locationPath,
		};
	}
	const entry = entries.find(
		(candidate) => normalizeFindingPath(candidate.path) === locationPath,
	);
	if (entry) {
		return {
			kind: "changed_file",
			path: entry.path,
			pathStatus: entry.status,
		};
	}
	return {
		kind: "unmapped",
		path: locationPath,
		reasonCode: "finding_path_not_in_diff_manifest",
	};
}

export function normalizeFindingPath(value: string): string {
	return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export { runDastStepIntoExistingScan } from "./profile-dast-step-runner";
export { runRuntimeScannerIntoExistingScan } from "./profile-runtime-step-runner";
export { runSchemaScannerIntoExistingScan } from "./profile-schema-step-runner";
export { runToolIntoExistingScan } from "./profile-static-tool-runner";
