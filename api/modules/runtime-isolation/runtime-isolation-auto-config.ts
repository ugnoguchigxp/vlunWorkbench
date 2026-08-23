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

const BASE_IMAGE_TAG = "node:22-bookworm-slim";
const BUN_IMAGE_TAG = "oven/bun:1.3.14";
const LOCAL_FALLBACK_BASE_IMAGE_TAG = "vuln-workbench-dynamic:local";
const RUNTIME_IMAGE_LOCAL_TAG = "vuln-workbench-runtime:local";
const RUNTIME_IMAGE_REPOSITORY = "vuln-workbench-runtime";
const RUNTIME_IMAGE_TITLE_LABEL =
	"org.opencontainers.image.title=vuln-workbench isolated runtime";
/** Mutable tags are used only by this admin-triggered preparation operation.
 * They are replaced with Docker content IDs before settings are persisted. */
const SCANNER_IMAGE_TAGS = {
	nuclei: "projectdiscovery/nuclei:latest",
	zap: "zaproxy/zap-stable:latest",
	schemathesis: "schemathesis/schemathesis:stable",
} as const;
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OFFICIAL_NODE_IMAGE_PATTERN =
	/^(?:(?:docker\.io\/)?library\/)?node@sha256:[a-f0-9]{64}$/;
const OFFICIAL_BUN_IMAGE_PATTERN =
	/^(?:(?:docker\.io\/)?oven\/)?bun@sha256:[a-f0-9]{64}$/;
const LOCAL_DYNAMIC_IMAGE_PATTERN =
	/^vuln-workbench-dynamic@sha256:[a-f0-9]{64}$/;
const QUALIFICATION_RESOURCE_ARGS = [
	"--memory",
	"512m",
	"--memory-swap",
	"512m",
	"--cpus",
	"1",
	"--pids-limit",
	"128",
] as const;

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
		nucleiImage: autoConfigured.nucleiImage || current.nucleiImage,
		zapImage: autoConfigured.zapImage || current.zapImage,
		schemathesisImage:
			autoConfigured.schemathesisImage || current.schemathesisImage,
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

export async function pruneStaleLocalRuntimeImages(
	params: {
		dockerBin?: string;
		runner?: RuntimeIsolationAutoConfigRunner;
	} = {},
): Promise<boolean> {
	return await cleanupCommand(params.runner ?? defaultRunner, [
		params.dockerBin ?? "docker",
		"image",
		"prune",
		"--force",
		"--filter",
		"dangling=true",
		"--filter",
		`label=${RUNTIME_IMAGE_TITLE_LABEL}`,
	]);
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
	let bunImageIdentity = await inspectBaseImage(
		runner,
		dockerBin,
		BUN_IMAGE_TAG,
		OFFICIAL_BUN_IMAGE_PATTERN,
	);
	if (!bunImageIdentity) {
		await checkedCommand(
			runner,
			[dockerBin, "pull", BUN_IMAGE_TAG],
			10 * 60_000,
			"runtime_isolation_bun_image_pull_failed",
			"The fixed Bun image for the local isolated runtime could not be downloaded.",
		);
		bunImageIdentity = await inspectBaseImage(
			runner,
			dockerBin,
			BUN_IMAGE_TAG,
			OFFICIAL_BUN_IMAGE_PATTERN,
		);
	}
	if (!bunImageIdentity) {
		throw new RuntimeIsolationAutoConfigError(
			"runtime_isolation_bun_image_digest_unavailable",
			"Docker could not resolve the Bun image to a fixed digest.",
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
			`BASE_IMAGE=${baseImageIdentity}`,
			"--build-arg",
			`BUN_IMAGE=${bunImageIdentity}`,
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

	let configuredSettings: RuntimeIsolationSettings | null = null;
	let imageCleanupReady = true;
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
		const pinnedRuntimeImage = imageId;
		if (!SHA256_PATTERN.test(pinnedRuntimeImage)) {
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
				...QUALIFICATION_RESOURCE_ARGS,
				"--tmpfs",
				"/tmp:rw,nosuid,nodev,size=32m",
				"--user",
				"1000:1000",
				pinnedRuntimeImage,
				"sh",
				"-ceu",
				'command -v node; command -v npm; command -v bun; command -v bunx; test -L "$(command -v bunx)"; test "$(readlink "$(command -v bunx)")" = "/usr/local/bin/bun"; test "$(readlink /opt/vuln-workbench-bun-bin/node)" = "/usr/local/bin/bun"; test "$(PATH=/opt/vuln-workbench-bun-bin:$PATH node -e "process.stdout.write(typeof Bun)")" = "object"; test "$(bun --version)" = "1.3.14"; command -v sh; command -v wget; command -v curl; command -v cp; command -v chmod; command -v sleep; test "$(id -u)" = 1000',
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
				...QUALIFICATION_RESOURCE_ARGS,
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
		let networkQualificationComplete = false;
		let networkCleanupReady = true;
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
					...QUALIFICATION_RESOURCE_ARGS,
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
					...QUALIFICATION_RESOURCE_ARGS,
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
					...QUALIFICATION_RESOURCE_ARGS,
					"--user",
					"1000:1000",
					"--tmpfs",
					"/runtime-work:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
					"--tmpfs",
					"/runtime-home:rw,nosuid,nodev,size=64m,uid=1000,gid=1000",
					"--workdir",
					"/runtime-work",
					"--env",
					"HOME=/runtime-home",
					pinnedRuntimeImage,
					"sh",
					"-ceu",
					bunAdapterQualificationScript(`http://${proxyName}:4873`),
				],
				60_000,
				"runtime_isolation_bun_adapter_qualification_failed",
				"The local isolated runtime failed its Bun dependency adapter qualification.",
			);
			networkQualificationComplete = true;
		} finally {
			if (proxyCreated) {
				networkCleanupReady =
					(await cleanupCommand(runner, [dockerBin, "rm", "-f", proxyName])) &&
					networkCleanupReady;
			}
			if (networkCreated) {
				networkCleanupReady =
					(await cleanupCommand(runner, [
						dockerBin,
						"network",
						"rm",
						networkName,
					])) && networkCleanupReady;
			}
		}
		if (networkQualificationComplete && !networkCleanupReady) {
			throw new RuntimeIsolationAutoConfigError(
				"runtime_isolation_qualification_cleanup_failed",
				"The temporary runtime qualification resources could not be removed.",
			);
		}

		const qualificationHash = sha256(
			JSON.stringify({
				schemaVersion: 2,
				contract: "vuln-workbench-local-runtime-v2",
				baseImage: baseImageIdentity,
				bunImage: bunImageIdentity,
				dockerDaemonIdentityHash,
				image: pinnedRuntimeImage,
				platform: `${imageOs}/${imageArchitecture}`,
				checks: [
					"pinned-image",
					"toolchain",
					"registry-proxy",
					"bun-dependency-adapter",
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

		const scannerImages = await prepareRuntimeScannerImages(runner, dockerBin);
		configuredSettings = RuntimeIsolationSettingsSchema.parse({
			...RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation,
			qualificationVersion: 2,
			namespaceOwnerImage: pinnedRuntimeImage,
			nodeImage: pinnedRuntimeImage,
			materializerImage: pinnedRuntimeImage,
			registryProxyImage: pinnedRuntimeImage,
			probeImage: pinnedRuntimeImage,
			httpExecutorImage: pinnedRuntimeImage,
			dockerDaemonIdentityHash,
			qualificationHash,
			...scannerImages,
		});
	} finally {
		imageCleanupReady = await cleanupCommand(runner, [
			dockerBin,
			"image",
			"rm",
			temporaryImageTag,
		]);
	}
	if (!imageCleanupReady) {
		throw new RuntimeIsolationAutoConfigError(
			"runtime_isolation_qualification_cleanup_failed",
			"The temporary runtime qualification image could not be removed.",
		);
	}
	if (!configuredSettings) throw new Error("runtime_isolation_config_missing");
	return configuredSettings;
}

/** Pulling happens only from the explicit administrator setup action, never
 * during preview or Start. A later run only accepts the saved local image ID. */
async function prepareRuntimeScannerImages(
	runner: RuntimeIsolationAutoConfigRunner,
	dockerBin: string,
): Promise<
	Pick<
		RuntimeIsolationSettings,
		"nucleiImage" | "zapImage" | "schemathesisImage"
	>
> {
	const images = await Promise.all(
		Object.entries(SCANNER_IMAGE_TAGS).map(async ([role, tag]) => {
			await checkedCommand(
				runner,
				[dockerBin, "pull", tag],
				10 * 60_000,
				"runtime_scanner_image_prepare_failed",
				`The required ${role} scanner image could not be prepared.`,
			);
			const inspected = await checkedCommand(
				runner,
				[dockerBin, "image", "inspect", "--format", "{{.Id}}", tag],
				30_000,
				"runtime_scanner_image_identity_invalid",
				`The prepared ${role} scanner image did not have an immutable identity.`,
			);
			const imageId = inspected.stdout.trim();
			if (!SHA256_PATTERN.test(imageId)) {
				throw new RuntimeIsolationAutoConfigError(
					"runtime_scanner_image_identity_invalid",
					`The prepared ${role} scanner image did not have an immutable identity.`,
				);
			}
			return [role, imageId] as const;
		}),
	);
	return {
		nucleiImage: images.find(([role]) => role === "nuclei")?.[1] ?? "",
		zapImage: images.find(([role]) => role === "zap")?.[1] ?? "",
		schemathesisImage:
			images.find(([role]) => role === "schemathesis")?.[1] ?? "",
	};
}

function bunAdapterQualificationScript(registryUrl: string): string {
	const packageJson = JSON.stringify({
		name: "vwb-bun-qualification",
		dependencies: { "is-number": "7.0.0" },
	});
	const bunLock = JSON.stringify({
		lockfileVersion: 1,
		workspaces: {
			"": {
				name: "vwb-bun-qualification",
				dependencies: { "is-number": "7.0.0" },
			},
		},
		packages: {
			"is-number": [
				"is-number@7.0.0",
				"",
				{},
				"sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
			],
		},
	});
	return [
		`printf '%s' '${packageJson}' > package.json`,
		`printf '%s' '${bunLock}' > bun.lock`,
		`bun install --frozen-lockfile --ignore-scripts --no-progress --no-save --backend=copyfile --registry '${registryUrl}'`,
		"test -f node_modules/is-number/index.js",
	].join("; ");
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

async function cleanupCommand(
	runner: RuntimeIsolationAutoConfigRunner,
	argv: string[],
): Promise<boolean> {
	try {
		const result = await runner(argv, {
			timeoutMs: 30_000,
			outputLimitBytes: OUTPUT_LIMIT_BYTES,
		});
		return result.exitCode === 0 && result.terminationReason === null;
	} catch {
		// Qualification cleanup must not replace the original actionable error.
		return false;
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
