import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	RuntimeIsolationPlanV1,
	RuntimeDatabaseMode,
} from "../../../shared/schemas/runtime-isolation.schema";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import { runtimeIsolationPlanV1Schema } from "../../../shared/schemas/runtime-isolation.schema";
import { runtimeIsolationHash } from "./runtime-isolation-hash";
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

export type RuntimeIsolationPlanningResult =
	| { status: "ready"; plan: RuntimeIsolationPlanV1; planHash: string }
	| { status: "blocked"; reasonCode: string };

export async function buildRuntimeIsolationPlan(params: {
	profileId: string;
	projection: RuntimeSourceProjection;
	images: QualifiedRuntimeImages;
	dockerDaemonIdentityHash: string;
	qualificationHash: string;
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
	const lockDigest = await validateAndDigestNpmLock(
		params.projection.projectPath,
	);
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
	if (!hasCompleteImageSet(params.images)) {
		return { status: "blocked", reasonCode: "runtime_image_missing" };
	}
	const targetPlan = recipeResolution.targetPlan;
	if (targetPlan.command[0] !== "npm" || targetPlan.command.length < 2) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		};
	}
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
			adapterId: "npm-package-lock-v1",
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
			executable: "npm",
			args: targetPlan.command.slice(1),
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

function hasCompleteImageSet(images: QualifiedRuntimeImages): boolean {
	const required = [
		images.namespaceOwnerImageDigest,
		images.nodeRuntimeImageDigest,
		images.materializerImageDigest,
		images.registryProxyImageDigest,
		images.probeImageDigest,
		images.httpExecutorImageDigest,
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

async function validateAndDigestNpmLock(root: string): Promise<string | null> {
	const lockPath = path.join(root, "package-lock.json");
	try {
		const raw = await fs.readFile(lockPath, "utf8");
		const lock = JSON.parse(raw) as {
			lockfileVersion?: number;
			packages?: Record<
				string,
				{ resolved?: string; integrity?: string; link?: boolean }
			>;
		};
		if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) return null;
		for (const [entryPath, entry] of Object.entries(lock.packages ?? {})) {
			if (entryPath === "") continue;
			if (entry.link || !entry.resolved || !entry.integrity) return null;
			const resolved = new URL(entry.resolved);
			if (
				resolved.protocol !== "https:" ||
				resolved.hostname !== "registry.npmjs.org" ||
				resolved.username ||
				resolved.password
			) {
				return null;
			}
		}
		return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
	} catch {
		return null;
	}
}
