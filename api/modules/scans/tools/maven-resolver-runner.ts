import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../execution/lifecycle/artifact-storage";
import { cleanupTemporaryPaths } from "../execution/lifecycle/temporary-path-cleanup";
import {
	loadMavenResolutionConfig,
	type ResolvedMavenResolutionConfig,
} from "../maven/maven-resolution-config";
import { resolveDockerToolCacheDirectory } from "./docker-tool-process-runner";
import {
	getCleanEnv,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

export const MAVEN_VERSION = "3.9.16";
export const CYCLONEDX_MAVEN_PLUGIN_VERSION = "2.9.3";
export const MAVEN_CENTRAL_URL = "https://repo.maven.apache.org/maven2";

export type MavenResolutionReceipt = {
	schemaVersion: 1;
	status: "completed" | "failed";
	sourceDigest: string;
	configDigest: string;
	resolverImage: string;
	resolverImageId: string | null;
	resolverImageDigest: string | null;
	mavenVersion: string;
	cycloneDxPluginVersion: string;
	registries: string[];
	networkPolicy: {
		mode: "maven_central_proxy";
		allowedMethods: ["GET", "HEAD"];
		upstream: string;
	};
	modelEnvironmentKeys: string[];
	localArtifacts: Array<{
		coordinate: string;
		sha256: string;
	}>;
	componentCounts: { total: number; direct: number; transitive: number };
	unresolvedCoordinates: string[];
	sbomDigest: string | null;
};

export type MavenResolverResult = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	error?: string;
	sbomPath?: string;
	sbom?: unknown;
	sbomArtifact?: ArtifactSaveResult;
	receiptArtifact?: ArtifactSaveResult;
	receipt: MavenResolutionReceipt;
	executionMetadata?: Record<string, unknown>;
	cleanup?: () => Promise<void>;
};

export async function resolveMavenDependencies(params: {
	scanRunId: string;
	repoPath: string;
	storage?: ArtifactStorage;
	execution: ToolExecutionConfig;
	resolverImage: string;
	resolverImageId: string;
	resolverImageDigest?: string | null;
	expectedConfigDigest?: string;
	expectedSourceDigest?: string;
	mavenResolutionConfig?: unknown;
	timeoutSec?: number;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}): Promise<MavenResolverResult> {
	if (params.execution.runner !== "docker") {
		throw new Error("maven_registry_resolution_requires_docker");
	}
	if (!/^sha256:[a-f0-9]{64}$/.test(params.resolverImageId)) {
		throw new Error("maven_resolver_image_id_invalid");
	}
	const admittedConfig = await loadMavenResolutionConfig(
		params.repoPath,
		params.mavenResolutionConfig,
	);
	if (
		params.expectedConfigDigest &&
		params.expectedConfigDigest !== admittedConfig.configDigest
	) {
		throw new Error(
			"maven_resolution_config_changed: Maven resolver config changed after preflight.",
		);
	}
	if (
		params.expectedSourceDigest &&
		params.expectedSourceDigest !== admittedConfig.sourceDigest
	) {
		throw new Error(
			"maven_resolution_source_changed: Maven reactor inputs changed after preflight.",
		);
	}
	if (params.execution.docker?.toolCacheDir) {
		await assertCacheOutsideRepository(
			resolveDockerToolCacheDirectory(params.execution.docker.toolCacheDir),
			params.repoPath,
		);
	}
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "maven-resolver-"));
	let temporaryCacheRoot: string | null = null;
	let scanCacheRoot: string | null = null;
	try {
		temporaryCacheRoot = params.execution.docker?.toolCacheDir
			? null
			: await fs.mkdtemp(path.join(os.tmpdir(), "maven-resolver-cache-"));
	} catch (error) {
		await cleanupTemporaryPaths([tempDir], "maven_resolver_cleanup_failed");
		throw error;
	}
	const toolCacheRoot =
		params.execution.docker?.toolCacheDir ?? temporaryCacheRoot;
	try {
		if (!toolCacheRoot) throw new Error("maven_resolver_cache_unavailable");
		await assertCacheOutsideRepository(
			resolveDockerToolCacheDirectory(toolCacheRoot),
			params.repoPath,
		);
		const sourceWorkspace = path.join(tempDir, "source");
		const config = await materializeMavenResolutionInputs({
			repositoryPath: params.repoPath,
			destinationPath: sourceWorkspace,
			admittedConfig,
		});
		const canonicalSourceWorkspace = await fs.realpath(sourceWorkspace);
		// Maven's local repository is writable by the isolated resolver. Give every
		// scan run a fresh namespace so concurrent scans and retries cannot consume
		// files left by another resolver process, even for identical source input.
		const cacheKey = crypto
			.createHash("sha256")
			.update(`${config.sourceDigest}\0${params.scanRunId}`)
			.digest("hex")
			.slice(0, 24);
		const mountedCacheRoot = resolveDockerToolCacheDirectory(toolCacheRoot);
		scanCacheRoot = path.join(mountedCacheRoot, "maven", cacheKey);
		await assertCacheOutsideRepository(scanCacheRoot, params.repoPath);
		await fs.rm(scanCacheRoot, { recursive: true, force: true });
		const hostLocalRepository = path.join(scanCacheRoot, "repository");
		const containerLocalRepository = `/workspace/cache/maven/${cacheKey}/repository`;
		const settingsPath = path.join(tempDir, "settings.xml");
		const sbomPath = path.join(tempDir, "maven-resolved.cdx.json");
		const resolverExecution: ToolExecutionConfig = {
			...params.execution,
			runner: "docker",
			docker: {
				...params.execution.docker,
				// Prefer the image ID recorded by preflight so a mutable local tag
				// cannot change the resolver between admission and execution.
				image: params.resolverImageId,
				networkMode: "none",
				runtimeNamespaceOwnerId: undefined,
				toolCacheDir: toolCacheRoot,
			},
		};

		await fs.mkdir(hostLocalRepository, { recursive: true });
		await assertCacheOutsideRepository(hostLocalRepository, params.repoPath);
		await seedLocalArtifacts(hostLocalRepository, config);
		await makeDirectoriesWritableByResolver(
			path.join(mountedCacheRoot, "maven", cacheKey),
		);
		await fs.writeFile(settingsPath, mavenCentralOnlySettings());

		const baseReceipt: MavenResolutionReceipt = {
			schemaVersion: 1,
			status: "failed",
			sourceDigest: config.sourceDigest,
			configDigest: config.configDigest,
			resolverImage: params.resolverImage,
			resolverImageId: params.resolverImageId,
			resolverImageDigest: params.resolverImageDigest ?? null,
			mavenVersion: MAVEN_VERSION,
			cycloneDxPluginVersion: CYCLONEDX_MAVEN_PLUGIN_VERSION,
			registries: [MAVEN_CENTRAL_URL],
			networkPolicy: {
				mode: "maven_central_proxy",
				allowedMethods: ["GET", "HEAD"],
				upstream: MAVEN_CENTRAL_URL,
			},
			modelEnvironmentKeys: Object.keys(config.config.modelEnvironment).sort(),
			localArtifacts: config.localArtifacts.map((artifact) => ({
				coordinate: `${artifact.groupId}:${artifact.artifactId}:${artifact.packaging}:${artifact.version}`,
				sha256: artifact.actualSha256,
			})),
			componentCounts: { total: 0, direct: 0, transitive: 0 },
			unresolvedCoordinates: [],
			sbomDigest: null,
		};

		const args = [
			"--batch-mode",
			"--no-transfer-progress",
			"--settings",
			settingsPath,
			"-f",
			config.rootPomPath,
			`-Dmaven.repo.local=${containerLocalRepository}`,
			...Object.entries(config.config.modelEnvironment)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, value]) => `-Denv.${key}=${value}`),
			"-DskipTests=true",
			"-DschemaVersion=1.6",
			"-DoutputFormat=json",
			"-DoutputName=maven-resolved.cdx",
			"-DoutputDirectory=/workspace/out",
			"-DincludeTestScope=true",
			"-DincludeBomSerialNumber=false",
			"-DoutputReactorProjects=false",
			"-Dcyclonedx.skipAttach=true",
			`org.cyclonedx:cyclonedx-maven-plugin:${CYCLONEDX_MAVEN_PLUGIN_VERSION}:makeAggregateBom`,
		];
		const networkBoundary = await startMavenCentralNetworkBoundary({
			dockerBin: params.execution.docker?.dockerBin ?? "docker",
			resolverImageId: params.resolverImageId,
			scanRunId: params.scanRunId,
		});
		resolverExecution.docker = {
			...resolverExecution.docker,
			runtimeNamespaceOwnerId: networkBoundary.ownerName,
		};
		const startedAt = Date.now();
		let processResult: Awaited<ReturnType<typeof runToolProcess>>;
		try {
			processResult = await runToolProcess("mvn", args, {
				timeoutSec: params.timeoutSec ?? 1_800,
				execution: resolverExecution,
				repoPath: canonicalSourceWorkspace,
				inputPaths: [settingsPath],
				outputPath: sbomPath,
				onLifecycleEvent: params.onLifecycleEvent,
			});
		} finally {
			await networkBoundary.cleanup();
		}
		const elapsedMs = Date.now() - startedAt;
		let receipt = {
			...baseReceipt,
			unresolvedCoordinates: extractUnresolvedCoordinates(
				`${processResult.stdout}\n${processResult.stderr}`,
			),
		};

		if (!processResult.ok || processResult.exitCode !== 0) {
			const receiptArtifact = await saveReceipt(params, receipt);
			await cleanupTemporaryPaths(
				[tempDir, temporaryCacheRoot ?? scanCacheRoot],
				"maven_resolver_cleanup_failed",
			);
			return {
				ok: false,
				exitCode: processResult.exitCode,
				stdout: processResult.stdout,
				stderr: processResult.stderr,
				elapsedMs,
				error:
					processResult.error ??
					"maven_dependency_resolution_failed: Maven could not produce the resolved SBOM",
				receipt,
				receiptArtifact,
				executionMetadata: processResult.executionMetadata,
			};
		}

		let sbom: unknown;
		try {
			sbom = JSON.parse(await fs.readFile(sbomPath, "utf8"));
			assertCycloneDxBom(sbom);
		} catch (error) {
			const failed = {
				...receipt,
				unresolvedCoordinates: [],
			};
			const receiptArtifact = await saveReceipt(params, failed);
			await cleanupTemporaryPaths(
				[tempDir, temporaryCacheRoot ?? scanCacheRoot],
				"maven_resolver_cleanup_failed",
			);
			return {
				ok: false,
				exitCode: processResult.exitCode,
				stdout: processResult.stdout,
				stderr: processResult.stderr,
				elapsedMs,
				error: `maven_resolved_sbom_invalid: ${error instanceof Error ? error.message : String(error)}`,
				receipt: failed,
				receiptArtifact,
				executionMetadata: processResult.executionMetadata,
			};
		}

		const sbomBytes = await fs.readFile(sbomPath);
		const counts = componentCounts(sbom);
		receipt = {
			...receipt,
			status: "completed",
			componentCounts: counts,
			unresolvedCoordinates: [],
			sbomDigest: sha256(sbomBytes),
		};
		const sbomArtifact = params.storage
			? await params.storage.saveFileArtifact(
					params.scanRunId,
					"sbom",
					sbomPath,
					"maven-resolved.cdx.json",
				)
			: undefined;
		const receiptArtifact = await saveReceipt(params, receipt);
		return {
			ok: true,
			exitCode: processResult.exitCode,
			stdout: processResult.stdout,
			stderr: processResult.stderr,
			elapsedMs,
			sbomPath,
			sbom,
			sbomArtifact,
			receiptArtifact,
			receipt,
			executionMetadata: processResult.executionMetadata,
			cleanup: async () => {
				await cleanupTemporaryPaths(
					[tempDir, temporaryCacheRoot ?? scanCacheRoot],
					"maven_resolver_cleanup_failed",
				);
			},
		};
	} catch (error) {
		await cleanupTemporaryPaths(
			[tempDir, temporaryCacheRoot ?? scanCacheRoot],
			"maven_resolver_cleanup_failed",
		);
		throw error;
	}
}

async function materializeMavenResolutionInputs(params: {
	repositoryPath: string;
	destinationPath: string;
	admittedConfig: ResolvedMavenResolutionConfig;
}): Promise<ResolvedMavenResolutionConfig> {
	const repositoryRoot = await fs.realpath(params.repositoryPath);
	await fs.mkdir(path.join(params.destinationPath, ".vuln-workbench"), {
		recursive: true,
	});
	await fs.writeFile(
		path.join(
			params.destinationPath,
			".vuln-workbench",
			"maven-resolution.v1.json",
		),
		`${JSON.stringify(params.admittedConfig.config, null, 2)}\n`,
	);
	for (const pomPath of params.admittedConfig.inspectedPomPaths) {
		const relativePath = path.relative(repositoryRoot, pomPath);
		const destination = path.join(params.destinationPath, relativePath);
		await fs.mkdir(path.dirname(destination), { recursive: true });
		await fs.copyFile(pomPath, destination);
	}
	for (const artifact of params.admittedConfig.localArtifacts) {
		const destination = path.join(params.destinationPath, artifact.path);
		await fs.mkdir(path.dirname(destination), { recursive: true });
		await fs.copyFile(artifact.absolutePath, destination);
	}

	const materialized = await loadMavenResolutionConfig(
		params.destinationPath,
		params.admittedConfig.config,
	);
	if (
		materialized.configDigest !== params.admittedConfig.configDigest ||
		materialized.sourceDigest !== params.admittedConfig.sourceDigest
	) {
		throw new Error(
			"maven_resolution_source_changed: Maven reactor inputs changed while creating the isolated snapshot.",
		);
	}
	return materialized;
}

async function seedLocalArtifacts(
	localRepository: string,
	config: ResolvedMavenResolutionConfig,
): Promise<void> {
	for (const artifact of config.localArtifacts) {
		const coordinateDirectory = path.join(
			localRepository,
			...artifact.groupId.split("."),
			artifact.artifactId,
			artifact.version,
		);
		await fs.mkdir(coordinateDirectory, { recursive: true });
		const baseName = `${artifact.artifactId}-${artifact.version}`;
		await fs.copyFile(
			artifact.absolutePath,
			path.join(coordinateDirectory, `${baseName}.jar`),
		);
		await fs.writeFile(
			path.join(coordinateDirectory, `${baseName}.pom`),
			`<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>${escapeXml(artifact.groupId)}</groupId><artifactId>${escapeXml(artifact.artifactId)}</artifactId><version>${escapeXml(artifact.version)}</version><packaging>jar</packaging></project>\n`,
		);
	}
}

async function makeDirectoriesWritableByResolver(root: string): Promise<void> {
	await fs.chmod(root, 0o777).catch(() => undefined);
	const entries = await fs.readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		await makeDirectoriesWritableByResolver(path.join(root, entry.name));
	}
}

function mavenCentralOnlySettings(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0">
  <interactiveMode>false</interactiveMode>
  <mirrors>
    <mirror>
      <id>vuln-workbench-central-only</id>
      <name>Vulnerability Workbench Maven Central boundary</name>
      <url>http://maven-central-proxy:8080/maven2</url>
      <mirrorOf>*</mirrorOf>
    </mirror>
  </mirrors>
</settings>
`;
}

function extractUnresolvedCoordinates(output: string): string[] {
	return [
		...new Set(
			output.match(
				/[A-Za-z0-9_.+-]+:[A-Za-z0-9_.+-]+:(?:jar|pom|war)(?::[A-Za-z0-9_.+-]+)?:[A-Za-z0-9_.+-]+/g,
			) ?? [],
		),
	].sort();
}

function assertCycloneDxBom(
	value: unknown,
): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object")
		throw new Error("SBOM is not an object");
	const record = value as Record<string, unknown>;
	if (record.bomFormat !== "CycloneDX" || !Array.isArray(record.components)) {
		throw new Error("SBOM is not a CycloneDX component inventory");
	}
}

function componentCounts(value: unknown) {
	const bom = value as {
		components?: Array<{ "bom-ref"?: string }>;
		metadata?: { component?: { "bom-ref"?: string } };
		dependencies?: Array<{ ref?: string; dependsOn?: string[] }>;
	};
	const components = bom.components ?? [];
	const rootRef = bom.metadata?.component?.["bom-ref"];
	const directRefs = new Set(
		bom.dependencies?.find((dependency) => dependency.ref === rootRef)
			?.dependsOn ?? [],
	);
	const direct = components.filter((component) =>
		directRefs.has(component["bom-ref"] ?? ""),
	).length;
	return {
		total: components.length,
		direct,
		transitive: Math.max(0, components.length - direct),
	};
}

async function saveReceipt(
	params: Pick<
		Parameters<typeof resolveMavenDependencies>[0],
		"scanRunId" | "storage"
	>,
	receipt: MavenResolutionReceipt,
): Promise<ArtifactSaveResult | undefined> {
	return await params.storage?.saveTextArtifact(
		params.scanRunId,
		"diagnostic",
		`${JSON.stringify(receipt, null, 2)}\n`,
		"maven-resolution-receipt.json",
	);
}

function sha256(value: crypto.BinaryLike): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

async function startMavenCentralNetworkBoundary(params: {
	dockerBin: string;
	resolverImageId: string;
	scanRunId: string;
}): Promise<{ ownerName: string; cleanup: () => Promise<void> }> {
	const boundaryId = crypto.randomUUID();
	const prefix = `vwb-${boundaryId}`;
	const networkName = `${prefix}-maven-internal`;
	const proxyName = `${prefix}-maven-proxy`;
	const ownerName = `${prefix}-owner`;
	let networkCreated = false;
	let proxyCreated = false;
	let ownerCreated = false;
	const label = `com.vuln-workbench.maven-resolution=${params.scanRunId}`;

	const cleanup = async (strict = true) => {
		const results: boolean[] = [];
		if (ownerCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"rm",
				"-f",
				ownerName,
			]);
			results.push(removed);
			if (removed) ownerCreated = false;
		}
		if (proxyCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"rm",
				"-f",
				proxyName,
			]);
			results.push(removed);
			if (removed) proxyCreated = false;
		}
		if (networkCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"network",
				"rm",
				networkName,
			]);
			results.push(removed);
			if (removed) networkCreated = false;
		}
		if (strict && results.some((result) => !result)) {
			throw new Error("maven_resolver_network_cleanup_failed");
		}
	};

	try {
		await runDockerCommand([
			params.dockerBin,
			"network",
			"create",
			"--internal",
			"--label",
			label,
			networkName,
		]);
		networkCreated = true;
		await runDockerCommand([
			params.dockerBin,
			"create",
			"--name",
			proxyName,
			"--network",
			"default",
			"--user",
			"65532:65532",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--memory",
			"256m",
			"--memory-swap",
			"256m",
			"--cpus",
			"0.5",
			"--pids-limit",
			"64",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=64m,uid=65532,gid=65532",
			"--label",
			label,
			"--entrypoint",
			"java",
			params.resolverImageId,
			"-cp",
			"/opt/vuln-workbench",
			"MavenCentralProxy",
		]);
		proxyCreated = true;
		await runDockerCommand([
			params.dockerBin,
			"network",
			"connect",
			"--alias",
			"maven-central-proxy",
			networkName,
			proxyName,
		]);
		await runDockerCommand([params.dockerBin, "start", proxyName]);
		await runDockerCommand([
			params.dockerBin,
			"create",
			"--name",
			ownerName,
			"--network",
			networkName,
			"--user",
			"65532:65532",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--memory",
			"64m",
			"--memory-swap",
			"64m",
			"--cpus",
			"0.25",
			"--pids-limit",
			"32",
			"--label",
			label,
			"--entrypoint",
			"/bin/sleep",
			params.resolverImageId,
			"infinity",
		]);
		ownerCreated = true;
		await runDockerCommand([params.dockerBin, "start", ownerName]);

		let healthy = false;
		for (let attempt = 0; attempt < 20 && !healthy; attempt += 1) {
			healthy = await runDockerCommand(
				[
					params.dockerBin,
					"exec",
					proxyName,
					"java",
					"-cp",
					"/opt/vuln-workbench",
					"MavenCentralProxy",
					"health",
				],
				true,
			);
			if (!healthy) {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		if (!healthy) throw new Error("maven_central_proxy_unhealthy");
		return { ownerName, cleanup: async () => await cleanup(true) };
	} catch (error) {
		await cleanup(false);
		throw error;
	}
}

async function runDockerCleanupCommand(args: string[]): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		if (await runDockerCommand(args, true)) return true;
		if (attempt === 0) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	return false;
}

async function runDockerCommand(
	args: string[],
	allowFailure = false,
): Promise<boolean> {
	let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		process = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
			env: getCleanEnv(),
		});
	} catch (error) {
		if (allowFailure) return false;
		throw new Error(
			`maven_resolver_docker_boundary_failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		process.kill("SIGKILL");
	}, 30_000);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);
		if (!timedOut && exitCode === 0) return true;
		if (allowFailure) return false;
		throw new Error(
			`maven_resolver_docker_boundary_failed: ${timedOut ? "command timed out" : (stderr || stdout).trim().slice(0, 2_000)}`,
		);
	} catch (error) {
		if (allowFailure) return false;
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function isPathInside(childPath: string, parentPath: string): boolean {
	const relative = path.relative(
		path.resolve(parentPath),
		path.resolve(childPath),
	);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

async function assertCacheOutsideRepository(
	cachePath: string,
	repositoryPath: string,
): Promise<void> {
	const [canonicalCache, canonicalRepository] = await Promise.all([
		resolveProspectiveRealpath(cachePath),
		fs.realpath(repositoryPath),
	]);
	if (
		isPathInside(cachePath, repositoryPath) ||
		isPathInside(canonicalCache, canonicalRepository)
	) {
		throw new Error(
			"maven_resolver_cache_inside_target_repository: Maven resolver cache must not be inside the scan target.",
		);
	}
}

async function resolveProspectiveRealpath(
	candidatePath: string,
): Promise<string> {
	let current = path.resolve(candidatePath);
	const missingSegments: string[] = [];
	for (;;) {
		try {
			return path.join(await fs.realpath(current), ...missingSegments);
		} catch (error) {
			if (
				typeof error !== "object" ||
				error === null ||
				!("code" in error) ||
				error.code !== "ENOENT"
			) {
				throw error;
			}
			const parent = path.dirname(current);
			if (parent === current) throw error;
			missingSegments.unshift(path.basename(current));
			current = parent;
		}
	}
}
