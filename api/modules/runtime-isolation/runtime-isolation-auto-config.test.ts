import { describe, expect, it, vi } from "vitest";
import type { BoundedProcessResult } from "../processes/bounded-process-runner";
import {
	autoConfigureLocalRuntimeIsolation,
	mergeAutoConfiguredRuntimeIsolationSettings,
	pruneStaleLocalRuntimeImages,
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
			return result(
				JSON.stringify([
					argv.at(-1) === "oven/bun:1.3.14"
						? `oven/bun@${digest("c")}`
						: `node@${digest("a")}`,
				]),
			);
		}
		if (argv.includes("{{.Id}}\t{{.Os}}\t{{.Architecture}}")) {
			return result(`${digest("b")}\tlinux\tarm64\n`);
		}
		if (argv.includes("{{.Id}}")) {
			return result(`${digest("e")}\n`);
		}
		return result();
	};
	return { runner, calls };
}

describe("autoConfigureLocalRuntimeIsolation", () => {
	it("prunes only dangling generations of the project runtime image", async () => {
		const runner = vi.fn().mockResolvedValue(result());

		await expect(pruneStaleLocalRuntimeImages({ runner })).resolves.toBe(true);
		expect(runner).toHaveBeenCalledWith(
			[
				"docker",
				"image",
				"prune",
				"--force",
				"--filter",
				"dangling=true",
				"--filter",
				"label=org.opencontainers.image.title=vuln-workbench isolated runtime",
			],
			{ timeoutMs: 30_000, outputLimitBytes: 4 * 1024 * 1024 },
		);
	});

	it("preserves optional image settings while replacing auto-configured fields", () => {
		const current = {
			qualificationVersion: 1 as const,
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
			qualificationVersion: 2 as const,
			namespaceOwnerImage: `runtime@${digest("b")}`,
			postgresImage: "",
		};

		expect(
			mergeAutoConfiguredRuntimeIsolationSettings(current, autoConfigured),
		).toMatchObject({
			qualificationVersion: 2,
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

		const pinnedImage = digest("b");
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
		expect(settings).toMatchObject({
			nucleiImage: digest("e"),
			zapImage: digest("e"),
			schemathesisImage: digest("e"),
		});
		expect(calls).toContainEqual(["docker", "pull", "projectdiscovery/nuclei:latest"]);
		expect(calls).toContainEqual(["docker", "pull", "zaproxy/zap-stable:latest"]);
		expect(calls).toContainEqual([
			"docker",
			"pull",
			"schemathesis/schemathesis:stable",
		]);
		expect(calls).toContainEqual(
			expect.arrayContaining([
				"build",
				`BASE_IMAGE=node@${digest("a")}`,
				`BUN_IMAGE=oven/bun@${digest("c")}`,
				"/workspace/docker/runtime/Dockerfile",
			]),
		);
		for (const call of calls.filter(
			(argv) => argv[1] === "run" || argv[1] === "create",
		)) {
			expect(call).toContain("--memory");
			expect(call).toContain("--pids-limit");
		}
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
				if (argv.at(-1) === "oven/bun:1.3.14") {
					return result(JSON.stringify([`oven/bun@${digest("d")}`]));
				}
				return argv.at(-1) === "node:22-bookworm-slim"
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
			if (argv.includes("{{.Id}}")) {
				return result(`${digest("e")}\n`);
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
				`BASE_IMAGE=vuln-workbench-dynamic@${digest("c")}`,
				`BUN_IMAGE=oven/bun@${digest("d")}`,
			]),
		);
		expect(
			calls.some(
				(argv) =>
					argv[1] === "pull" &&
					(argv.at(-1) === "node:22-bookworm-slim" ||
						argv.at(-1) === "oven/bun:1.3.14"),
			),
		).toBe(false);
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

	it("does not save a qualification when temporary resource cleanup fails", async () => {
		const { runner: baseRunner } = successfulRunner();
		const runner: RuntimeIsolationAutoConfigRunner = async (argv, options) => {
			if (
				argv[1] === "rm" &&
				argv.at(-1) === "vwb-runtime-qualification-cleanupfail-proxy"
			) {
				return result("", 1);
			}
			return await baseRunner(argv, options);
		};

		await expect(
			autoConfigureLocalRuntimeIsolation({
				runner,
				repositoryRoot: "/workspace",
				idFactory: () => "cleanupfail",
			}),
		).rejects.toMatchObject({
			code: "runtime_isolation_qualification_cleanup_failed",
		});
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
