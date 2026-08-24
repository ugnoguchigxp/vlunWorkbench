import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import manifestJson from "../../../../shared/manifests/scan-dependencies.v1.json";
import { scanDependencyManifestSchema } from "../../../../shared/schemas/scan-dependency-manifest.schema";

const manifest = scanDependencyManifestSchema.parse(manifestJson);

export type DependencyProbeResult = {
	id: string;
	ready: boolean;
	reasonCode: string | null;
};

type CommandRunner = (
	command: string,
	args: string[],
) => Promise<{ exitCode: number }>;

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
		params.configurationSource.settingKey === "SCAN_DOCKER_IMAGE"
	) {
		return /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,511}$/.test(params.image);
	}
	return /@sha256:[a-f0-9]{64}$/.test(params.image);
}

/**
 * Small, side-effect-free admission probe. It deliberately never pulls an
 * image; a missing image becomes docker_image_unavailable before a run exists.
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
		(async (command, args) => {
			const proc = Bun.spawn([command, ...args], {
				stdout: "ignore",
				stderr: "ignore",
			});
			return { exitCode: await proc.exited };
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
		const result = await run("docker", ["image", "inspect", image]);
		return {
			id: entry.id,
			ready: result.exitCode === 0,
			reasonCode: result.exitCode === 0 ? null : "docker_image_unavailable",
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
