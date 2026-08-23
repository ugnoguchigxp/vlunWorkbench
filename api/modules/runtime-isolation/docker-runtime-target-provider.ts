import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import type {
	PreparedRuntimeTarget,
	RuntimePreflightDockerImage,
	RuntimeScannerImages,
	RuntimeTargetProvider,
} from "../dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import {
	type DockerRuntimeBundleRunner,
	type RuntimeBundleLeaseRepository,
	startDockerRuntimeBundle,
} from "./docker-runtime-bundle-lifecycle";
import { createNamespaceDastFetch } from "./namespace-dast-fetch";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import type { RuntimeScannerImageRequirement } from "./runtime-isolation-provider-factory";

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
	scannerImageRequirements?: readonly RuntimeScannerImageRequirement[];
	leaseRepository: RuntimeBundleLeaseRepository;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
}): RuntimeTargetProvider {
	const runtimeScannerImages: RuntimeScannerImages = {
		...(params.images.nuclei ? { "nuclei-safe": params.images.nuclei } : {}),
		...(params.images.zap ? { "zap-baseline": params.images.zap } : {}),
		...(params.images.schemathesis
			? { schemathesis: params.images.schemathesis }
			: {}),
	};
	const scannerRequirements = params.scannerImageRequirements ?? [];
	const preflightDockerImages: RuntimePreflightDockerImage[] = [
		{
			role: "namespace-owner",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.namespaceOwner,
			required: true,
		},
		{
			role: "node-runtime",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.nodeRuntime,
			required: true,
		},
		{
			role: "materializer",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.materializer,
			required: true,
		},
		{
			role: "registry-proxy",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.registryProxy,
			required: true,
		},
		{
			role: "probe",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.probe,
			required: true,
		},
		{
			role: "http-executor",
			stepId: `profile:${params.plan.profileId}`,
			image: params.images.httpExecutor,
			required: true,
		},
		...(params.plan.database.mode === "postgres_ephemeral"
			? [
					{
						role: "database-postgres",
						stepId: `profile:${params.plan.profileId}`,
						image: params.images.postgres ?? null,
						required: true,
					},
				]
			: params.plan.database.mode === "mysql_ephemeral"
				? [
						{
							role: "database-mysql",
							stepId: `profile:${params.plan.profileId}`,
							image: params.images.mysql ?? null,
							required: true,
						},
					]
				: []),
		...scannerRequirements.map((requirement) => ({
			role: `scanner-${requirement.role}`,
			stepId:
				requirement.role === "nuclei"
					? "runtime_scanner:nuclei-safe"
					: requirement.role === "zap"
						? "runtime_scanner:zap-baseline"
						: "api_schema_scan:schemathesis",
			image:
				requirement.role === "nuclei"
					? (params.images.nuclei ?? null)
					: requirement.role === "zap"
						? (params.images.zap ?? null)
						: (params.images.schemathesis ?? null),
			required: requirement.required,
		})),
	];
	const targetPlan: DastTargetStartPlan = {
		pluginId: "build.npm",
		repoPath: params.projectionPath,
		scriptName: params.plan.start.args.join(" "),
		script: params.plan.start.args.join(" "),
		packageManager: params.plan.start.executable,
		command: [params.plan.start.executable, ...params.plan.start.args],
		env: {},
		requiresProjectCodeConsent: false,
		port: params.plan.start.port,
		origin: `http://127.0.0.1:${params.plan.start.port}`,
		readinessPaths: params.plan.start.readinessPaths,
		warnings: [],
	};
	return {
		plan: targetPlan,
		preflightDockerImages,
		runtimeScannerImages,
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
				runtimeScannerImages,
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
