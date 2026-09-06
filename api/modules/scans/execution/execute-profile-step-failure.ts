import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import { RuntimeTargetPreparationError } from "../../runtime-isolation/runtime-failure";
import { ArtifactRepository } from "../repositories";
import type { ToolResult } from "./profile-runner";
import type { ProfileStepExecution } from "./execute-profile-step";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";

export async function failureDelta(
	step: ScanProfileStep,
	stepId: string,
	error: unknown,
	failureFailsProfile: boolean,
	scope: ExecuteProfileStepsParams,
): Promise<ProfileStepExecution | null> {
	const runtimeFailure =
		error instanceof RuntimeTargetPreparationError ? error : null;
	const diagnosticArtifactIds = runtimeFailure?.input.evidence
		? await persistRuntimeDiagnostic(scope, runtimeFailure).catch(() => [])
		: [];
	runtimeFailure?.attachDiagnosticArtifactIds(diagnosticArtifactIds);
	const errorMessage =
		runtimeFailure?.message ??
		(error instanceof Error ? error.message : String(error));
	const reasonCode =
		runtimeFailure?.input.reasonCode ??
		(errorMessage.includes("policy_rejected")
			? "policy_rejected"
			: "execution_failed");
	const flags = {
		optionalToolFailed: !failureFailsProfile,
		profileFailingToolFailed: failureFailsProfile,
	};
	if (
		step.kind === "runtime_scanner" ||
		step.kind === "api_schema_scan" ||
		step.kind === "attestation_verify"
	) {
		return {
			...flags,
			toolResults: [],
			stepResults: [
				{
					kind: step.kind,
					stepId,
					adapter: step.adapter,
					required: step.required,
					status: "failed",
					applicability: "applicable",
					reasonCode,
					coverageEffect: "gap",
					findingCount: 0,
					error: errorMessage,
					artifactIds: diagnosticArtifactIds,
				},
			],
		};
	}
	if (step.kind === "dast") {
		return {
			...flags,
			toolResults: [],
			stepResults: [
				{
					kind: "dast",
					profileId: step.profileId,
					required: step.required,
					status: "failed",
					outcome: "error",
					reasonCode,
					findingCount: 0,
					dastRunId: null,
					targetOrigin: null,
					error: errorMessage,
					artifactIds: diagnosticArtifactIds,
				},
			],
		};
	}
	if (
		step.kind === "static_tool" ||
		step.kind === "sbom_export" ||
		step.kind === "container_image_scan"
	) {
		const toolId = step.kind === "static_tool" ? step.toolId : "trivy";
		const toolResult: ToolResult = {
			toolId,
			toolRunId: null,
			required: step.required,
			status: "failed",
			findingCount: 0,
			exitCode: null,
			error: errorMessage,
			applicability: "applicable",
			reasonCode: "execution_failed",
			coverageEffect: "gap",
			artifactIds: [],
		};
		return {
			...flags,
			toolResults: [toolResult],
			stepResults:
				step.kind === "static_tool"
					? [{ kind: "static_tool", ...toolResult }]
					: [
							{
								kind: step.kind,
								stepId,
								adapter: step.adapter,
								required: step.required,
								status: "failed",
								applicability: "not_applicable",
								reasonCode: errorMessage.includes("image_input_not_provided")
									? "image_input_not_provided"
									: "execution_failed",
								coverageEffect: "gap",
								findingCount: 0,
								error: errorMessage,
								artifactIds: diagnosticArtifactIds,
							},
						],
		};
	}
	return null;
}

async function persistRuntimeDiagnostic(
	scope: ExecuteProfileStepsParams,
	failure: RuntimeTargetPreparationError,
): Promise<string[]> {
	const evidence = failure.input.evidence;
	if (!evidence) return [];
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{
			scanRunId: scope.scanRun.id,
			kind: "scan",
			id: `runtime-${evidence.bundleId}`,
		},
	);
	const artifact = await sink.saveText({
		role: "runtime_diagnostic",
		format: "json",
		content: JSON.stringify(evidence, null, 2),
		metadata: {
			schemaVersion: evidence.schemaVersion,
			reasonCode: failure.input.reasonCode,
			redacted: evidence.redacted,
		},
	});
	return [artifact.id];
}
