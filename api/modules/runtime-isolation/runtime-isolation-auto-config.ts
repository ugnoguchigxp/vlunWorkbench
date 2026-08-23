import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
	RUNTIME_SETTINGS_DEFAULTS,
	type RuntimeIsolationSettings,
	RuntimeIsolationSettingsSchema,
} from "../../config/runtime-settings";
import {
	type BoundedProcessResult,
	runBoundedProcess,
} from "../processes/bounded-process-runner";
import { getCleanEnv } from "../scans/tools/process-runner-shared";

const BASE_IMAGE_TAG = "node:22-alpine";
const LOCAL_FALLBACK_BASE_IMAGE_TAG = "vuln-workbench-dynamic:local";
const RUNTIME_IMAGE_LOCAL_TAG = "vuln-workbench-runtime:local";
const RUNTIME_IMAGE_REPOSITORY = "vuln-workbench-runtime";
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PINNED_IMAGE_PATTERN = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const OFFICIAL_NODE_IMAGE_PATTERN =
	/^(?:(?:docker\.io\/)?library\/)?node@sha256:[a-f0-9]{64}$/;
const LOCAL_DYNAMIC_IMAGE_PATTERN =
	/^vuln-workbench-dynamic@sha256:[a-f0-9]{64}$/;

export type RuntimeIsolationAutoConfigRunner = (
	argv: string[],
	options: { timeoutMs: number; outputLimitBytes: number },
) => Promise<BoundedProcessResult>;

export class RuntimeIsolationAutoConfigError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: 409 | 503 = 409,
	) {
		super(message);
		this.name = "RuntimeIsolationAutoConfigError";
	}
}

export function mergeAutoConfiguredRuntimeIsolationSettings(
	current: RuntimeIsolationSettings,
	autoConfigured: RuntimeIsolationSettings,
): RuntimeIsolationSettings {
	return RuntimeIsolationSettingsSchema.parse({
		...autoConfigured,
		postgresImage: current.postgresImage,
		mysqlImage: current.mysqlImage,
		nucleiImage: current.nucleiImage,
		zapImage: current.zapImage,
		schemathesisImage: current.schemathesisImage,
	});
}

let activeAutoConfiguration: Promise<RuntimeIsolationSettings> | null = null;

export function autoConfigureLocalRuntimeIsolation(
	params: {
		dockerBin?: string;
		repositoryRoot?: string;
		runner?: RuntimeIsolationAutoConfigRunner;
		idFactory?: () => string;
	} = {},
): Promise<RuntimeIsolationSettings> {
	if (activeAutoConfiguration) return activeAutoConfiguration;
	const operation = performLocalRuntimeIsolationAutoConfiguration(params);
	const tracked = operation.finally(() => {
		if (activeAutoConfiguration === tracked) activeAutoConfiguration = null;
	});
	activeAutoConfiguration = tracked;
	return tracked;
}

async function performLocalRuntimeIsolationAutoConfiguration(params: {
	dockerBin?: string;
	repositoryRoot?: string;
	runner?: RuntimeIsolationAutoConfigRunner;
	idFactory?: () => string;
}): Promise<RuntimeIsolationSettings> {
	const dockerBin = params.dockerBin ?? "docker";
	const repositoryRoot = path.resolve(
		params.repositoryRoot ?? path.resolve(import.meta.dir, "../../.."),
	);
	const runner = params.runner ?? defaultRunner;
	const id = (params.idFactory ?? randomUUID)()
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 12);
	if (!id) {
		throw new RuntimeIsolationAutoConfigError(
			"runtime_isolation_qualification_id_unavailable",
			"A temporary Docker qualification identifier could not be generated.",
			503,
		);
	}
	const networkName = `vwb-runtime-qualification-${id}`;
	const proxyName = `${networkName}-proxy`;
	const temporaryImageTag = `${RUNTIME_IMAGE_REPOSITORY}:qualification-${id}`;

	const daemonIdentity = await checkedCommand(
		runner,
		[
			dockerBin,
			"info",
			"--format",
			"{{.ID}}\t{{.ServerVersion}}\t{{.OSType}}\t{{.Architecture}}\t{{.Driver}}\t{{.CgroupVersion}}",
		],
		30_000,
		"runtime_isolation_docker_unavailable",
		"Docker is unavailable. Start Docker and retry.",
		503,
	);
	const daemonFields = daemonIdentity.stdout.trim().split("\t");
	if (
		daemonFields.length !== 6 ||
		daemonFields.some((field) => !field.trim())
	) {
		throw new RuntimeIsolationAutoConfigError(
			"runtime_isolation_docker_identity_unavailable",
			"Docker did not provide the identity information required for qualification.",
			503,
		);
	}
	const dockerDaemonIdentityHash = sha256(daemonFields.join("\t"));

	let baseImage = await inspectBaseImage(
		runner,
		dockerBin,
		BASE_IMAGE_TAG,
		OFFICIAL_NODE_IMAGE_PATTERN,
	);
	let baseImageIdentity = baseImage;
	if (!baseImage) {
		const localFallbackIdentity = await inspectBaseImage(
			runner,
			dockerBin,
			LOCAL_FALLBACK_BASE_IMAGE_TAG,
			LOCAL_DYNAMIC_IMAGE_PATTERN,
		);
		if (localFallbackIdentity) {
			baseImage = LOCAL_FALLBACK_BASE_IMAGE_TAG;
			baseImageIdentity = localFallbackIdentity;
		}
	}
	if (!baseImage) {
		await checkedCommand(
			runner,
			[dockerBin, "pull", BASE_IMAGE_TAG],
			10 * 60_000,
			"runtime_isolation_base_image_pull_failed",
			"The pinned base image for the local isolated runtime could not be downloaded.",
		);
		baseImage = await inspectBaseImage(
			runner,
			dockerBin,
			BASE_IMAGE_TAG,
			OFFICIAL_NODE_IMAGE_PATTERN,
		);
		baseImageIdentity = baseImage;
	}
	if (!baseImage || !baseImageIdentity) {
		throw new RuntimeIsolationAutoConfigError(
			"runtime_isolation_base_image_digest_unavailable",
			"Docker could not resolve the base image to a fixed digest.",
		);
	}

	await checkedCommand(
		runner,
		[
			dockerBin,
			"build",
			"--progress=plain",
			"--pull=false",
			"--build-arg",
			`BASE_IMAGE=${baseImage}`,
			"--file",
			path.join(repositoryRoot, "docker/runtime/Dockerfile"),
			"--tag",
			temporaryImageTag,
			repositoryRoot,
		],
		10 * 60_000,
		"runtime_isolation_image_build_failed",
		"The local isolated runtime image could not be built.",
	);

	try {
		const builtImage = await checkedCommand(
			runner,
			[
				dockerBin,
				"image",
				"inspect",
				"--format",
				"{{.Id}}\t{{.Os}}\t{{.Architecture}}",
				temporaryImageTag,
			],
			30_000,
			"runtime_isolation_image_inspect_failed",
			"The built isolated runtime image could not be inspected.",
		);
		const [imageId, imageOs, imageArchitecture] = builtImage.stdout
			.trim()
			.split("\t");
		if (
			!imageId ||
			!SHA256_PATTERN.test(imageId) ||
			!imageOs ||
			!imageArchitecture
		) {
			throw new RuntimeIsolationAutoConfigError(
				"runtime_isolation_image_identity_invalid",
				"The built isolated runtime image did not have a verifiable identity.",
			);
		}
		const pinnedRuntimeImage = `${RUNTIME_IMAGE_REPOSITORY}@${imageId}`;
		if (!PINNED_IMAGE_PATTERN.test(pinnedRuntimeImage)) {
			throw new RuntimeIsolationAutoConfigError(
				"runtime_isolation_image_identity_invalid",
				"The built isolated runtime image did not have a valid fixed digest.",
			);
		}
		await checkedCommand(
			runner,
			[dockerBin, "image", "inspect", pinnedRuntimeImage],
			30_000,
			"runtime_isolation_pinned_image_unavailable",
			"Docker could not open the isolated runtime image by its fixed digest.",
		);

		await checkedCommand(
			runner,
			[
				dockerBin,
				"run",
				"--rm",
				"--network",
				"none",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--tmpfs",
				"/tmp:rw,nosuid,nodev,size=32m",
				"--user",
				"1000:1000",
				pinnedRuntimeImage,
				"sh",
				"-ceu",
				'command -v node; command -v npm; command -v sh; command -v wget; command -v curl; command -v cp; command -v chmod; command -v sleep; test "$(id -u)" = 1000',
			],
			60_000,
			"runtime_isolation_toolchain_qualification_failed",
			"The local isolated runtime image failed its toolchain qualification.",
		);
		await checkedCommand(
			runner,
			[
				dockerBin,
				"run",
				"--rm",
				"--network",
				"none",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--user",
				"65532:65532",
				pinnedRuntimeImage,
				"sh",
				"-ceu",
				'test "$(id -u)" = 65532; sleep 0.1',
			],
			30_000,
			"runtime_isolation_namespace_owner_qualification_failed",
			"The local isolated runtime image failed its namespace-owner qualification.",
		);

		let networkCreated = false;
		let proxyCreated = false;
		try {
			await checkedCommand(
				runner,
				[dockerBin, "network", "create", networkName],
				30_000,
				"runtime_isolation_network_qualification_failed",
				"Docker could not create the temporary qualification network.",
			);
			networkCreated = true;
			await checkedCommand(
				runner,
				[
					dockerBin,
					"create",
					"--name",
					proxyName,
					"--network",
					networkName,
					"--user",
					"1000:1000",
					"--read-only",
					"--cap-drop",
					"ALL",
					"--security-opt",
					"no-new-privileges",
					"--tmpfs",
					"/tmp:rw,nosuid,nodev,size=32m,uid=1000,gid=1000",
					pinnedRuntimeImage,
				],
				30_000,
				"runtime_isolation_proxy_qualification_failed",
				"The local registry proxy could not be created for qualification.",
			);
			proxyCreated = true;
			await checkedCommand(
				runner,
				[dockerBin, "start", proxyName],
				30_000,
				"runtime_isolation_proxy_qualification_failed",
				"The local registry proxy could not be started for qualification.",
			);
			await checkedCommand(
				runner,
				[
					dockerBin,
					"run",
					"--rm",
					"--network",
					networkName,
					"--read-only",
					"--cap-drop",
					"ALL",
					"--security-opt",
					"no-new-privileges",
					"--tmpfs",
					"/tmp:rw,nosuid,nodev,size=32m",
					pinnedRuntimeImage,
					"sh",
					"-ceu",
					`i=0; until test "$(wget -q -T 10 -O - http://${proxyName}:4873/-/vwb/health 2>/dev/null)" = '{"ok":true}'; do i=$((i+1)); test "$i" -lt 10; sleep 1; done; test "$(curl -sS --max-time 10 --max-filesize 1024 -X GET http://${proxyName}:4873/-/vwb/health)" = '{"ok":true}'; wget -q -T 30 -O - http://${proxyName}:4873/is-number | grep -q '"name":"is-number"'`,
				],
				60_000,
				"runtime_isolation_proxy_qualification_failed",
				"The local registry proxy failed its network qualification.",
			);
		} finally {
			if (proxyCreated) {
				await bestEffortCommand(runner, [dockerBin, "rm", "-f", proxyName]);
			}
			if (networkCreated) {
				await bestEffortCommand(runner, [
					dockerBin,
					"network",
					"rm",
					networkName,
				]);
			}
		}

		const qualificationHash = sha256(
			JSON.stringify({
				schemaVersion: 1,
				contract: "vuln-workbench-local-runtime-v1",
				baseImage: baseImageIdentity,
				dockerDaemonIdentityHash,
				image: pinnedRuntimeImage,
				platform: `${imageOs}/${imageArchitecture}`,
				checks: [
					"pinned-image",
					"toolchain",
					"registry-proxy",
					"http-executor",
				],
			}),
		);

		await checkedCommand(
			runner,
			[dockerBin, "tag", pinnedRuntimeImage, RUNTIME_IMAGE_LOCAL_TAG],
			30_000,
			"runtime_isolation_local_image_tag_failed",
			"The qualified isolated runtime image could not be registered locally.",
		);

		return RuntimeIsolationSettingsSchema.parse({
			...RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation,
			namespaceOwnerImage: pinnedRuntimeImage,
			nodeImage: pinnedRuntimeImage,
			materializerImage: pinnedRuntimeImage,
			registryProxyImage: pinnedRuntimeImage,
			probeImage: pinnedRuntimeImage,
			httpExecutorImage: pinnedRuntimeImage,
			dockerDaemonIdentityHash,
			qualificationHash,
		});
	} finally {
		await bestEffortCommand(runner, [
			dockerBin,
			"image",
			"rm",
			temporaryImageTag,
		]);
	}
}

async function inspectBaseImage(
	runner: RuntimeIsolationAutoConfigRunner,
	dockerBin: string,
	imageTag: string,
	allowedDigestPattern: RegExp,
): Promise<string | null> {
	let result: BoundedProcessResult;
	try {
		result = await runner(
			[
				dockerBin,
				"image",
				"inspect",
				"--format",
				"{{json .RepoDigests}}",
				imageTag,
			],
			{ timeoutMs: 30_000, outputLimitBytes: OUTPUT_LIMIT_BYTES },
		);
	} catch {
		return null;
	}
	if (result.exitCode !== 0 || result.terminationReason) return null;
	try {
		const digests = JSON.parse(result.stdout.trim());
		if (!Array.isArray(digests)) return null;
		return (
			digests.find(
				(value): value is string =>
					typeof value === "string" && allowedDigestPattern.test(value),
			) ?? null
		);
	} catch {
		return null;
	}
}

async function checkedCommand(
	runner: RuntimeIsolationAutoConfigRunner,
	argv: string[],
	timeoutMs: number,
	code: string,
	message: string,
	status: 409 | 503 = 409,
): Promise<BoundedProcessResult> {
	let result: BoundedProcessResult;
	try {
		result = await runner(argv, {
			timeoutMs,
			outputLimitBytes: OUTPUT_LIMIT_BYTES,
		});
	} catch {
		throw new RuntimeIsolationAutoConfigError(code, message, status);
	}
	if (result.exitCode !== 0 || result.terminationReason) {
		throw new RuntimeIsolationAutoConfigError(code, message, status);
	}
	return result;
}

async function bestEffortCommand(
	runner: RuntimeIsolationAutoConfigRunner,
	argv: string[],
): Promise<void> {
	try {
		await runner(argv, {
			timeoutMs: 30_000,
			outputLimitBytes: OUTPUT_LIMIT_BYTES,
		});
	} catch {
		// Qualification cleanup must not replace the original actionable error.
	}
}

async function defaultRunner(
	argv: string[],
	options: { timeoutMs: number; outputLimitBytes: number },
): Promise<BoundedProcessResult> {
	return await runBoundedProcess({
		argv,
		...options,
		env: getCleanEnv(),
	});
}

function sha256(value: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
