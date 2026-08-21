import crypto from "node:crypto";
import type {
	ScanPreflightCheck,
	ScanPreflightResult,
} from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import type { DastTargetStartPlan } from "../../dast/target-preparer";
import { canonicalJson } from "./diff/diff-scan-plan";
import { hashResolvedProfile } from "./resolved-profile";
import type { ScannerDataManifest } from "../tools/scanner-provenance";
import { DEFAULT_DOCKER_IMAGE } from "../tools/tool-process-policy";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";

export type DockerProbe = {
	ready: boolean;
	version: string | null;
	platform: string | null;
	reasonCode: string | null;
};

export type DockerImageProbe = {
	ready: boolean;
	digest: string | null;
	repoDigests?: string[];
	/** Local daemon identity retained as provenance, never used as a registry digest. */
	imageId?: string | null;
	platform: string | null;
	reasonCode: string | null;
};

export function buildScanPreflightBinding(params: {
	profile: ScanProfile;
	execution: ToolExecutionConfig;
	manifest: ScannerDataManifest | null;
	targetPlan: DastTargetStartPlan | null;
	sourceRevision: string | null;
	profileInputs?: Record<string, string | undefined>;
	checks: ScanPreflightCheck[];
}): ScanPreflightResult["binding"] {
	const imageChecks = params.checks
		.filter((item) => item.kind === "docker_image")
		.map((item) => ({
			id: item.id,
			observedDigest: item.observedDigest,
			observedPlatform: item.observedPlatform ?? null,
			status: item.status,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	return {
		resolvedProfileHash: hashResolvedProfile(params.profile),
		executionHash: hashPreflightValue(
			canonicalJson(sanitizedExecution(params.execution)),
		),
		scannerManifestHash: params.manifest?.manifestHash ?? null,
		scannerVersionsHash: hashPreflightValue(
			canonicalJson(
				params.checks
					.filter((item) => item.kind === "binary_version")
					.map((item) => ({
						id: item.id,
						observedVersion: item.observedVersion,
						status: item.status,
					}))
					.sort((left, right) => left.id.localeCompare(right.id)),
			),
		),
		dockerImagesHash:
			imageChecks.length > 0
				? hashPreflightValue(canonicalJson(imageChecks))
				: null,
		targetPlanHash: params.targetPlan
			? hashPreflightValue(
					canonicalJson({
						pluginId: params.targetPlan.pluginId,
						scriptName: params.targetPlan.scriptName,
						script: params.targetPlan.script,
						packageManager: params.targetPlan.packageManager,
						command: params.targetPlan.command,
						env: params.targetPlan.env,
						readinessPaths: params.targetPlan.readinessPaths,
						requiresProjectCodeConsent:
							params.targetPlan.requiresProjectCodeConsent,
					}),
				)
			: null,
		sourceRevisionHash: params.sourceRevision
			? hashPreflightValue(params.sourceRevision)
			: null,
		profileInputsHash: hashProfileInputs(params.profileInputs),
	};
}

export function hashProfileInputs(
	inputs: Record<string, string | undefined> | undefined,
): string | null {
	const normalized = Object.fromEntries(
		Object.entries(inputs ?? {})
			.filter((entry): entry is [string, string] => Boolean(entry[1]))
			.sort(([left], [right]) => left.localeCompare(right)),
	);
	return Object.keys(normalized).length > 0
		? hashPreflightValue(canonicalJson(normalized))
		: null;
}

function sanitizedExecution(execution: ToolExecutionConfig) {
	return execution.runner === "host"
		? { runner: "host" as const, outputLimits: execution.outputLimits }
		: {
				runner: "docker" as const,
				image: execution.docker?.image ?? DEFAULT_DOCKER_IMAGE,
				networkMode: execution.docker?.networkMode ?? "none",
				memory: execution.docker?.memory ?? null,
				cpus: execution.docker?.cpus ?? null,
				pidsLimit: execution.docker?.pidsLimit ?? null,
				outputLimits: execution.outputLimits,
			};
}

export function hashPreflightValue(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function dockerImageIsCompatible(
	image: DockerImageProbe,
	daemon: DockerProbe,
	expectedDigest: string | null = null,
): boolean {
	return (
		image.ready &&
		Boolean(image.platform) &&
		Boolean(daemon.platform) &&
		image.platform === daemon.platform &&
		(expectedDigest === null ||
			(image.repoDigests ?? []).some((digest) =>
				digest.endsWith(`@${expectedDigest}`),
			))
	);
}

export function dockerImageReason(
	image: DockerImageProbe,
	daemon: DockerProbe,
	expectedDigest: string | null = null,
): string | null {
	if (!image.ready) return image.reasonCode;
	if (
		expectedDigest !== null &&
		!(image.repoDigests ?? []).some((digest) =>
			digest.endsWith(`@${expectedDigest}`),
		)
	) {
		return "docker_image_digest_mismatch";
	}
	return dockerImageIsCompatible(image, daemon, expectedDigest)
		? null
		: "docker_image_platform_incompatible";
}

export function dockerImageEvidenceRefs(image: DockerImageProbe): string[] {
	return [
		...(image.digest ? [`docker-image:${image.digest}`] : []),
		...(image.imageId ? [`docker-image-id:${image.imageId}`] : []),
	];
}
