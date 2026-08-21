import type {
	ScanPreflightCheck,
	ScanPreflightResultV1,
	ScanPreflightResultV2,
} from "../../../shared/schemas/scan-preflight.schema";
import { scanPreflightResultV2Schema } from "../../../shared/schemas/scan-preflight.schema";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import type { RuntimeIsolationPlanningResult } from "./runtime-isolation-planner";
import { runtimeIsolationHash } from "./runtime-isolation-hash";

export function buildRuntimeIsolationPreflight(params: {
	base: ScanPreflightResultV1;
	planning: RuntimeIsolationPlanningResult;
	networkReady: boolean;
	cleanupReady: boolean;
}): ScanPreflightResultV2 {
	const stepId = `profile:${params.base.profileId}`;
	const runtimeChecks: ScanPreflightCheck[] = [];
	const runtimeIsolation =
		params.planning.status === "ready"
			? {
					status: "ready" as const,
					sourceSnapshotDigest:
						params.planning.plan.source.sourceSnapshotDigest,
					runtimeProjectionDigest:
						params.planning.plan.source.runtimeProjectionDigest,
					recipeHash: params.planning.plan.recipe.recipeHash,
					dependencyLockDigest: params.planning.plan.dependency.lockDigest,
					runtimeIsolationPlanHash: params.planning.planHash,
					runtimeIsolationQualificationHash:
						params.planning.plan.qualificationHash,
					dockerDaemonIdentityHash:
						params.planning.plan.dockerDaemonIdentityHash,
					imageDigests: runtimeIsolationImageDigests(
						params.planning.plan.images,
					),
					databaseMode: params.planning.plan.database.mode,
				}
			: { status: "blocked" as const, reasonCode: params.planning.reasonCode };

	runtimeChecks.push(
		check({
			id: `${stepId}:runtime-source-projection`,
			stepId,
			kind: "runtime_source_projection",
			required: true,
			ready: params.planning.status === "ready",
			reasonCode:
				params.planning.status === "ready" ? null : params.planning.reasonCode,
			action: "create_runtime_recipe",
		}),
	);
	if (params.planning.status === "ready") {
		runtimeChecks.push(
			check({
				id: `${stepId}:runtime-dependency-preparation`,
				stepId,
				kind: "runtime_dependency_preparation",
				required: true,
				ready: true,
				reasonCode: null,
				action: "use_supported_npm_lock",
			}),
			check({
				id: `${stepId}:runtime-database-isolation`,
				stepId,
				kind: "runtime_database_isolation",
				required: true,
				ready: true,
				reasonCode: null,
				action: "create_runtime_recipe",
			}),
			check({
				id: `${stepId}:runtime-network-isolation`,
				stepId,
				kind: "runtime_network_isolation",
				required: true,
				ready: params.networkReady,
				reasonCode: params.networkReady
					? null
					: "runtime_network_namespace_unavailable",
				action: "run_runtime_isolation_qualification",
			}),
			check({
				id: `${stepId}:runtime-cleanup-capability`,
				stepId,
				kind: "runtime_cleanup_capability",
				required: true,
				ready: params.cleanupReady,
				reasonCode: params.cleanupReady ? null : "runtime_cleanup_unavailable",
				action: "run_runtime_isolation_qualification",
			}),
		);
	}
	const checks = [...params.base.checks, ...runtimeChecks];
	const blocked = checks.filter((item) => item.status === "blocked");
	const status = blocked.some((item) => item.required)
		? "blocked"
		: blocked.length > 0
			? "ready_with_gaps"
			: "ready";
	const summary = {
		ready: checks.filter((item) => item.status === "ready").length,
		blockedRequired: blocked.filter((item) => item.required).length,
		blockedOptional: blocked.filter((item) => !item.required).length,
		notApplicable: checks.filter((item) => item.status === "not_applicable")
			.length,
	};
	const binding = { ...params.base.binding, runtimeIsolation };
	const partial = {
		...params.base,
		schemaVersion: 2 as const,
		status,
		checks,
		summary,
		limitationCodes: [
			...new Set(blocked.flatMap((item) => item.reasonCode ?? [])),
		].sort(),
		binding,
		bindingHash: runtimeIsolationHash(binding),
	};
	return scanPreflightResultV2Schema.parse({
		...partial,
		preflightHash: runtimeIsolationHash({
			...partial,
			preflightHash: undefined,
		}),
	});
}

function check(input: {
	id: string;
	stepId: string;
	kind: ScanPreflightCheck["kind"];
	required: boolean;
	ready: boolean;
	reasonCode: string | null;
	action: ScanPreflightCheck["action"];
}): ScanPreflightCheck {
	return {
		id: input.id,
		stepId: input.stepId,
		kind: input.kind,
		required: input.required,
		status: input.ready ? "ready" : "blocked",
		reasonCode: input.reasonCode,
		action: input.action,
		scannerId: null,
		observedVersion: null,
		expectedVersion: null,
		expectedDigest: null,
		observedDigest: null,
		dataState: null,
		dataGeneratedAt: null,
		evidenceRefs: [],
	};
}

export function runtimeIsolationImageDigests(
	images: RuntimeIsolationPlanV1["images"],
): Record<string, string> {
	const direct = [
		["namespace-owner", images.namespaceOwnerImageDigest],
		["node-runtime", images.nodeRuntimeImageDigest],
		["materializer", images.materializerImageDigest],
		["registry-proxy", images.registryProxyImageDigest],
		["probe", images.probeImageDigest],
		["http-executor", images.httpExecutorImageDigest],
		...(images.databaseImageDigest
			? [["database", images.databaseImageDigest]]
			: []),
	] as Array<[string, string]>;
	return Object.fromEntries(
		direct
			.concat(Object.entries(images.scannerImageDigests))
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}
