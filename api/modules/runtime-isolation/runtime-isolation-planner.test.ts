import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntimeIsolationPlan } from "./runtime-isolation-planner";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("buildRuntimeIsolationPlan", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-plan-test-"));
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
		await fs.writeFile(
			path.join(root, "package-lock.json"),
			JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"": { name: "fixture" },
					"node_modules/example": {
						resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
						integrity: "sha512-fixture",
					},
				},
			}),
		);
	});
	afterEach(async () => fs.rm(root, { recursive: true, force: true }));

	const images = {
		namespaceOwnerImageDigest: digest("a"),
		nodeRuntimeImageDigest: digest("b"),
		materializerImageDigest: digest("c"),
		registryProxyImageDigest: digest("d"),
		probeImageDigest: digest("e"),
		httpExecutorImageDigest: digest("f"),
		scannerImageDigests: { nuclei: digest("0") },
		databaseImageDigests: {},
	};
	const projection = () => ({
		rootPath: root,
		projectPath: root,
		sourceSnapshotDigest: "1".repeat(64),
		projectionDigest: "2".repeat(64),
		policyVersion: 1 as const,
		includedFileCount: 2,
		excludedCategoryCounts: { credential: 0, database: 0, socket: 0, symlink: 0 },
		cleanup: async () => undefined,
	});
	const inferTargetPlan = async () => ({
		pluginId: "build.npm",
		repoPath: root,
		scriptName: "start",
		script: "node server.js",
		packageManager: "npm" as const,
		command: ["npm", "run", "start"],
		env: {},
		requiresProjectCodeConsent: false,
		port: 18080,
		origin: "http://127.0.0.1:18080",
		readinessPaths: ["/"],
		warnings: [],
	});

	it("binds snapshot, lock, image and Docker qualification inputs into an immutable plan", async () => {
		const result = await buildRuntimeIsolationPlan({
			profileId: "runtime-web-safe",
			projection: projection(),
			images,
			dockerDaemonIdentityHash: digest("3"),
			qualificationHash: digest("4"),
			inferTargetPlan,
		});
		expect(result).toMatchObject({
			status: "ready",
			plan: {
				start: { port: 18080, executable: "npm" },
				network: { kind: "container_namespace" },
				database: { mode: "none" },
			},
		});
		if (result.status === "ready") expect(result.planHash).toMatch(/^sha256:/);
	});

	it("blocks a lock that would fetch from an unallowlisted registry", async () => {
		await fs.writeFile(
			path.join(root, "package-lock.json"),
			JSON.stringify({
				lockfileVersion: 3,
				packages: {
					"node_modules/example": { resolved: "https://evil.example/a.tgz", integrity: "sha512-fixture" },
				},
			}),
		);
		await expect(
			buildRuntimeIsolationPlan({
				profileId: "runtime-web-safe",
				projection: projection(),
				images,
				dockerDaemonIdentityHash: digest("3"),
				qualificationHash: digest("4"),
				inferTargetPlan,
			}),
		).resolves.toEqual({ status: "blocked", reasonCode: "runtime_dependency_lock_unsupported" });
	});
});
