import type { DastTargetStartPlan } from "../dast/target-preparer";
import type {
	PreparedRuntimeTarget,
	RuntimeTargetProvider,
} from "../dast/runtime-target-provider";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import {
	startDockerRuntimeBundle,
	type DockerRuntimeBundleRunner,
	type RuntimeBundleLeaseRepository,
} from "./docker-runtime-bundle-lifecycle";
import { createNamespaceDastFetch } from "./namespace-dast-fetch";

/**
 * Adapter exposed to profile execution.  It owns no host process and rejects
 * any attempt to substitute the sanitized projection with another path.
 */
export function createDockerRuntimeTargetProvider(params: {
	scanRunId: string;
	projectionPath: string;
	plan: RuntimeIsolationPlanV1;
	planHash: string;
	images: RuntimeImageRegistry;
	leaseRepository: RuntimeBundleLeaseRepository;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
}): RuntimeTargetProvider {
	const targetPlan: DastTargetStartPlan = {
		pluginId: "build.npm",
		repoPath: params.projectionPath,
		scriptName: params.plan.start.args.join(" "),
		script: params.plan.start.args.join(" "),
		packageManager: "npm",
		command: ["npm", ...params.plan.start.args],
		env: {},
		requiresProjectCodeConsent: false,
		port: params.plan.start.port,
		origin: `http://127.0.0.1:${params.plan.start.port}`,
		readinessPaths: params.plan.start.readinessPaths,
		warnings: [],
	};
	return {
		plan: targetPlan,
		async prepare(input): Promise<PreparedRuntimeTarget> {
			if (input.repoPath !== params.projectionPath) {
				throw new Error("runtime_projection_path_mismatch");
			}
			if (!input.consentProjectCodeExecution) {
				throw new Error("project_code_execution_consent_required");
			}
			const bundle = await startDockerRuntimeBundle(params);
			return {
				origin: bundle.origin,
				targetConfig: {
					name: `Isolated runtime bundle ${bundle.receipt.bundleId}`,
					origin: bundle.origin,
					allowLoopback: true,
					allowPrivateNetwork: false,
					allowedPathsJson: params.plan.start.readinessPaths,
					excludedPathsJson: [],
					defaultHeadersJson: {},
					maxDepth: 2,
					maxRequests: 100,
					rateLimitPerSec: 2,
					timeoutSec: 120,
					metadata: {
						isolatedRuntime: true,
						planHash: params.planHash,
						bundleLeaseId: bundle.leaseId,
					},
				},
				plan: targetPlan,
				leaseManaged: true,
				runtimeNamespaceOwnerId: bundle.namespaceOwnerId,
				runtimeScannerImages: {
					...(params.images.nuclei
						? { "nuclei-safe": params.images.nuclei }
						: {}),
					...(params.images.zap ? { "zap-baseline": params.images.zap } : {}),
					...(params.images.schemathesis
						? { schemathesis: params.images.schemathesis }
						: {}),
				},
				runtimeDastFetch: createNamespaceDastFetch({
					namespaceOwnerId: bundle.namespaceOwnerId,
					allowedOrigin: bundle.origin,
					image: params.images.httpExecutor,
					runner: params.runner,
					dockerBin: params.dockerBin,
				}),
				evidence: {
					planHash: params.planHash,
					bundleLeaseId: bundle.leaseId,
					databaseMode: params.plan.database.mode,
				},
				stop: bundle.stop,
			};
		},
	};
}
