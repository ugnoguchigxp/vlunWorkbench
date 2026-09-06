import { parseArgs } from "node:util";
import type { ScanTarget } from "../../shared/schemas/scan-target.schema";
import { resolveDefaultCatalogProfileId } from "../modules/scans/profile-catalog";
import {
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveProfileSelection,
} from "../modules/scans/profile-resolution";
import type {
	DockerNetworkMode,
	ToolRunnerKind,
} from "../modules/scans/tools/tool-process-runner";
import { executeResolvedScanProfile } from "./scan-profile-execution";
import { buildScanProfileDryRun } from "./scan-profile-dry-run";
import { parseScanTargetOption } from "./scan-profile-options";

const MAX_SCAN_STEP_TIMEOUT_SEC = 86_400;

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
	if (value === undefined) return defaultValue;
	return value !== "false";
}

function parseScanProfileArgs() {
	return parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-id": { type: "string" },
			"scan-run-id": { type: "string" },
			"execution-surface": { type: "string" },
			"project-path": { type: "string" },
			"workspace-target-grant-ref": { type: "string" },
			"create-project": { type: "string", default: "false" },
			profile: { type: "string" },
			target: { type: "string", default: "full" },
			base: { type: "string" },
			head: { type: "string" },
			"include-untracked": { type: "string" },
			"expected-target-digest": { type: "string" },
			"expected-preflight-binding-hash": { type: "string" },
			"expected-plan-hash": { type: "string" },
			"expected-catalog-entry-hash": { type: "string" },
			"result-policy": { type: "string" },
			"allow-experimental": { type: "string", default: "false" },
			preview: { type: "string", default: "false" },
			step: { type: "string" },
			"timeout-sec": { type: "string" },
			"continue-on-tool-failure": { type: "string", default: "true" },
			"consent-project-code-execution": {
				type: "string",
				default: "false",
			},
			"output-summary": { type: "string" },
			"dry-run": { type: "string", default: "false" },
			"final-report": { type: "string", default: "true" },
			"automated-diagnostic": { type: "string", default: "true" },
			"report-title": { type: "string" },
			"report-output": { type: "string" },
			runner: { type: "string" },
			"docker-bin": { type: "string" },
			"docker-image": { type: "string" },
			network: { type: "string", default: "none" },
			memory: { type: "string" },
			cpus: { type: "string" },
			"tool-cache-dir": { type: "string" },
			"dependency-resolution": { type: "string", default: "offline" },
			"image-ref": { type: "string" },
			"image-tar": { type: "string" },
			"attestation-subject": { type: "string" },
			"attestation-bundle": { type: "string" },
			"trust-policy": { type: "string" },
			"slsa-provenance": { type: "string" },
			"slsa-policy": { type: "string" },
			"auth-context-id": { type: "string" },
			"identity-role": { type: "string" },
			json: { type: "boolean", default: false },
		},
		strict: true,
	}).values;
}

async function main() {
	let argsValues: ReturnType<typeof parseScanProfileArgs>;
	try {
		argsValues = parseScanProfileArgs();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${message}`,
		});
		process.exit(1);
	}

	const projectId = argsValues["project-id"];
	const scanRunId = argsValues["scan-run-id"];
	const executionSurface = argsValues["execution-surface"] ?? "cli";
	const projectPath = argsValues["project-path"];
	const workspaceTargetGrantRef = argsValues["workspace-target-grant-ref"];
	const createProject = parseBooleanFlag(argsValues["create-project"], false);
	let scanTarget: ScanTarget;
	try {
		scanTarget = parseScanTargetOption(argsValues);
	} catch (error) {
		writeResult({
			ok: false,
			status: "config_error",
			message: error instanceof Error ? error.message : String(error),
		});
		process.exit(2);
	}
	const profileId =
		argsValues.profile ?? resolveDefaultCatalogProfileId(scanTarget.kind);
	const expectedTargetDigest = argsValues["expected-target-digest"] as
		| string
		| undefined;
	if (expectedTargetDigest && !/^[0-9a-f]{64}$/i.test(expectedTargetDigest)) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-target-digest must be a 64-character SHA-256.",
		});
		process.exit(2);
	}
	const expectedPreflightBindingHash = argsValues[
		"expected-preflight-binding-hash"
	] as string | undefined;
	if (
		expectedPreflightBindingHash &&
		!/^sha256:[0-9a-f]{64}$/.test(expectedPreflightBindingHash)
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-preflight-binding-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const expectedPlanHash = argsValues["expected-plan-hash"] as
		| string
		| undefined;
	if (expectedPlanHash && !/^sha256:[0-9a-f]{64}$/.test(expectedPlanHash)) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-plan-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const expectedCatalogEntryHash = argsValues["expected-catalog-entry-hash"] as
		| string
		| undefined;
	if (
		expectedCatalogEntryHash &&
		!/^sha256:[0-9a-f]{64}$/.test(expectedCatalogEntryHash)
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-catalog-entry-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const resultPolicy = argsValues["result-policy"] as
		| "advisory"
		| "gate"
		| undefined;
	if (
		resultPolicy !== undefined &&
		resultPolicy !== "advisory" &&
		resultPolicy !== "gate"
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--result-policy must be advisory or gate.",
		});
		process.exit(2);
	}
	const allowExperimental = argsValues["allow-experimental"] === "true";
	const preview = argsValues.preview === "true";
	const stepId = argsValues.step;
	const timeoutSecStr = argsValues["timeout-sec"];
	const continueOnToolFailure =
		argsValues["continue-on-tool-failure"] !== "false";
	const consentProjectCodeExecution =
		argsValues["consent-project-code-execution"] === "true";
	const outputSummaryPath = argsValues["output-summary"];
	const dryRun = argsValues["dry-run"] === "true";
	const finalReportEnabled = parseBooleanFlag(argsValues["final-report"], true);
	const automatedDiagnosticEnabled = parseBooleanFlag(
		argsValues["automated-diagnostic"],
		true,
	);
	const reportTitle = argsValues["report-title"];
	const reportOutputPath = argsValues["report-output"];
	const imageRef = argsValues["image-ref"];
	const imageTar = argsValues["image-tar"];
	const attestationSubject = argsValues["attestation-subject"];
	const attestationBundle = argsValues["attestation-bundle"];
	const trustPolicy = argsValues["trust-policy"];
	const slsaProvenance = argsValues["slsa-provenance"];
	const slsaPolicy = argsValues["slsa-policy"];
	const authContextId = argsValues["auth-context-id"];
	const identityRole = argsValues["identity-role"];
	const dependencyResolutionMode = argsValues["dependency-resolution"] as
		| "offline"
		| "registry";
	if (
		dependencyResolutionMode !== "offline" &&
		dependencyResolutionMode !== "registry"
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--dependency-resolution must be offline or registry.",
		});
		process.exit(2);
	}
	if (Boolean(authContextId) !== Boolean(identityRole)) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				"--auth-context-id and --identity-role must be provided together.",
		});
		process.exit(2);
	}
	if (imageRef && imageTar) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Use only one of --image-ref or --image-tar.",
		});
		process.exit(2);
	}
	const runner = argsValues.runner as ToolRunnerKind | undefined;
	const networkMode = argsValues.network as DockerNetworkMode;

	if (runner !== undefined && runner !== "host" && runner !== "docker") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--runner must be host or docker.",
		});
		process.exit(1);
	}
	if (networkMode !== "none" && networkMode !== "default") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--network must be none or default.",
		});
		process.exit(1);
	}

	if (executionSurface !== "cli" && executionSurface !== "web") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--execution-surface must be cli or web.",
		});
		process.exit(2);
	}

	let selection: ReturnType<typeof resolveProfileSelection>;
	try {
		selection = resolveProfileSelection({
			requestedProfileId: profileId,
			surface: executionSurface,
			target: scanTarget,
			providedInputKinds: normalizeProfileResolutionInput({
				repoPath: projectPath ?? "project-id",
				imageRef,
				imageTar,
				attestationSubject,
				attestationBundle,
				trustPolicy,
				slsaProvenance,
				slsaPolicy,
				authContextRef: authContextId,
				executionConsent: consentProjectCodeExecution,
			}),
			requestedResultPolicy: resultPolicy,
			allowExperimental,
		});
	} catch (error) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				error instanceof ProfileResolutionError
					? `${error.code}: ${error.message}`
					: error instanceof Error
						? error.message
						: String(error),
		});
		process.exit(2);
	}
	const profile = selection.executionProfile;

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0 ||
			timeoutSec > MAX_SCAN_STEP_TIMEOUT_SEC)
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: `--timeout-sec must be an integer between 1 and ${MAX_SCAN_STEP_TIMEOUT_SEC}.`,
		});
		process.exit(1);
	}

	if (dryRun && !projectId && !projectPath) {
		const dryRunResult = buildScanProfileDryRun({
			profile,
			scanTarget,
			stepId,
			timeoutSec,
			runner,
			finalReportEnabled,
			automatedDiagnosticEnabled,
			imageRef,
			imageTar,
			expectedPreflightBindingHash,
			expectedPlanHash,
			expectedCatalogEntryHash,
			profileResolution: selection.resolution,
		});
		writeResult(dryRunResult);
		process.exit(dryRunResult.ok === false ? 1 : 0);
	}

	if (!projectId && !projectPath) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				"Missing required argument: --project-path is required unless --project-id is provided.",
			error: {
				code: "PROJECT_INPUT_REQUIRED",
				message:
					"Missing required argument: --project-path is required unless --project-id is provided.",
			},
		});
		process.exit(2);
	}

	await executeResolvedScanProfile({
		projectId,
		scanRunId,
		executionSurface,
		projectPath,
		workspaceTargetGrantRef,
		createProject,
		scanTarget,
		profileId,
		expectedTargetDigest,
		expectedPreflightBindingHash,
		expectedPlanHash,
		expectedCatalogEntryHash,
		resultPolicy,
		allowExperimental,
		preview,
		stepId,
		timeoutSec,
		continueOnToolFailure,
		consentProjectCodeExecution,
		outputSummaryPath,
		dryRun,
		finalReportEnabled,
		automatedDiagnosticEnabled,
		reportTitle,
		reportOutputPath,
		imageRef,
		imageTar,
		attestationSubject,
		attestationBundle,
		trustPolicy,
		slsaProvenance,
		slsaPolicy,
		authContextId,
		identityRole,
		dependencyResolutionMode,
		runner,
		networkMode,
		profile,
		profileResolution: selection.resolution,
		dockerBin: argsValues["docker-bin"],
		dockerImage: argsValues["docker-image"],
		dockerMemory: argsValues.memory,
		dockerCpus: argsValues.cpus,
		toolCacheDir: argsValues["tool-cache-dir"],
	});
}

void main();
