import { createHash } from "node:crypto";
import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import type {
	CanonicalProfileId,
	ScanReadinessStatus,
} from "../../../../shared/schemas/scan-profile-definition.schema";
import { getCatalogEntry, hashCatalogEntry } from "../profile-catalog";
import { getScanProfileDefinition } from "../profile-definitions";
import { probeDependency } from "./dependency-registry";
import { canonicalJson } from "./diff/diff-scan-plan";

export type ScanReadinessPreview = {
	profileId: CanonicalProfileId;
	variantId: string | null;
	readiness: ScanReadinessStatus;
	reasonCodes: string[];
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
	if (params.profileId === "sanitizer-fuzz-lab") {
		return (
			definition.variants.find(
				(variant) =>
					variant.id ===
					(params.input.dynamicKind === "fuzz" ? "fuzz" : "sanitizer"),
			) ?? null
		);
	}
	if (params.profileId === "api-readonly") {
		const source = params.input.schemaSource as { mode?: string } | undefined;
		return (
			definition.variants.find(
				(variant) =>
					variant.id ===
					(source?.mode === "configured" ? "configured-schema" : "auto-schema"),
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
 * Read-only admission evaluation. The caller supplies current runtime settings;
 * image probes never pull or build resources.
 */
export async function evaluateScanReadiness(params: {
	profileId: CanonicalProfileId;
	target: ScanTarget;
	input: Record<string, unknown>;
	settings?: Record<string, string | undefined>;
	runDependencyProbe?: Parameters<typeof probeDependency>[0]["run"];
}): Promise<ScanReadinessPreview> {
	const catalog = getCatalogEntry(params.profileId);
	const definition = getScanProfileDefinition(params.profileId);
	if (!catalog) throw new Error(`profile_catalog_missing:${params.profileId}`);
	const catalogEntryHash = hashCatalogEntry(catalog);
	const reasons: string[] = [];
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
	} else if (!params.input.kind) {
		readiness = "needs_input";
		reasons.push("profile_input_missing");
	}
	const variant = variantFor(params);
	if (readiness === "ready" && !variant) {
		readiness = "needs_input";
		reasons.push("profile_variant_missing");
	}
	if (readiness === "ready") {
		const probeResults = await Promise.all(
			definition.dependencyIds.map((id) =>
				probeDependency({
					id,
					settings: params.settings,
					run: params.runDependencyProbe,
				}),
			),
		);
		const failed = probeResults.filter((result) => !result.ready);
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
		catalogEntryHash,
		variantId: variant?.id ?? null,
		readiness,
		reasons: [...new Set(reasons)].sort(),
	};
	const readinessHash = hash(binding);
	return {
		profileId: params.profileId,
		variantId: variant?.id ?? null,
		readiness,
		reasonCodes: binding.reasons,
		catalogEntryHash,
		readinessHash,
		planHash:
			readiness === "ready"
				? hash({ ...binding, stepIds: variant?.stepIds })
				: null,
	};
}
