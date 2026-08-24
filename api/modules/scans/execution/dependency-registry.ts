import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import manifestJson from "../../../../shared/manifests/scan-dependencies.v1.json";
import { scanDependencyManifestSchema } from "../../../../shared/schemas/scan-dependency-manifest.schema";
import { getCleanEnv, runToolProcess } from "../tools/tool-process-runner";
import {
	type DockerProbeCommandRunner,
	inspectDockerImageWithRecovery,
} from "./docker-image-preflight-probe";

const manifest = scanDependencyManifestSchema.parse(manifestJson);
const PROBE_OUTPUT_LIMIT = 4096;

export type DependencyProbeResult = {
	id: string;
	ready: boolean;
	reasonCode: string | null;
};

type CommandRunner = DockerProbeCommandRunner;

function imageRefForEntry(params: {
	configurationSource: (typeof manifest.entries)[number]["configurationSource"];
	settings: Record<string, string | undefined>;
}): string | null {
	if (params.configurationSource.kind === "runtime_setting") {
		return params.settings[params.configurationSource.settingKey] ?? null;
	}
	if (
		params.configurationSource.kind === "built_in" &&
		params.configurationSource.valueRef === "ZAP_STABLE_IMAGE"
	) {
		return "zaproxy/zap-stable@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2";
	}
	return null;
}

function validConfiguredImageRef(params: {
	image: string;
	configurationSource: (typeof manifest.entries)[number]["configurationSource"];
}): boolean {
	if (
		params.configurationSource.kind === "runtime_setting" &&
		(params.configurationSource.settingKey === "SCAN_DOCKER_IMAGE" ||
			params.configurationSource.settingKey ===
				"VULN_WORKBENCH_MAVEN_RESOLVER_IMAGE")
	) {
		return /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,511}$/.test(params.image);
	}
	return /@sha256:[a-f0-9]{64}$/.test(params.image);
}

/**
 * Local-image admission probe. It never pulls, builds, or starts a container.
 * Resource Saver recovery may create and immediately remove one without
 * starting it.
 */
export async function probeDependency(params: {
	id: string;
	settings?: Record<string, string | undefined>;
	run?: CommandRunner;
	workspacePath?: string;
}): Promise<DependencyProbeResult> {
	const entry = manifest.entries.find(
		(candidate) => candidate.id === params.id,
	);
	if (!entry)
		return {
			id: params.id,
			ready: false,
			reasonCode: "dependency_definition_missing",
		};
	const run =
		params.run ??
		(async (command, args, timeoutSec = 10) => {
			return await runToolProcess(command, args, {
				execution: { runner: "host" },
				timeoutSec,
				outputLimits: {
					stdoutBytes: PROBE_OUTPUT_LIMIT,
					stderrBytes: PROBE_OUTPUT_LIMIT,
				},
				env: getCleanEnv(),
			});
		});
	if (entry.probeId === "docker_daemon_info") {
		const result = await run("docker", ["info"]);
		return {
			id: entry.id,
			ready: result.exitCode === 0,
			reasonCode: result.exitCode === 0 ? null : "docker_daemon_unavailable",
		};
	}
	if (entry.probeId === "host_binary_version") {
		const binary =
			entry.configurationSource.kind === "built_in"
				? entry.configurationSource.valueRef
				: null;
		if (!binary) {
			return {
				id: entry.id,
				ready: false,
				reasonCode: "host_binary_unavailable",
			};
		}
		const result = await run(binary, ["--version"]);
		return {
			id: entry.id,
			ready: result.exitCode === 0,
			reasonCode: result.exitCode === 0 ? null : "host_binary_unavailable",
		};
	}
	if (entry.probeId === "container_image_inspect") {
		const image = imageRefForEntry({
			configurationSource: entry.configurationSource,
			settings: params.settings ?? {},
		});
		if (
			!image ||
			!validConfiguredImageRef({
				image,
				configurationSource: entry.configurationSource,
			})
		) {
			return {
				id: entry.id,
				ready: false,
				reasonCode: "docker_image_unavailable",
			};
		}
		const result = await inspectDockerImageWithRecovery("docker", image, run);
		return {
			id: entry.id,
			ready: result.available,
			reasonCode: result.reasonCode,
		};
	}
	if (entry.probeId === "filesystem_read_write") {
		if (!params.workspacePath)
			return {
				id: entry.id,
				ready: false,
				reasonCode: "workspace_unavailable",
			};
		try {
			const stat = await fs.stat(params.workspacePath);
			await fs.access(
				params.workspacePath,
				fsConstants.R_OK | fsConstants.W_OK,
			);
			return {
				id: entry.id,
				ready: stat.isDirectory(),
				reasonCode: stat.isDirectory() ? null : "workspace_unavailable",
			};
		} catch {
			return {
				id: entry.id,
				ready: false,
				reasonCode: "workspace_unavailable",
			};
		}
	}
	if (entry.probeId === "network_port_lease")
		return {
			id: entry.id,
			ready: false,
			reasonCode: "resource_probe_deferred",
		};
	return {
		id: entry.id,
		ready: false,
		reasonCode: "dependency_probe_not_implemented",
	};
}

export function dependencyRequirementsFor(ids: readonly string[]) {
	return manifest.entries.filter((entry) => ids.includes(entry.id));
}
