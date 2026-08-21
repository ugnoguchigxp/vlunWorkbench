import type { FullSourceSnapshot } from "../scans/execution/lifecycle/full-source-snapshot";
import type { RuntimeTargetProvider } from "../dast/runtime-target-provider";
import { createDockerRuntimeTargetProvider } from "./docker-runtime-target-provider";
import type {
	DockerRuntimeBundleRunner,
	RuntimeBundleLeaseRepository,
} from "./docker-runtime-bundle-lifecycle";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import { runtimePlanImages } from "./runtime-image-registry";
import {
	buildRuntimeIsolationPlan,
	type QualifiedRuntimeImages,
} from "./runtime-isolation-planner";
import { materializeRuntimeSourceProjection } from "./runtime-source-projection";
import type { DastTargetStartPlan } from "../dast/target-preparer";

/**
 * The only supported construction path for a local runtime provider. It
 * derives every runtime input from a disposable immutable snapshot and makes
 * projection cleanup part of target cleanup.
 */
export function createRuntimeIsolationProviderFactory(params: {
	images: RuntimeImageRegistry;
	dockerDaemonIdentityHash: string;
	qualificationHash: string;
	inferTargetPlan: (input: {
		repoPath: string;
		port: number;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
	leaseRepository: RuntimeBundleLeaseRepository;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
}): (input: {
	scanRunId: string;
	profileId: string;
	sourceSnapshot: FullSourceSnapshot;
}) => Promise<RuntimeTargetProvider> {
	return async (input) => {
		const projection = await materializeRuntimeSourceProjection({
			snapshot: input.sourceSnapshot,
		});
		try {
			const planning = await buildRuntimeIsolationPlan({
				profileId: input.profileId,
				projection,
				images: runtimePlanImages(params.images) as QualifiedRuntimeImages,
				dockerDaemonIdentityHash: params.dockerDaemonIdentityHash,
				qualificationHash: params.qualificationHash,
				inferTargetPlan: params.inferTargetPlan,
			});
			if (planning.status === "blocked") {
				throw new Error(planning.reasonCode);
			}
			const provider = createDockerRuntimeTargetProvider({
				scanRunId: input.scanRunId,
				projectionPath: projection.projectPath,
				plan: planning.plan,
				planHash: planning.planHash,
				images: params.images,
				leaseRepository: params.leaseRepository,
				runner: params.runner,
				dockerBin: params.dockerBin,
			});
			return {
				plan: provider.plan,
				runtimeIsolationPlanning: planning,
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
