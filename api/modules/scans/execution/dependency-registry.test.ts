import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeDependency } from "./dependency-registry";

const imageId = `sha256:${"a".repeat(64)}`;

describe("dependency registry", () => {
	test("reports a missing pinned scanner image before execution", async () => {
		const result = await probeDependency({
			id: "scanner.nuclei",
			settings: {
				VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE: `registry.example/nuclei@${imageId}`,
			},
			run: async () => ({ exitCode: 1 }),
		});
		expect(result).toEqual({
			id: "scanner.nuclei",
			ready: false,
			reasonCode: "docker_image_unavailable",
		});
	});

	test("does not invoke Docker when an image setting is absent", async () => {
		let calls = 0;
		const result = await probeDependency({
			id: "scanner.schemathesis",
			run: async () => {
				calls += 1;
				return { exitCode: 0 };
			},
		});
		expect(result.reasonCode).toBe("docker_image_unavailable");
		expect(calls).toBe(0);
	});

	test("recovers a local image after Docker Desktop Resource Saver stops the backend", async () => {
		const calls: Array<[string, string[]]> = [];
		let callIndex = 0;
		const result = await probeDependency({
			id: "scanner.cosign",
			settings: { SCAN_DOCKER_IMAGE: "vuln-workbench-toolbox:local" },
			run: async (command, args) => {
				calls.push([command, args]);
				callIndex += 1;
				if (callIndex === 1) {
					return {
						exitCode: 1,
						stderr:
							"Error response from daemon: No such image: vuln-workbench-toolbox:local",
					};
				}
				if (callIndex === 4) {
					return {
						exitCode: 0,
						stdout: `[]\t${imageId}\tlinux/arm64\n`,
					};
				}
				return { exitCode: 0 };
			},
		});

		expect(result).toEqual({
			id: "scanner.cosign",
			ready: true,
			reasonCode: null,
		});
		expect(calls).toHaveLength(4);
		expect(calls[0]?.[1]?.[0]).toBe("image");
		expect(calls[1]?.[1]?.[0]).toBe("create");
		expect(calls[1]?.[1]).not.toContain("run");
		expect(calls[2]?.[1]?.slice(0, 3)).toEqual([
			"container",
			"rm",
			"--force",
		]);
		expect(calls[3]?.[1]).toEqual(calls[0]?.[1]);
	});

	test("resolves Cosign from the configured core toolbox image", async () => {
		const calls: Array<[string, string[]]> = [];
		const result = await probeDependency({
			id: "scanner.cosign",
			settings: { SCAN_DOCKER_IMAGE: "vuln-workbench-toolbox:local" },
			run: async (command, args) => {
				calls.push([command, args]);
				return { exitCode: 0 };
			},
		});

		expect(result).toEqual({
			id: "scanner.cosign",
			ready: true,
			reasonCode: null,
		});
		expect(calls).toEqual([
			[
				"docker",
				[
					"image",
					"inspect",
					"--format",
					expect.any(String),
					"--",
					"vuln-workbench-toolbox:local",
				],
			],
		]);
	});

	test("requires an accessible workspace directory", async () => {
		const workspacePath = await fs.mkdtemp(
			path.join(os.tmpdir(), "vuln-workbench-readiness-"),
		);
		try {
			await expect(
				probeDependency({ id: "resource.workspace", workspacePath }),
			).resolves.toEqual({
				id: "resource.workspace",
				ready: true,
				reasonCode: null,
			});
		} finally {
			await fs.rm(workspacePath, { recursive: true, force: true });
		}

		await expect(
			probeDependency({ id: "resource.workspace" }),
		).resolves.toEqual({
			id: "resource.workspace",
			ready: false,
			reasonCode: "workspace_unavailable",
		});
	});

	test("does not claim a port lease before the runtime reservation step", async () => {
		await expect(
			probeDependency({ id: "resource.network-port" }),
		).resolves.toEqual({
			id: "resource.network-port",
			ready: false,
			reasonCode: "resource_probe_deferred",
		});
	});
});
