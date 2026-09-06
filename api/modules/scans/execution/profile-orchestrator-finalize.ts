import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import type {
	ScanProfileCatalogEntry,
	ScanProfileResolution,
} from "../../../../shared/schemas/scan-profile-catalog.schema";
import {
	type analyzeProjectCapabilities,
	buildPluginExecutionSummary,
} from "../../project-capabilities/plugin-detector";
import { buildCoverageLedger } from "../coverage/coverage-ledger";
import { aggregateRuntimeAssessmentCoverage } from "../coverage/runtime-assessment-coverage";
import { resolveSourceSastApplicability } from "../coverage/source-sast-applicability";
import { resolveSourceSastCoverage } from "../coverage/source-sast-coverage";
import { FindingRepository } from "../finding-repository";
import type { ScanRepository } from "../repositories";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import type { resolveScanScope } from "../target-scope";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import type { DiffScanPlan } from "./diff/diff-scan-plan";
import { normalizeProfileStepResult } from "./normalized-step-result";
import type { ProfileOrchestratorParams } from "./profile-orchestrator";
import type { ScanProfileStepResult, ToolResult } from "./profile-runner";
import type { buildScanExecutionPlan } from "./scan-execution-plan-builder";
import { evaluateScanGate } from "./scan-result-policy";

export async function finalizeProfileScan(input: {
	params: ProfileOrchestratorParams;
	scanRepo: ScanRepository;
	scanRun: NonNullable<Awaited<ReturnType<ScanRepository["findById"]>>>;
	technologyAnalysis: Awaited<ReturnType<typeof analyzeProjectCapabilities>>;
	profile: ScanProfile;
	executionPlan: ReturnType<typeof buildScanExecutionPlan>;
	scanPreflight: ScanPreflightResult;
	resolution: ScanProfileResolution;
	catalogEntry: ScanProfileCatalogEntry;
	resolvedProfileHash: string;
	resolvedScope: Awaited<ReturnType<typeof resolveScanScope>>;
	continueOnToolFailure: boolean;
	execution: ToolExecutionConfig;
	stepOrder: string[];
	diffPlan: DiffScanPlan | null;
	diffManifestArtifactId: string | null;
	executionProfileId: string;
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
	profileFailingToolFailed: boolean;
	optionalToolFailed: boolean;
}) {
	const {
		params,
		scanRepo,
		scanRun,
		technologyAnalysis,
		profile,
		executionPlan,
		scanPreflight,
		resolution,
		catalogEntry,
		resolvedProfileHash,
		resolvedScope,
		continueOnToolFailure,
		execution,
		stepOrder,
		diffPlan,
		diffManifestArtifactId,
		executionProfileId,
		toolResults,
		stepResults,
		profileFailingToolFailed,
		optionalToolFailed,
	} = input;
	// Determine profile outcome
	const runtimeAssessmentCoverage =
		aggregateRuntimeAssessmentCoverage(stepResults);
	const runtimeCoverageLimited = runtimeAssessmentCoverage.steps.some(
		(step) =>
			step.applicability === "applicable" && step.coverageEffect !== "covered",
	);
	const semgrepCapability = technologyAnalysis.capabilityPlan.steps.find(
		(step) => step.stepId === "semgrep",
	);
	const sourceSastApplicability = resolveSourceSastApplicability({
		hasSourceFiles: technologyAnalysis.capabilityPlan.languages.length > 0,
		hasSupportedLanguage:
			technologyAnalysis.capabilityPlan.languages.length > 0,
		rulesetAvailable: Boolean(semgrepCapability?.pluginIds.length),
		adapterAvailable: staticScannerAdapterRegistry.has("semgrep"),
	});
	const sourceSastCoverage = resolveSourceSastCoverage(
		profile,
		stepResults,
		sourceSastApplicability,
	);
	const sourceSastLimited = sourceSastCoverage?.coverageEffect === "gap";
	const coverageLedger = buildCoverageLedger({
		profile,
		planHash: executionPlan.planHash,
		plannedSteps: executionPlan.steps,
		derivedAt: new Date().toISOString(),
		stepResults,
	});
	const normalizedStepResults = stepResults.map(normalizeProfileStepResult);
	const ledgerLimited = Boolean(
		coverageLedger?.entries.some((entry) => entry.coverageEffect !== "covered"),
	);
	const profileLimitationCodes = [
		...new Set([
			...(profile.coverageGaps ?? []),
			...(coverageLedger?.entries.flatMap((entry) => entry.reasonCodes) ?? []),
			...(sourceSastCoverage?.limitationCodes ?? []),
			...scanPreflight.limitationCodes,
		]),
	].sort();
	let profileOutcome: "completed" | "completed_with_warnings" | "failed" =
		"completed";
	let finalScanStatus: "completed" | "failed" = "completed";

	if (profileFailingToolFailed) {
		// A fail_profile tool failed, so the overall outcome is failed.
		profileOutcome = "failed";
		finalScanStatus = "failed";
	} else if (
		optionalToolFailed ||
		runtimeCoverageLimited ||
		sourceSastLimited ||
		ledgerLimited
	) {
		// required tools succeeded, but at least one optional tool failed
		profileOutcome = "completed_with_warnings";
		finalScanStatus = "completed";
	} else {
		// all succeeded
		profileOutcome = "completed";
		finalScanStatus = "completed";
	}

	// Update Scan Run status
	const totalFindings = stepResults.reduce((acc, r) => acc + r.findingCount, 0);
	const summaryMsg =
		profileOutcome === "failed"
			? `Scan profile ${params.profileId} failed due to profile-failing tool failure.`
			: `Scan profile ${params.profileId} completed with outcome: ${profileOutcome}. Found ${totalFindings} findings total.`;
	const pluginExecutionSummary = buildPluginExecutionSummary({
		detections: technologyAnalysis.detections,
		capabilityPlan: technologyAnalysis.capabilityPlan,
		stepResults,
	});
	const gateEvaluation = evaluateScanGate({
		resultPolicy: resolution.resultPolicy,
		gateThreshold: resolution.gateSeverityThreshold,
		profileOutcome,
		findings: await new FindingRepository(params.db).listFindings(scanRun.id),
	});

	await scanRepo.updateScanRunStatus(scanRun.id, finalScanStatus, {
		summary: summaryMsg,
		profileOutcome,
		metadata: {
			...scanRun.metadata,
			profileId: params.profileId,
			canonicalProfileId: resolution.canonicalProfileId,
			executionProfileId: resolution.executionProfileId,
			profileResolution: resolution,
			catalogEntry,
			profileVersion: 1,
			resolvedProfile: profile,
			resolvedProfileHash,
			profileLimitationCodes,
			...(sourceSastCoverage ? { sourceSastCoverage } : {}),
			...(coverageLedger ? { coverageLedger } : {}),
			normalizedStepResults,
			scope: resolvedScope,
			profileOutcome,
			gateEvaluation,
			continueOnToolFailure,
			runner: execution.runner,
			toolOrder: profile.tools.map((t) => t.toolId),
			stepOrder,
			toolResults,
			stepResults,
			runtimeAssessmentCoverage,
			technologyPlugins: pluginExecutionSummary,
			...(diffPlan
				? {
						target: diffPlan.target,
						diffCoverage: diffPlan.manifest.coverage,
						diffToolApplicability: diffPlan.tools,
						diffManifestArtifactId,
					}
				: {}),
		},
	});

	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level:
			profileOutcome === "failed"
				? "error"
				: gateEvaluation.gateDecision === "fail"
					? "warn"
					: "info",
		eventType: profileOutcome === "failed" ? "scan.failed" : "scan.completed",
		message: summaryMsg,
		data: { gateEvaluation },
	});

	const ok =
		profileOutcome !== "failed" &&
		gateEvaluation.gateDecision !== "fail" &&
		gateEvaluation.gateDecision !== "blocked";
	const message = summaryMsg;

	return {
		ok,
		scanRunId: scanRun.id,
		profileId: params.profileId,
		canonicalProfileId: resolution.canonicalProfileId,
		executionProfileId,
		resultPolicy: resolution.resultPolicy,
		gateDecision: gateEvaluation.gateDecision,
		status: finalScanStatus,
		profileOutcome,
		runner: execution.runner,
		message,
		toolResults,
		stepResults,
	};
}
