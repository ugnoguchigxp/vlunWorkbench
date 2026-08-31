import { eq, inArray } from "drizzle-orm";
import { scanProfileResolutionSchema } from "../../../shared/schemas/scan-profile-catalog.schema";
import type { AppDatabase } from "../../db";
import {
	dastRuns,
	findingDecisions,
	findingReviews,
	findings,
	scanArtifacts,
	scanRuns,
	toolRuns,
} from "../../db/schema";
import { getProfileById } from "./profiles";
import { readStoredResolvedProfile } from "./resolved-profile";

export interface ToolSummary {
	toolId: string;
	toolRunId: string | null;
	status: string;
	required: boolean;
	exitCode: number | null;
	toolVersion: string | null;
	findingCount: number;
	severityCounts: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
		unknown: number;
	};
	artifactCount: number;
	error: string | null;
	metadata?: Record<string, unknown>;
}

export interface StepSummary {
	kind:
		| "static_tool"
		| "dast"
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan"
		| "attestation_verify";
	id: string;
	displayName: string;
	status: string;
	required: boolean;
	findingCount: number;
	artifactCount: number;
	error: string | null;
	outcome?: string | null;
	verdict?: string | null;
	coverageStatus?: "covered" | "partial" | "gap" | null;
	coverageSummary?: Record<string, unknown> | null;
	limitationCodes?: string[];
	targetOrigin?: string | null;
	reasonCode?: string | null;
	coverageEffect?: "covered" | "partial" | "gap";
	metadata?: Record<string, unknown>;
}

export interface ScanRunSummary {
	scanRunId: string;
	profileId: string;
	canonicalProfileId?: string;
	executionProfileId?: string;
	resultPolicy?: "advisory" | "gate";
	gateDecision?: "not_requested" | "pass" | "fail" | "blocked";
	profileOutcome: string;
	tools: ToolSummary[];
	steps?: StepSummary[];
	totals: {
		findingCount: number;
		artifactCount: number;
		reviewedFindingCount: number;
		decidedFindingCount: number;
	};
}

export async function buildScanRunSummary(
	db: AppDatabase,
	scanRunId: string,
): Promise<ScanRunSummary> {
	// 1. Fetch scan run
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId))
		.limit(1);

	if (!scanRun) {
		throw new Error(`Scan run not found: ${scanRunId}`);
	}

	// 2. Fetch tool runs
	const dbToolRuns = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, scanRunId));

	// 3. Fetch artifacts
	const dbArtifacts = await db
		.select()
		.from(scanArtifacts)
		.where(eq(scanArtifacts.scanRunId, scanRunId));

	// 4. Fetch findings
	const dbFindings = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, scanRunId));
	const dbDastRuns = await db
		.select()
		.from(dastRuns)
		.where(eq(dastRuns.scanRunId, scanRunId));

	// 5. Fetch reviews and decisions for totals
	let reviewedFindingCount = 0;
	let decidedFindingCount = 0;

	if (dbFindings.length > 0) {
		const findingIds = dbFindings.map((f) => f.id);

		// Completed reviews
		const completedReviews = await db
			.select()
			.from(findingReviews)
			.where(inArray(findingReviews.findingId, findingIds));

		// Uniquely count findings that have at least one completed review
		const completedReviewFindingIds = new Set(
			completedReviews
				.filter((r) => r.status === "completed")
				.map((r) => r.findingId),
		);
		reviewedFindingCount = completedReviewFindingIds.size;

		// Decisions
		const decisions = await db
			.select()
			.from(findingDecisions)
			.where(inArray(findingDecisions.findingId, findingIds));

		const decidedFindingIds = new Set(decisions.map((d) => d.findingId));
		decidedFindingCount = decidedFindingIds.size;
	}

	// 6. Map tools using the profile definition
	const profile =
		readStoredResolvedProfile(scanRun.metadata, scanRun.profile) ??
		getProfileById(scanRun.profile);
	const profileTools = profile?.tools ?? [];
	const profileSteps = profile?.steps ?? [];
	const metadataStepResults = Array.isArray(scanRun.metadata?.stepResults)
		? (scanRun.metadata.stepResults as Array<Record<string, unknown>>)
		: [];

	const tools: ToolSummary[] = [];

	// Map findings and artifacts to tools
	for (const pt of profileTools) {
		const tr = dbToolRuns.find((r) => r.toolName === pt.toolId);
		const toolFindings = dbFindings.filter((f) => f.sourceTool === pt.toolId);
		const toolArtifacts = dbArtifacts.filter(
			(a) => a.toolRunId === (tr?.id ?? null),
		);

		const severityCounts = {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			unknown: 0,
		};

		for (const f of toolFindings) {
			const sev = f.severity.toLowerCase();
			if (sev === "critical") severityCounts.critical++;
			else if (sev === "high") severityCounts.high++;
			else if (sev === "medium") severityCounts.medium++;
			else if (sev === "low") severityCounts.low++;
			else if (sev === "info") severityCounts.info++;
			else severityCounts.unknown++;
		}

		tools.push({
			toolId: pt.toolId,
			toolRunId: tr?.id ?? null,
			status: tr?.status ?? "skipped",
			required: pt.required,
			exitCode: tr?.exitCode ?? null,
			toolVersion: tr?.toolVersion ?? null,
			findingCount: toolFindings.length,
			severityCounts,
			artifactCount: toolArtifacts.length,
			error: (tr?.metadata?.error as string) ?? null,
			metadata: tr?.metadata ?? {},
		});
	}

	// Also catch any tool runs not defined in the profile (if any, e.g., ad-hoc run, though rare in profile scans)
	for (const tr of dbToolRuns) {
		if (!tools.some((t) => t.toolId === tr.toolName)) {
			const toolFindings = dbFindings.filter(
				(f) => f.sourceTool === tr.toolName,
			);
			const toolArtifacts = dbArtifacts.filter((a) => a.toolRunId === tr.id);

			const severityCounts = {
				critical: 0,
				high: 0,
				medium: 0,
				low: 0,
				info: 0,
				unknown: 0,
			};

			for (const f of toolFindings) {
				const sev = f.severity.toLowerCase();
				if (sev === "critical") severityCounts.critical++;
				else if (sev === "high") severityCounts.high++;
				else if (sev === "medium") severityCounts.medium++;
				else if (sev === "low") severityCounts.low++;
				else if (sev === "info") severityCounts.info++;
				else severityCounts.unknown++;
			}

			tools.push({
				toolId: tr.toolName,
				toolRunId: tr.id,
				status: tr.status,
				required: false,
				exitCode: tr.exitCode,
				toolVersion: tr.toolVersion,
				findingCount: toolFindings.length,
				severityCounts,
				artifactCount: toolArtifacts.length,
				error: (tr.metadata?.error as string) ?? null,
				metadata: tr.metadata ?? {},
			});
		}
	}

	const metadataProfileOutcome = scanRun.metadata?.profileOutcome;
	const profileResolution = scanProfileResolutionSchema.safeParse(
		scanRun.metadata?.profileResolution,
	);
	const gateDecision =
		scanRun.metadata?.gateEvaluation &&
		typeof scanRun.metadata.gateEvaluation === "object" &&
		["not_requested", "pass", "fail", "blocked"].includes(
			String(
				(scanRun.metadata.gateEvaluation as Record<string, unknown>)
					.gateDecision,
			),
		)
			? ((scanRun.metadata.gateEvaluation as Record<string, unknown>)
					.gateDecision as ScanRunSummary["gateDecision"])
			: undefined;
	const profileOutcome =
		(scanRun.profileOutcome !== "pending" && scanRun.profileOutcome) ||
		(typeof metadataProfileOutcome === "string"
			? metadataProfileOutcome
			: null) ||
		(scanRun.status === "failed" ? "failed" : "completed");
	const steps: StepSummary[] =
		profileSteps.length > 0
			? profileSteps.map((step) => {
					if (step.kind === "dast") {
						const id = `dast:${step.profileId}`;
						const metadataResult = metadataStepResults.find(
							(item) =>
								item.kind === "dast" && item.profileId === step.profileId,
						);
						const dastRun = dbDastRuns.find(
							(run) => run.profileId === step.profileId,
						);
						return {
							kind: "dast",
							id,
							displayName: step.displayName,
							status:
								(metadataResult?.status as string | undefined) ??
								dastRun?.status ??
								"skipped",
							required: step.required,
							findingCount:
								(metadataResult?.findingCount as number | undefined) ??
								dbFindings.filter((finding) =>
									finding.sourceTool.startsWith("dast"),
								).length,
							artifactCount: 0,
							error:
								(metadataResult?.error as string | null | undefined) ??
								dastRun?.errorMessage ??
								null,
							outcome:
								(metadataResult?.outcome as string | null | undefined) ??
								dastRun?.outcome ??
								null,
							verdict:
								(metadataResult?.verdict as string | null | undefined) ??
								dastRun?.verdict ??
								(dastRun ? "unknown_legacy" : null),
							coverageStatus:
								(metadataResult?.coverageStatus as
									| "covered"
									| "partial"
									| "gap"
									| null
									| undefined) ??
								(dastRun?.coverageStatus as
									| "covered"
									| "partial"
									| "gap"
									| null
									| undefined) ??
								(dastRun ? "gap" : null),
							coverageSummary:
								(metadataResult?.coverageSummary as
									| Record<string, unknown>
									| null
									| undefined) ??
								dastRun?.coverageSummary ??
								null,
							limitationCodes:
								(metadataResult?.limitationCodes as string[] | undefined) ??
								dastRun?.limitationCodes ??
								[],
							targetOrigin:
								(metadataResult?.targetOrigin as string | null | undefined) ??
								dastRun?.targetOrigin ??
								null,
						};
					}
					if (step.kind !== "static_tool") {
						const metadataResult = metadataStepResults.find(
							(item) =>
								item.kind === step.kind &&
								item.stepId === `${step.kind}:${step.adapter}`,
						);
						return {
							kind: step.kind,
							id: `${step.kind}:${step.adapter}`,
							displayName: step.displayName,
							status:
								(metadataResult?.status as string | undefined) ?? "skipped",
							required: step.required,
							findingCount:
								(metadataResult?.findingCount as number | undefined) ?? 0,
							artifactCount: Array.isArray(metadataResult?.artifactIds)
								? metadataResult.artifactIds.length
								: 0,
							error:
								(metadataResult?.error as string | null | undefined) ?? null,
							metadata:
								(metadataResult?.metadata as
									| Record<string, unknown>
									| undefined) ?? {},
							reasonCode:
								(metadataResult?.reasonCode as string | null | undefined) ??
								null,
							coverageEffect:
								(metadataResult?.coverageEffect as
									| "covered"
									| "partial"
									| "gap"
									| undefined) ?? undefined,
						};
					}
					const tool = tools.find((item) => item.toolId === step.toolId);
					const metadataResult = metadataStepResults.find(
						(item) =>
							item.kind === "static_tool" && item.toolId === step.toolId,
					);
					return {
						kind: "static_tool",
						id: step.toolId,
						displayName: step.displayName,
						status: tool?.status ?? "skipped",
						required: step.required,
						findingCount: tool?.findingCount ?? 0,
						artifactCount: tool?.artifactCount ?? 0,
						error: tool?.error ?? null,
						metadata: {
							...(tool?.metadata ?? {}),
							...((metadataResult?.metadata as
								| Record<string, unknown>
								| undefined) ?? {}),
						},
						reasonCode:
							typeof metadataResult?.reasonCode === "string"
								? metadataResult.reasonCode
								: null,
						...(metadataResult?.coverageEffect === "covered" ||
						metadataResult?.coverageEffect === "partial" ||
						metadataResult?.coverageEffect === "gap"
							? { coverageEffect: metadataResult.coverageEffect }
							: {}),
					};
				})
			: tools.map((tool) => ({
					kind: "static_tool",
					id: tool.toolId,
					displayName: tool.toolId,
					status: tool.status,
					required: tool.required,
					findingCount: tool.findingCount,
					artifactCount: tool.artifactCount,
					error: tool.error,
					metadata: tool.metadata ?? {},
					reasonCode:
						typeof tool.metadata?.reasonCode === "string"
							? tool.metadata.reasonCode
							: null,
					...(tool.metadata?.coverageEffect === "covered" ||
					tool.metadata?.coverageEffect === "partial" ||
					tool.metadata?.coverageEffect === "gap"
						? { coverageEffect: tool.metadata.coverageEffect }
						: {}),
				}));

	return {
		scanRunId,
		profileId: scanRun.profile,
		...(profileResolution.success
			? {
					canonicalProfileId: profileResolution.data.canonicalProfileId,
					executionProfileId:
						profileResolution.data.executionProfileId ?? undefined,
					resultPolicy: profileResolution.data.resultPolicy,
				}
			: {}),
		...(gateDecision ? { gateDecision } : {}),
		profileOutcome,
		tools,
		steps,
		totals: {
			findingCount: dbFindings.length,
			artifactCount: dbArtifacts.length,
			reviewedFindingCount,
			decidedFindingCount,
		},
	};
}
