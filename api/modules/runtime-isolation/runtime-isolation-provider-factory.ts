import type { RuntimeDependencyAdapterId } from "../../../shared/schemas/runtime-isolation.schema";
import type {
	RuntimeScannerStep,
	ScanProfileStep,
} from "../../../shared/schemas/scan-profile.schema";
import type { RuntimeTargetProvider } from "../dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import type { FullSourceSnapshot } from "../scans/execution/lifecycle/full-source-snapshot";
import type {
	DockerRuntimeBundleRunner,
	RuntimeBundleLeaseRepository,
} from "./docker-runtime-bundle-lifecycle";
import { createDockerRuntimeTargetProvider } from "./docker-runtime-target-provider";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import { runtimePlanImages } from "./runtime-image-registry";
import {
	buildRuntimeIsolationPlan,
	type QualifiedRuntimeImages,
	type RuntimeScannerImageRole,
} from "./runtime-isolation-planner";
import { materializeRuntimeSourceProjection } from "./runtime-source-projection";

export type RuntimeIsolationProviderFactory = (input: {
	scanRunId: string;
	profileId: string;
	sourceSnapshot: FullSourceSnapshot;
	scannerImageRequirements?: readonly RuntimeScannerImageRequirement[];
	requiredScannerImageRoles?: readonly RuntimeScannerImageRole[];
}) => Promise<RuntimeTargetProvider>;

export type RuntimeScannerImageRequirement = {
	role: RuntimeScannerImageRole;
	required: boolean;
};

const runtimeScannerImageRoleByAdapter: Record<
	RuntimeScannerStep["adapter"],
	RuntimeScannerImageRole
> = {
	"nuclei-safe": "nuclei",
	"zap-baseline": "zap",
};

export function runtimeScannerImageRolesForSteps(
	steps: readonly ScanProfileStep[],
): RuntimeScannerImageRole[] {
	return runtimeScannerImageRequirementsForSteps(steps)
		.filter((requirement) => requirement.required)
		.map((requirement) => requirement.role);
}

export function runtimeScannerImageRequirementsForSteps(
	steps: readonly ScanProfileStep[],
): RuntimeScannerImageRequirement[] {
	const requirements = new Map<RuntimeScannerImageRole, boolean>();
	for (const step of steps) {
		const role =
			step.kind === "runtime_scanner"
				? runtimeScannerImageRoleByAdapter[step.adapter]
				: step.kind === "api_schema_scan"
					? "schemathesis"
					: null;
		if (!role) continue;
		requirements.set(role, (requirements.get(role) ?? false) || step.required);
	}
	return [...requirements]
		.map(([role, required]) => ({ role, required }))
		.sort((left, right) => left.role.localeCompare(right.role));
}

/**
 * The only supported construction path for a local runtime provider. It
 * derives every runtime input from a disposable immutable snapshot and makes
 * projection cleanup part of target cleanup.
 */
export function createRuntimeIsolationProviderFactory(params: {
	images: RuntimeImageRegistry;
	dockerDaemonIdentityHash: string;
	qualificationHash: string;
	qualifiedDependencyAdapterIds?: readonly RuntimeDependencyAdapterId[];
	inferTargetPlan: (input: {
		repoPath: string;
		port: number;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
	leaseRepository: RuntimeBundleLeaseRepository;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
}): RuntimeIsolationProviderFactory {
	return async (input) => {
		const projection = await materializeRuntimeSourceProjection({
			snapshot: input.sourceSnapshot,
		});
		try {
			const scannerImageRequirements =
				input.scannerImageRequirements ??
				(input.requiredScannerImageRoles ?? []).map((role) => ({
					role,
					required: true,
				}));
			const planning = await buildRuntimeIsolationPlan({
				profileId: input.profileId,
				projection,
				images: runtimePlanImages(params.images) as QualifiedRuntimeImages,
				dockerDaemonIdentityHash: params.dockerDaemonIdentityHash,
				qualificationHash: params.qualificationHash,
				requiredScannerImageRoles: scannerImageRequirements
					.filter((requirement) => requirement.required)
					.map((requirement) => requirement.role),
				qualifiedDependencyAdapterIds: params.qualifiedDependencyAdapterIds ?? [
					"npm-package-lock-v1",
				],
				inferTargetPlan: params.inferTargetPlan,
			});
			if (planning.status === "blocked") {
				return {
					runtimeIsolationPlanning: planning,
					dispose: async () => await projection.cleanup(),
					async prepare() {
						throw new Error(planning.reasonCode);
					},
				};
			}
			const provider = createDockerRuntimeTargetProvider({
				scanRunId: input.scanRunId,
				projectionPath: projection.projectPath,
				plan: planning.plan,
				planHash: planning.planHash,
				images: params.images,
				scannerImageRequirements,
				leaseRepository: params.leaseRepository,
				runner: params.runner,
				dockerBin: params.dockerBin,
			});
			return {
				plan: provider.plan,
				runtimeIsolationPlanning: planning,
				preflightDockerImages: provider.preflightDockerImages,
				runtimeScannerImages: provider.runtimeScannerImages,
				dispose: async () => await projection.cleanup(),
				async prepare(prepareInput) {
					try {
						const target = await provider.prepare({
							...prepareInput,
							repoPath: projection.projectPath,
						});
						return {
							...target,
							stop: async () => {
								try {
									await target.stop();
								} finally {
									await projection.cleanup();
								}
							},
						};
					} catch (error) {
						await projection.cleanup().catch(() => undefined);
						throw error;
					}
				},
			};
		} catch (error) {
			await projection.cleanup().catch(() => undefined);
			throw error;
		}
	};
}
