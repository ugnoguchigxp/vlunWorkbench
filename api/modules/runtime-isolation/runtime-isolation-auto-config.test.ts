import { describe, expect, it, vi } from "vitest";
import type { BoundedProcessResult } from "../processes/bounded-process-runner";
import {
	autoConfigureLocalRuntimeIsolation,
	mergeAutoConfiguredRuntimeIsolationSettings,
	type RuntimeIsolationAutoConfigRunner,
} from "./runtime-isolation-auto-config";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function result(
	stdout = "",
	exitCode: number | null = 0,
): BoundedProcessResult {
	return {
		exitCode,
		stdout,
		stderr: exitCode === 0 ? "" : "failed",
		terminationReason: null,
	};
}

function successfulRunner() {
	const calls: string[][] = [];
	const runner: RuntimeIsolationAutoConfigRunner = async (argv) => {
		calls.push(argv);
		if (argv[1] === "info") {
			return result("daemon-id\t29.5.0\tlinux\tarm64\toverlayfs\t2\n");
		}
		if (argv.includes("{{json .RepoDigests}}")) {
			return result(JSON.stringify([`node@${digest("a")}`]));
		}
		if (argv.includes("{{.Id}}\t{{.Os}}\t{{.Architecture}}")) {
			return result(`${digest("b")}\tlinux\tarm64\n`);
		}
		return result();
	};
	return { runner, calls };
}

describe("autoConfigureLocalRuntimeIsolation", () => {
	it("preserves optional image settings while replacing auto-configured fields", () => {
		const current = {
			namespaceOwnerImage: "",
			nodeImage: "",
			materializerImage: "",
			registryProxyImage: "",
			probeImage: "",
			httpExecutorImage: "",
			dockerDaemonIdentityHash: "",
			qualificationHash: "",
			postgresImage: `postgres@${digest("a")}`,
			mysqlImage: "",
			nucleiImage: "",
			zapImage: "",
			schemathesisImage: "",
		};
		const autoConfigured = {
			...current,
			namespaceOwnerImage: `runtime@${digest("b")}`,
			postgresImage: "",
		};

		expect(
			mergeAutoConfiguredRuntimeIsolationSettings(current, autoConfigured),
		).toMatchObject({
			namespaceOwnerImage: `runtime@${digest("b")}`,
			postgresImage: `postgres@${digest("a")}`,
		});
	});

	it("builds, qualifies, and returns an all-required digest-pinned configuration", async () => {
		const { runner, calls } = successfulRunner();
		const shortId = "f".repeat(12);
		const settings = await autoConfigureLocalRuntimeIsolation({
			runner,
			repositoryRoot: "/workspace",
			idFactory: () => "f".repeat(80),
		});

		const pinnedImage = `vuln-workbench-runtime@${digest("b")}`;
		expect(settings).toMatchObject({
			namespaceOwnerImage: pinnedImage,
			nodeImage: pinnedImage,
			materializerImage: pinnedImage,
			registryProxyImage: pinnedImage,
			probeImage: pinnedImage,
			httpExecutorImage: pinnedImage,
		});
		expect(settings.dockerDaemonIdentityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(settings.qualificationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(calls).toContainEqual(
			expect.arrayContaining([
				"build",
				`BASE_IMAGE=node@${digest("a")}`,
				"/workspace/docker/runtime/Dockerfile",
			]),
		);
		expect(calls).toContainEqual([
			"docker",
			"rm",
			"-f",
			`vwb-runtime-qualification-${shortId}-proxy`,
		]);
		expect(calls).toContainEqual([
			"docker",
			"network",
			"rm",
			`vwb-runtime-qualification-${shortId}`,
		]);
		expect(calls).toContainEqual([
			"docker",
			"tag",
			pinnedImage,
			"vuln-workbench-runtime:local",
		]);
		expect(calls.at(-1)).toEqual([
			"docker",
			"image",
			"rm",
			`vuln-workbench-runtime:qualification-${shortId}`,
		]);
	});

	it("reuses the verified project dynamic image when the official Node image is absent", async () => {
		const calls: string[][] = [];
		const runner: RuntimeIsolationAutoConfigRunner = async (argv) => {
			calls.push(argv);
			if (argv[1] === "info") {
				return result("daemon-id\t29.5.0\tlinux\tarm64\toverlayfs\t2\n");
			}
			if (argv.includes("{{json .RepoDigests}}")) {
				return argv.at(-1) === "node:22-alpine"
					? result("", 1)
					: result(
							JSON.stringify([
								`vuln-workbench-dynamic@${digest("c")}`,
							]),
						);
			}
			if (argv.includes("{{.Id}}\t{{.Os}}\t{{.Architecture}}")) {
				return result(`${digest("b")}\tlinux\tarm64\n`);
			}
			return result();
		};

		await autoConfigureLocalRuntimeIsolation({
			runner,
			repositoryRoot: "/workspace",
			idFactory: () => "fallback",
		});

		expect(calls).toContainEqual(
			expect.arrayContaining([
				"build",
				"BASE_IMAGE=vuln-workbench-dynamic:local",
			]),
		);
		expect(calls.some((argv) => argv[1] === "pull")).toBe(false);
	});

	it("cleans temporary Docker resources and returns no settings after qualification failure", async () => {
		const { runner: baseRunner, calls } = successfulRunner();
		const runner: RuntimeIsolationAutoConfigRunner = async (argv, options) => {
			if (argv.some((value) => value.includes("/-/vwb/health"))) {
				calls.push(argv);
				return result("", 1);
			}
			return await baseRunner(argv, options);
		};

		await expect(
			autoConfigureLocalRuntimeIsolation({
				runner,
				repositoryRoot: "/workspace",
				idFactory: () => "cleanup",
			}),
		).rejects.toMatchObject({
			code: "runtime_isolation_proxy_qualification_failed",
		});
		expect(calls).toContainEqual([
			"docker",
			"rm",
			"-f",
			"vwb-runtime-qualification-cleanup-proxy",
		]);
		expect(calls).toContainEqual([
			"docker",
			"network",
			"rm",
			"vwb-runtime-qualification-cleanup",
		]);
		expect(calls.at(-1)).toEqual([
			"docker",
			"image",
			"rm",
			"vuln-workbench-runtime:qualification-cleanup",
		]);
	});

	it("reports Docker unavailability without attempting a build", async () => {
		const runner = vi.fn().mockResolvedValue(result("", 1));

		await expect(
			autoConfigureLocalRuntimeIsolation({ runner }),
		).rejects.toMatchObject({
			code: "runtime_isolation_docker_unavailable",
			status: 503,
		});
		expect(runner).toHaveBeenCalledOnce();
	});
});
