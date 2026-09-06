import path from "node:path";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import {
	resolveAttestationInputPaths,
	resolveSlsaProvenanceInputPaths,
} from "../attestation/attestation-inputs";
import {
	COSIGN_TRUSTED_ROOT_CONTAINER_PATH,
	COSIGN_TRUSTED_ROOT_REPOSITORY_PATH,
	CosignAttestationProvider,
	isCosignVersionSafe,
	parseCosignVersion,
} from "../attestation/cosign-attestation-provider";
import {
	parseSlsaVerifierVersion,
	SLSA_VERIFIER_VERSION,
	SlsaProvenanceProvider,
} from "../attestation/slsa-provenance-provider";
import { ArtifactRepository } from "../repositories";
import {
	checkToolVersion,
	getCleanEnv,
	runToolProcess,
} from "../tools/tool-process-runner";
import type { ProfileStepExecution } from "./execute-profile-step";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";

export async function executeAttestationStep(params: {
	step: ScanProfileStep;
	stepId: string;
	failureFailsProfile: boolean;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, scope } = params;
	if (step.kind !== "attestation_verify") {
		throw new Error(`Unsupported profile step: ${stepId}`);
	}
	if (step.adapter === "slsa-verifier") {
		return executeSlsaAttestationStep({ ...params, step });
	}
	if (
		!scope.attestationSubject ||
		!scope.attestationBundle ||
		!scope.trustPolicy
	) {
		throw new Error("attestation_input_missing");
	}
	const observedCosignVersion = await checkToolVersion("cosign", ["version"], {
		execution: scope.execution,
	});
	if (!isCosignVersionSafe(observedCosignVersion)) {
		throw new Error("scanner_version_vulnerable:cosign");
	}
	const preflightCosignVersion = scope.scanPreflight.checks.find(
		(check) =>
			check.stepId === stepId &&
			check.kind === "binary_version" &&
			check.scannerId === "cosign",
	)?.observedVersion;
	if (
		preflightCosignVersion &&
		String(parseCosignVersion(preflightCosignVersion)) !==
			String(parseCosignVersion(observedCosignVersion))
	) {
		throw new Error("scanner_version_mismatch:cosign");
	}
	const paths = await resolveAttestationInputPaths({
		repoPath: scope.profileInputRepoPath,
		subject: scope.attestationSubject,
		bundle: scope.attestationBundle,
		trustPolicy: scope.trustPolicy,
	});
	const provider = new CosignAttestationProvider(
		async ({ binary, args, timeoutSec }) => {
			const result = await runToolProcess(binary, args, {
				execution: scope.execution,
				repoPath: scope.profileInputRepoPath,
				timeoutSec: Math.min(timeoutSec, params.resolvedTimeout),
				env: getCleanEnv(),
			});
			return { ok: result.ok, exitCode: result.exitCode };
		},
	);
	const receipt = await provider.verify({
		...paths,
		trustedRootPath:
			scope.execution.runner === "docker"
				? COSIGN_TRUSTED_ROOT_CONTAINER_PATH
				: path.resolve(process.cwd(), COSIGN_TRUSTED_ROOT_REPOSITORY_PATH),
		timeoutSec: params.resolvedTimeout,
	});
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{ scanRunId: scope.scanRun.id, kind: "scan", id: "attestation" },
	);
	const artifact = await sink.saveText({
		role: "raw_result",
		format: "json",
		content: JSON.stringify(receipt, null, 2),
		metadata: {
			adapter: "cosign",
			offline: true,
			trustedRoot: "pinned-scanner-data",
		},
	});
	const failed = !receipt.verified;
	return {
		toolResults: [],
		stepResults: [
			{
				kind: "attestation_verify",
				stepId,
				adapter: "cosign",
				required: step.required,
				status: failed ? "failed" : "completed",
				applicability: "applicable",
				reasonCode: failed ? "attestation_verification_failed" : null,
				coverageEffect: failed ? "gap" : "covered",
				findingCount: 0,
				error: failed
					? "Cosign could not verify the supplied attestation."
					: null,
				artifactIds: [artifact.id],
				metadata: { receipt },
			},
		],
		profileFailingToolFailed: failed && params.failureFailsProfile,
		optionalToolFailed: failed && !params.failureFailsProfile,
	};
}

async function executeSlsaAttestationStep(params: {
	step: Extract<ScanProfileStep, { kind: "attestation_verify" }>;
	stepId: string;
	failureFailsProfile: boolean;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, scope } = params;
	if (
		step.adapter !== "slsa-verifier" ||
		!scope.attestationSubject ||
		!scope.slsaProvenance ||
		!scope.slsaPolicy
	) {
		throw new Error("attestation_input_missing");
	}
	if (
		scope.execution.runner === "docker" &&
		scope.execution.docker?.networkMode !== "default"
	) {
		throw new Error("slsa_trust_root_network_required");
	}
	const observedVersion = await checkToolVersion("slsa-verifier", ["version"], {
		execution: scope.execution,
	});
	if (parseSlsaVerifierVersion(observedVersion) !== SLSA_VERIFIER_VERSION) {
		throw new Error("scanner_version_mismatch:slsa-verifier");
	}
	const preflightVersion = scope.scanPreflight.checks.find(
		(check) =>
			check.stepId === stepId &&
			check.kind === "binary_version" &&
			check.scannerId === "slsa-verifier",
	)?.observedVersion;
	if (
		preflightVersion &&
		parseSlsaVerifierVersion(preflightVersion) !==
			parseSlsaVerifierVersion(observedVersion)
	) {
		throw new Error("scanner_version_mismatch:slsa-verifier");
	}
	const paths = await resolveSlsaProvenanceInputPaths({
		repoPath: scope.profileInputRepoPath,
		subject: scope.attestationSubject,
		provenance: scope.slsaProvenance,
		policy: scope.slsaPolicy,
	});
	const provider = new SlsaProvenanceProvider(
		async ({ binary, args, timeoutSec }) => {
			const result = await runToolProcess(binary, args, {
				execution: scope.execution,
				repoPath: scope.profileInputRepoPath,
				timeoutSec: Math.min(timeoutSec, params.resolvedTimeout),
				env: getCleanEnv(),
			});
			return { ok: result.ok, exitCode: result.exitCode };
		},
	);
	const receipt = await provider.verify({
		...paths,
		timeoutSec: params.resolvedTimeout,
	});
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{ scanRunId: scope.scanRun.id, kind: "scan", id: "slsa-provenance" },
	);
	const artifact = await sink.saveText({
		role: "raw_result",
		format: "json",
		content: JSON.stringify(receipt, null, 2),
		metadata: {
			adapter: "slsa-verifier",
			offline: false,
			trustRootRefresh: "sigstore-tuf",
		},
	});
	const failed = !receipt.verified;
	return {
		toolResults: [],
		stepResults: [
			{
				kind: "attestation_verify",
				stepId,
				adapter: "slsa-verifier",
				required: step.required,
				status: failed ? "failed" : "completed",
				applicability: "applicable",
				reasonCode: failed ? "attestation_verification_failed" : null,
				coverageEffect: failed ? "gap" : "covered",
				findingCount: 0,
				error: failed
					? "slsa-verifier could not verify the artifact provenance against the supplied policy."
					: null,
				artifactIds: [artifact.id],
				metadata: { receipt },
			},
		],
		profileFailingToolFailed: failed && params.failureFailsProfile,
		optionalToolFailed: failed && !params.failureFailsProfile,
	};
}
