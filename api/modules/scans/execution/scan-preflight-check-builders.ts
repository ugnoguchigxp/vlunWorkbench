import type { ScanPreflightCheck } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import type { ScannerDataManifest } from "../tools/scanner-provenance";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import type { ScanPreflightDependencies } from "./scan-preflight";

const ANSI_ESCAPE_SEQUENCE = new RegExp(
	`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
	"g",
);

export async function addScannerChecks(params: {
	checks: ScanPreflightCheck[];
	stepId: string;
	required: boolean;
	scannerId: string;
	execution: ToolExecutionConfig;
	manifest: ScannerDataManifest | null;
	manifestFailure: string | null;
	dependencies: ScanPreflightDependencies;
}) {
	const entry = params.manifest?.tools[params.scannerId];
	const dataReady = Boolean(entry && entry.state === "ready");
	let reasonCode = params.manifestFailure;
	if (!reasonCode && !entry) reasonCode = "scanner_data_entry_missing";
	if (!reasonCode && entry?.state === "missing")
		reasonCode = "scanner_data_missing";
	if (!reasonCode && entry?.state === "stale")
		reasonCode = "scanner_data_stale";
	params.checks.push(
		buildPreflightCheck({
			id: `${params.stepId}:scanner-data`,
			stepId: params.stepId,
			kind: "scanner_data",
			required: params.required,
			ready: dataReady,
			reasonCode,
			action: "prepare_scanner_database",
			scannerId: params.scannerId,
			expectedVersion: entry?.version ?? null,
			expectedDigest: entry?.digest ?? null,
			observedDigest: dataReady ? (entry?.digest ?? null) : null,
			dataState: entry?.state ?? null,
			dataGeneratedAt: entry?.generatedAt ?? null,
			evidenceRefs: params.manifest
				? [`scanner-manifest:${params.manifest.manifestHash}`]
				: [],
		}),
	);
	// Docker preflight is intentionally process-free. Image identity and
	// platform were already inspected; binary identity is verified immediately
	// before the real scanner invocation.
	if (params.execution.runner === "docker") return;
	const version = await params.dependencies.probeScannerVersion(
		params.scannerId,
		params.execution,
	);
	params.checks.push(
		buildVersionCheck(
			params.stepId,
			params.required,
			params.scannerId,
			version,
			entry?.version ?? null,
		),
	);
}

export function buildPreflightCheck(params: {
	id: string;
	stepId: string;
	kind: ScanPreflightCheck["kind"];
	required: boolean;
	ready: boolean;
	reasonCode?: string | null;
	action: ScanPreflightCheck["action"];
	scannerId?: string | null;
	observedVersion?: string | null;
	expectedVersion?: string | null;
	expectedDigest?: string | null;
	observedDigest?: string | null;
	expectedPlatform?: string | null;
	observedPlatform?: string | null;
	dataState?: ScanPreflightCheck["dataState"];
	dataGeneratedAt?: string | null;
	evidenceRefs?: string[];
}): ScanPreflightCheck {
	return {
		id: params.id,
		stepId: params.stepId,
		kind: params.kind,
		required: params.required,
		status: params.ready ? "ready" : "blocked",
		reasonCode: params.ready ? null : (params.reasonCode ?? "preflight_failed"),
		action: params.ready ? null : params.action,
		scannerId: params.scannerId ?? null,
		observedVersion: sanitizeVersion(params.observedVersion),
		expectedVersion: params.expectedVersion ?? null,
		expectedDigest: params.expectedDigest ?? null,
		observedDigest: params.observedDigest ?? null,
		expectedPlatform: params.expectedPlatform ?? null,
		observedPlatform: params.observedPlatform ?? null,
		dataState: params.dataState ?? null,
		dataGeneratedAt: params.dataGeneratedAt ?? null,
		evidenceRefs: params.evidenceRefs ?? [],
	};
}

export function digestFromImageRef(image: string): string | null {
	const match = image.match(/(?:^|@)(sha256:[a-f0-9]{64})$/);
	return match?.[1] ?? null;
}

export function scanStepId(step: ScanProfileStep): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? `dast:${step.profileId}`
			: `${step.kind}:${step.adapter}`;
}

export function stepNeedsTargetPlan(step: ScanProfileStep): boolean {
	return (
		step.kind === "dast" ||
		step.kind === "runtime_scanner" ||
		step.kind === "api_schema_scan"
	);
}

export function buildVersionCheck(
	stepId: string,
	required: boolean,
	scannerId: string,
	version: string | null,
	expectedVersion: string | null,
): ScanPreflightCheck {
	const observedNormalized = version ? normalizedVersion(version) : null;
	const expectedNormalized = expectedVersion
		? normalizedVersion(expectedVersion)
		: null;
	return buildPreflightCheck({
		id: `${stepId}:binary-version`,
		stepId,
		kind: "binary_version",
		required,
		ready:
			Boolean(version) &&
			(expectedVersion === null || observedNormalized === expectedNormalized),
		reasonCode: !version
			? "scanner_binary_unavailable"
			: expectedVersion !== null && observedNormalized !== expectedNormalized
				? "scanner_version_mismatch"
				: null,
		action: "build_toolbox_image",
		scannerId,
		observedVersion: version,
		expectedVersion,
		evidenceRefs: version ? [`scanner-version:${scannerId}`] : [],
	});
}

function sanitizeVersion(value: string | null | undefined): string | null {
	if (!value) return null;
	return (
		value
			.replace(/[\r\n\0]+/g, " ")
			.trim()
			.slice(0, 200) || null
	);
}

function normalizedVersion(value: string): string | null {
	const plain = value.replace(ANSI_ESCAPE_SEQUENCE, " ");
	return (
		plain.match(
			/(?:^|[^0-9a-z])v?(\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?)(?![0-9a-z.])/i,
		)?.[1] ?? null
	);
}
