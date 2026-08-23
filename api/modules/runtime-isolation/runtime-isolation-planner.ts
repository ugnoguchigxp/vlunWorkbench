import type {
	RuntimeIsolationPlanV1,
	RuntimeDatabaseMode,
	RuntimeDependencyAdapterId,
} from "../../../shared/schemas/runtime-isolation.schema";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import { runtimeIsolationPlanV1Schema } from "../../../shared/schemas/runtime-isolation.schema";
import { runtimeIsolationHash } from "./runtime-isolation-hash";
import { validateAndDigestRuntimeDependencyLock } from "./runtime-dependency-adapter";
import type { RuntimeSourceProjection } from "./runtime-source-projection";
import { resolveRuntimeTargetRecipe } from "./runtime-recipe-resolver";

export type QualifiedRuntimeImages = {
	namespaceOwnerImageDigest: string;
	nodeRuntimeImageDigest: string;
	materializerImageDigest: string;
	registryProxyImageDigest: string;
	probeImageDigest: string;
	httpExecutorImageDigest: string;
	scannerImageDigests: Record<string, string>;
	databaseImageDigests: Partial<
		Record<Exclude<RuntimeDatabaseMode, "none" | "sqlite_ephemeral">, string>
	>;
};

export type RuntimeScannerImageRole = "nuclei" | "zap" | "schemathesis";

export type RuntimeIsolationPlanningResult =
	| { status: "ready"; plan: RuntimeIsolationPlanV1; planHash: string }
	| { status: "blocked"; reasonCode: string };

export async function buildRuntimeIsolationPlan(params: {
	profileId: string;
	projection: RuntimeSourceProjection;
	images: QualifiedRuntimeImages;
	dockerDaemonIdentityHash: string;
	qualificationHash: string;
	requiredScannerImageRoles?: readonly RuntimeScannerImageRole[];
	qualifiedDependencyAdapterIds?: readonly RuntimeDependencyAdapterId[];
	inferTargetPlan: (params: {
		repoPath: string;
		port: number;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
}): Promise<RuntimeIsolationPlanningResult> {
	const recipeResolution = await resolveRuntimeTargetRecipe({
		projectionPath: params.projection.projectPath,
		inferTargetPlan: params.inferTargetPlan,
	});
	if (recipeResolution.status === "blocked") return recipeResolution;
	const adapterId = recipeResolution.recipe.dependencyAdapterId;
	const qualifiedDependencyAdapterIds =
		params.qualifiedDependencyAdapterIds ?? ["npm-package-lock-v1"];
	if (!qualifiedDependencyAdapterIds.includes(adapterId)) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		};
	}
	const lockDigest = await validateAndDigestRuntimeDependencyLock({
		root: params.projection.projectPath,
		adapterId,
	});
	if (!lockDigest) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_lock_unsupported",
		};
	}
	const databaseImageDigest = databaseImageForMode(
		recipeResolution.recipe.database.mode,
		params.images.databaseImageDigests,
	);
	if (databaseImageDigest === undefined) {
		return {
			status: "blocked",
			reasonCode: "runtime_database_provider_unqualified",
		};
	}
	if (
		!hasCompleteImageSet(params.images, params.requiredScannerImageRoles ?? [])
	) {
		return { status: "blocked", reasonCode: "runtime_image_missing" };
	}
	const targetPlan = recipeResolution.targetPlan;
	const expectedExecutable = adapterId === "bun-lock-v1" ? "bun" : "npm";
	if (
		targetPlan.command[0] !== expectedExecutable ||
		targetPlan.command.length < 2
	) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		};
	}
	const startArgs =
		adapterId === "bun-lock-v1"
			? ["--bun", ...targetPlan.command.slice(1)]
			: targetPlan.command.slice(1);
	const plan = runtimeIsolationPlanV1Schema.parse({
		schemaVersion: 1,
		profileId: params.profileId,
		source: {
			sourceSnapshotDigest: asSha256(params.projection.sourceSnapshotDigest),
			runtimeProjectionDigest: asSha256(params.projection.projectionDigest),
			projectionPolicyVersion: 1,
		},
		recipe: {
			recipeHash: recipeResolution.recipeHash,
			startPlannerId: recipeResolution.recipe.startPlannerId,
		},
		dependency: {
			adapterId,
			policyVersion: 1,
			lockDigest,
		},
		images: {
			namespaceOwnerImageDigest: params.images.namespaceOwnerImageDigest,
			nodeRuntimeImageDigest: params.images.nodeRuntimeImageDigest,
			materializerImageDigest: params.images.materializerImageDigest,
			registryProxyImageDigest: params.images.registryProxyImageDigest,
			probeImageDigest: params.images.probeImageDigest,
			httpExecutorImageDigest: params.images.httpExecutorImageDigest,
			databaseImageDigest,
			scannerImageDigests: params.images.scannerImageDigests,
		},
		start: {
			executable: expectedExecutable,
			args: startArgs,
			port: 18080,
			readinessPaths:
				recipeResolution.recipe.readinessPaths ?? targetPlan.readinessPaths,
		},
		database: {
			mode: recipeResolution.recipe.database.mode,
			policyVersion: 1,
			bindings: recipeResolution.recipe.database.environmentBindings,
		},
		environment: { policyVersion: 1 },
		network: { kind: "container_namespace", policyVersion: 1 },
		limits: { policyVersion: 1, targetMemoryMiB: 1024, targetPids: 256 },
		cleanup: { required: true, policyVersion: 1 },
		dockerDaemonIdentityHash: params.dockerDaemonIdentityHash,
		qualificationHash: params.qualificationHash,
	});
	return { status: "ready", plan, planHash: runtimeIsolationHash(plan) };
}

function hasCompleteImageSet(
	images: QualifiedRuntimeImages,
	requiredScannerImageRoles: readonly RuntimeScannerImageRole[],
): boolean {
	const required = [
		images.namespaceOwnerImageDigest,
		images.nodeRuntimeImageDigest,
		images.materializerImageDigest,
		images.registryProxyImageDigest,
		images.probeImageDigest,
		images.httpExecutorImageDigest,
		...requiredScannerImageRoles.map(
			(role) => images.scannerImageDigests[role] ?? "",
		),
		...Object.values(images.scannerImageDigests),
	];
	return required.every((digest) => /^sha256:[a-f0-9]{64}$/.test(digest));
}

function databaseImageForMode(
	mode: RuntimeDatabaseMode,
	images: QualifiedRuntimeImages["databaseImageDigests"],
): string | null | undefined {
	if (mode === "none" || mode === "sqlite_ephemeral") return null;
	return images[mode];
}

function asSha256(value: string): string {
	return value.startsWith("sha256:") ? value : `sha256:${value}`;
}
