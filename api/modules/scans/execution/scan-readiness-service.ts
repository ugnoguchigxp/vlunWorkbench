import { createHash } from "node:crypto";
import { isCompleteScanLaunchInput } from "../../../../shared/schemas/scan-launch.schema";
import type {
	CanonicalProfileId,
	ScanReadinessStatus,
} from "../../../../shared/schemas/scan-profile-definition.schema";
import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import {
	type OptionalScannerSelection,
	optionalScannerSelection,
} from "../optional-scanner-adapter-config";
import { getCatalogEntry, hashCatalogEntry } from "../profile-catalog";
import { getScanProfileDefinition } from "../profile-definitions";
import {
	dependencyRequirementsFor,
	probeDependency,
} from "./dependency-registry";
import { canonicalJson } from "./diff/diff-scan-plan";

export type ScanReadinessPreview = {
	profileId: CanonicalProfileId;
	variantId: string | null;
	readiness: ScanReadinessStatus;
	reasonCodes: string[];
	warningCodes: string[];
	catalogEntryHash: string;
	readinessHash: string;
	planHash: string | null;
};

function hash(value: unknown) {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(value))
		.digest("hex")}`;
}

function variantFor(params: {
	profileId: CanonicalProfileId;
	input: Record<string, unknown>;
}) {
	const definition = getScanProfileDefinition(params.profileId);
	if (definition.variants.length === 1) return definition.variants[0] ?? null;
	if (params.profileId === "release-artifact") {
		return (
			definition.variants.find((variant) =>
				params.input.kind === "container_image_ref"
					? variant.id === "container-image-ref"
					: params.input.kind === "container_image_tar"
						? variant.id === "container-image-tar"
						: variant.id === "filesystem-artifact",
			) ?? null
		);
	}
	if (params.profileId === "dependency-supply-chain") {
		return (
			definition.variants.find((variant) =>
				params.input.kind === "slsa_provenance"
					? variant.id === "slsa-provenance"
					: variant.id === "offline-attestation",
			) ?? null
		);
	}
	if (params.profileId === "sanitizer-fuzz-lab") {
		return (
			definition.variants.find(
				(variant) =>
					variant.id ===
					(params.input.dynamicKind === "fuzz" ? "fuzz" : "sanitizer"),
			) ?? null
		);
	}
	if (params.profileId === "active-technical-lab") {
		const request = params.input.request as { kind?: string } | undefined;
		const id =
			request?.kind === "authorization_matrix"
				? "authorization-matrix"
				: request?.kind === "zap_active"
					? "zap-active"
					: "transaction";
		return definition.variants.find((variant) => variant.id === id) ?? null;
	}
	return definition.variants[0] ?? null;
}

/**
 * Admission evaluation using the caller's current runtime settings. Image
 * probes never pull, build, or start images. Docker Desktop may require a
 * transient create/remove pair to leave Resource Saver mode.
 */
export async function evaluateScanReadiness(params: {
	profileId: CanonicalProfileId;
	target: ScanTarget;
	input: Record<string, unknown>;
	settings?: Record<string, string | undefined>;
	runDependencyProbe?: Parameters<typeof probeDependency>[0]["run"];
	workspacePath?: string;
	mavenProjectDetected?: boolean;
	optionalScannerSelections?: Partial<
		Record<"semgrep", OptionalScannerSelection>
	>;
}): Promise<ScanReadinessPreview> {
	const catalog = getCatalogEntry(params.profileId);
	const definition = getScanProfileDefinition(params.profileId);
	if (!catalog) throw new Error(`profile_catalog_missing:${params.profileId}`);
	const catalogEntryHash = hashCatalogEntry(catalog);
	const semgrepSelection =
		params.optionalScannerSelections?.semgrep ??
		optionalScannerSelection("semgrep");
	const reasons: string[] = [];
	const warnings: string[] = [];
	let readiness: ScanReadinessStatus = "ready";
	if (
		catalog.availability === "planned" ||
		catalog.launchMode === "unavailable"
	) {
		readiness = "unavailable";
		reasons.push("profile_unavailable");
	} else if (!catalog.supportedTargets.includes(params.target.kind)) {
		readiness = "not_applicable";
		reasons.push("profile_target_not_supported");
	} else if (!isCompleteScanLaunchInput(params.profileId, params.input)) {
		readiness = "needs_input";
		reasons.push("profile_input_missing");
	}
	const variant = variantFor(params);
	const selectedStepIds = (variant?.stepIds ?? []).filter(
		(stepId) => stepId !== "source:semgrep" || semgrepSelection !== "disabled",
	);
	if (readiness === "ready" && !variant) {
		readiness = "needs_input";
		reasons.push("profile_variant_missing");
	}
	if (readiness === "ready") {
		const selectedDependencyIds = [
			...new Set([
				...(variant?.dependencyIds ?? definition.dependencyIds),
				...(isMavenRegistryResolution(params.input) &&
				params.mavenProjectDetected !== false
					? ["resolver.maven"]
					: []),
			]),
		];
		const dependencyRequirements = new Map(
			dependencyRequirementsFor(selectedDependencyIds).map((entry) => [
				entry.id,
				entry.requirement,
			]),
		);
		const applicableDependencyIds = selectedDependencyIds.filter(
			(id) => id !== "scanner.semgrep" || semgrepSelection !== "disabled",
		);
		const probeResults = await Promise.all(
			applicableDependencyIds.map((id) =>
				probeDependency({
					id,
					settings: params.settings,
					run: params.runDependencyProbe,
					workspacePath: params.workspacePath,
				}),
			),
		);
		const failed = probeResults.filter(
			(result) =>
				!result.ready &&
				(dependencyRequirements.get(result.id) === "required" ||
					(result.id === "scanner.semgrep" && semgrepSelection === "required")),
		);
		const nonBlockingFailed = probeResults.filter(
			(result) => !result.ready && !failed.includes(result),
		);
		warnings.push(
			...nonBlockingFailed.map((result) =>
				result.id === "scanner.semgrep"
					? "optional_scanner_unavailable:semgrep"
					: `dependency_unavailable:${result.id}`,
			),
		);
		if (failed.length > 0) {
			readiness = "blocked_environment";
			reasons.push(
				...failed.map(
					(result) => result.reasonCode ?? "dependency_unavailable",
				),
			);
		}
	}
	const binding = {
		profileId: params.profileId,
		target: params.target,
		input: params.input,
		optionalScannerSelections: { semgrep: semgrepSelection },
		catalogEntryHash,
		variantId: variant?.id ?? null,
		readiness,
		reasons: [...new Set(reasons)].sort(),
		warnings: [...new Set(warnings)].sort(),
	};
	const readinessHash = hash(binding);
	return {
		profileId: params.profileId,
		variantId: variant?.id ?? null,
		readiness,
		reasonCodes: binding.reasons,
		warningCodes: binding.warnings,
		catalogEntryHash,
		readinessHash,
		planHash:
			readiness === "ready"
				? hash({ ...binding, stepIds: selectedStepIds })
				: null,
	};
}

function isMavenRegistryResolution(input: Record<string, unknown>): boolean {
	const resolution = input.dependencyResolution;
	return (
		resolution !== null &&
		typeof resolution === "object" &&
		"mode" in resolution &&
		resolution.mode === "registry"
	);
}
