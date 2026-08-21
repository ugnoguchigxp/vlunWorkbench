import { describe, expect, it } from "vitest";
import {
	buildNamespaceOwnerArgs,
	buildTargetArgs,
	cleanupRuntimeBundle,
} from "./docker-runtime-bundle";

describe("docker runtime bundle", () => {
	it("creates a namespace owner without host networking or published ports", () => {
		const argv = buildNamespaceOwnerArgs({
			dockerBin: "docker",
			name: "owner",
			image: "example/owner@sha256:abc",
			bundleId: "bundle",
			scanRunId: "scan",
		});
		expect(argv).toContain("none");
		expect(argv).toContain("--read-only");
		expect(argv).toContain("--cap-drop");
		expect(argv.join(" ")).not.toContain("--publish");
		expect(argv.join(" ")).not.toContain("--network host");
	});

	it("joins targets to the private namespace without mounting a host repository", () => {
		const argv = buildTargetArgs({
			dockerBin: "docker",
			name: "target",
			image: "example/node@sha256:abc",
			namespaceOwnerId: "private-owner-id",
			workspaceVolume: "workspace-volume",
			bundleId: "bundle",
			scanRunId: "scan",
			start: { executable: "npm", args: ["run", "start"], port: 18080, readinessPaths: ["/"] },
			envKeys: ["DATABASE_URL"],
		});
		expect(argv).toContain("container:private-owner-id");
		expect(argv).toContain("type=volume,src=workspace-volume,dst=/workspace,rw");
		expect(argv).toContain("DATABASE_URL");
		expect(argv.join(" ")).not.toContain(":/workspace/repo");
		expect(argv.join(" ")).not.toContain("--publish");
	});

	it("cleans containers before volumes and networks", async () => {
		const calls: string[][] = [];
		await cleanupRuntimeBundle({
			dockerBin: "docker",
			receipt: {
				bundleId: "bundle",
				scanRunId: "scan",
				children: [
					{ role: "workspace-volume", kind: "volume", id: "workspace" },
					{ role: "build-internal-network", kind: "network", id: "internal" },
					{ role: "target", kind: "container", id: "target" },
				],
			},
			runner: {
				run: async (argv) => {
					calls.push(argv);
					return { exitCode: 0, stdout: "", stderr: "" };
				},
			},
		});
		expect(calls).toEqual([
			["docker", "rm", "-f", "target"],
			["docker", "volume", "rm", "-f", "workspace"],
			["docker", "network", "rm", "internal"],
		]);
	});
});
