import type { ScanPreflightCheck } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import { ZAP_STABLE_IMAGE } from "../../runtime-scans/zap-image-policy";
import type { RuntimePreflightDockerImage } from "../../dast/runtime-target-provider";
import { DEFAULT_DOCKER_IMAGE } from "../tools/tool-process-policy";
import type {
	ScanPreflightDependencies,
	ScanPreflightParams,
} from "./scan-preflight";
import {
	type DockerImageProbe,
	type DockerProbe,
	dockerImageEvidenceRefs,
	dockerImageIsCompatible,
	dockerImageReason,
} from "./scan-preflight-binding";
import {
	buildPreflightCheck as check,
	digestFromImageRef,
} from "./scan-preflight-check-builders";

export async function addDockerPreflightChecks(input: {
	params: ScanPreflightParams;
	dependencies: ScanPreflightDependencies;
	checks: ScanPreflightCheck[];
	needsToolboxDocker: boolean;
	needsMavenResolver: boolean;
	zapSteps: ScanProfileStep[];
	isolatedRuntime: boolean;
	runtimeDockerImages: RuntimePreflightDockerImage[];
	stepIsApplicable: (step: ScanProfileStep) => boolean;
	profileInputBindings: Record<string, string | undefined>;
}): Promise<{
	dockerProbe: DockerProbe | null;
	toolboxImageProbe: DockerImageProbe | null;
}> {
	const {
		params,
		dependencies,
		checks,
		needsToolboxDocker,
		needsMavenResolver,
		zapSteps,
		isolatedRuntime,
		runtimeDockerImages,
		stepIsApplicable,
		profileInputBindings,
	} = input;
	const dockerBin = params.execution.docker?.dockerBin ?? "docker";
	const toolboxImage = params.execution.docker?.image ?? DEFAULT_DOCKER_IMAGE;
	let dockerProbe: DockerProbe | null = null;
	let toolboxImageProbe: DockerImageProbe | null = null;
	let zapImageProbe: DockerImageProbe | null = null;
	if (
		needsToolboxDocker ||
		needsMavenResolver ||
		zapSteps.length > 0 ||
		isolatedRuntime ||
		runtimeDockerImages.length > 0
	) {
		dockerProbe = await dependencies.probeDocker(dockerBin);
		const required =
			needsMavenResolver ||
			params.steps.some(
				(step) =>
					step.required &&
					stepIsApplicable(step) &&
					(params.execution.runner === "docker" ||
						(step.kind === "runtime_scanner" &&
							step.adapter === "zap-baseline")),
			) ||
			runtimeDockerImages.some((image) => image.required);
		checks.push(
			check({
				id: "runtime:docker-daemon",
				stepId: `profile:${params.profile.id}`,
				kind: "docker_daemon",
				required,
				ready: dockerProbe.ready,
				reasonCode: dockerProbe.reasonCode,
				action: "start_docker_daemon",
				observedVersion: dockerProbe.version,
				observedPlatform: dockerProbe.platform,
				evidenceRefs: dockerProbe.version ? ["runtime:docker-daemon"] : [],
			}),
		);
		if (dockerProbe.ready && needsToolboxDocker) {
			toolboxImageProbe = await dependencies.probeDockerImage(
				dockerBin,
				toolboxImage,
			);
			checks.push(
				check({
					id: "runtime:docker-image:toolbox",
					stepId: `profile:${params.profile.id}`,
					kind: "docker_image",
					required: params.steps.some(
						(step) =>
							step.required && stepIsApplicable(step) && step.kind !== "dast",
					),
					ready: dockerImageIsCompatible(
						toolboxImageProbe,
						dockerProbe,
						digestFromImageRef(toolboxImage),
					),
					reasonCode: dockerImageReason(
						toolboxImageProbe,
						dockerProbe,
						digestFromImageRef(toolboxImage),
					),
					action: "build_toolbox_image",
					expectedDigest: digestFromImageRef(toolboxImage),
					observedDigest:
						toolboxImageProbe.digest ?? toolboxImageProbe.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: toolboxImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(toolboxImageProbe),
				}),
			);
		}
		if (dockerProbe.ready && needsMavenResolver) {
			const resolverImage = params.mavenResolverImage;
			const resolverImageProbe = resolverImage
				? await dependencies.probeDockerImage(dockerBin, resolverImage)
				: null;
			const expectedDigest = resolverImage
				? digestFromImageRef(resolverImage)
				: null;
			const ready = Boolean(
				resolverImage &&
					resolverImageProbe?.imageId &&
					dockerImageIsCompatible(
						resolverImageProbe,
						dockerProbe,
						expectedDigest,
					),
			);
			checks.push(
				check({
					id: "runtime:docker-image:maven-resolver",
					stepId: "osv",
					kind: "docker_image",
					required: true,
					ready,
					reasonCode: !resolverImage
						? "maven_resolver_image_not_configured"
						: resolverImageProbe && !resolverImageProbe.imageId
							? "maven_resolver_image_id_unavailable"
							: resolverImageProbe
								? dockerImageReason(
										resolverImageProbe,
										dockerProbe,
										expectedDigest,
									)
								: "maven_resolver_image_unavailable",
					action: "build_maven_resolver_image",
					expectedDigest,
					observedDigest:
						resolverImageProbe?.digest ?? resolverImageProbe?.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: resolverImageProbe?.platform ?? null,
					evidenceRefs: resolverImageProbe
						? dockerImageEvidenceRefs(resolverImageProbe)
						: [],
				}),
			);
			if (resolverImageProbe?.imageId) {
				profileInputBindings.mavenResolverImageId = resolverImageProbe.imageId;
			}
		}
		if (dockerProbe.ready && zapSteps.length > 0) {
			zapImageProbe = await dependencies.probeDockerImage(
				dockerBin,
				ZAP_STABLE_IMAGE,
			);
			checks.push(
				check({
					id: "runtime:docker-image:zap-baseline",
					stepId: "runtime_scanner:zap-baseline",
					kind: "docker_image",
					required: zapSteps.some((step) => step.required),
					ready: dockerImageIsCompatible(
						zapImageProbe,
						dockerProbe,
						digestFromImageRef(ZAP_STABLE_IMAGE),
					),
					reasonCode: dockerImageReason(
						zapImageProbe,
						dockerProbe,
						digestFromImageRef(ZAP_STABLE_IMAGE),
					),
					action: "pull_pinned_image",
					expectedDigest: digestFromImageRef(ZAP_STABLE_IMAGE),
					observedDigest: zapImageProbe.digest ?? zapImageProbe.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: zapImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(zapImageProbe),
				}),
			);
		}
		if (dockerProbe.ready && runtimeDockerImages.length > 0) {
			const probes = new Map<string, DockerImageProbe>();
			for (const runtimeImage of runtimeDockerImages) {
				const expectedDigest = runtimeImage.image
					? digestFromImageRef(runtimeImage.image)
					: null;
				let imageProbe: DockerImageProbe | null = null;
				if (runtimeImage.image) {
					imageProbe = probes.get(runtimeImage.image) ?? null;
					if (!imageProbe) {
						imageProbe = await dependencies.probeDockerImage(
							dockerBin,
							runtimeImage.image,
						);
						probes.set(runtimeImage.image, imageProbe);
					}
				}
				const ready = Boolean(
					imageProbe &&
						dockerImageIsCompatible(imageProbe, dockerProbe, expectedDigest),
				);
				checks.push(
					check({
						id: `runtime:docker-image:isolated:${runtimeImage.role}`,
						stepId: runtimeImage.stepId,
						kind: "docker_image",
						required: runtimeImage.required,
						ready,
						reasonCode: imageProbe
							? dockerImageReason(imageProbe, dockerProbe, expectedDigest)
							: "runtime_image_missing",
						action: "pull_pinned_image",
						expectedDigest,
						observedDigest: imageProbe?.digest ?? imageProbe?.imageId ?? null,
						expectedPlatform: dockerProbe.platform,
						observedPlatform: imageProbe?.platform ?? null,
						evidenceRefs: imageProbe ? dockerImageEvidenceRefs(imageProbe) : [],
					}),
				);
			}
		}
	}
	return { dockerProbe, toolboxImageProbe };
}
