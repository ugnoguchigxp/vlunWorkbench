import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	createRuntimeIsolationProviderFactory,
	runtimeScannerImageRequirementsForSteps,
	runtimeScannerImageRolesForSteps,
} from "./runtime-isolation-provider-factory";

const digest = `sha256:${"c".repeat(64)}`;
const image = (name: string) => `${name}@${digest}`;

describe("runtime isolation provider factory", () => {
	it("maps required and optional runtime scanner images explicitly", () => {
		const steps = [
				{
					kind: "runtime_scanner",
					adapter: "nuclei-safe",
					displayName: "Nuclei",
					required: true,
					failurePolicy: "fail_profile",
					target: { mode: "auto_project_start" },
				},
				{
					kind: "runtime_scanner",
					adapter: "zap-baseline",
					displayName: "ZAP",
					required: false,
					failurePolicy: "warn_and_continue",
					target: { mode: "auto_project_start" },
				},
				{
					kind: "api_schema_scan",
					adapter: "schemathesis",
					displayName: "Schemathesis",
					required: false,
					failurePolicy: "warn_and_continue",
					target: { mode: "auto_project_start" },
					schema: { mode: "auto_discover", kind: "auto" },
				},
			] as const;
		expect(runtimeScannerImageRolesForSteps(steps)).toEqual(["nuclei"]);
		expect(runtimeScannerImageRequirementsForSteps(steps)).toEqual([
			{ role: "nuclei", required: true },
			{ role: "schemathesis", required: false },
			{ role: "zap", required: false },
		]);
	});

	it("derives its public target plan from a sanitized immutable snapshot", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-provider-factory-"));
		try {
			await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
			await fs.writeFile(path.join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "sample" } } }));
			await fs.writeFile(path.join(root, ".env"), "DATABASE_URL=production");
			const factory = createRuntimeIsolationProviderFactory({
				images: { namespaceOwner: image("owner"), nodeRuntime: image("node"), materializer: image("materializer"), registryProxy: image("proxy"), probe: image("probe"), httpExecutor: image("http"), nuclei: image("nuclei") },
				dockerDaemonIdentityHash: digest, qualificationHash: digest,
				inferTargetPlan: async ({ repoPath, port }) => ({ pluginId: "build.npm", repoPath, scriptName: "start", script: "node server.js", packageManager: "npm", command: ["npm", "run", "start"], env: {}, requiresProjectCodeConsent: false, port, origin: `http://127.0.0.1:${port}`, readinessPaths: ["/"], warnings: [] }),
				leaseRepository: { acquire: async () => ({ id: "lease" }), updateActiveReceipt: async () => null, release: async () => null, quarantine: async () => null },
				runner: { run: async () => ({ exitCode: 0, stdout: "0", stderr: "" }) },
			});
			const provider = await factory({
				scanRunId: "scan",
				profileId: "runtime-web-safe",
				sourceSnapshot: { projectPath: root, snapshotDigest: "c".repeat(64), rootPath: root, sourceRevision: "c".repeat(40), cleanup: async () => {} },
				scannerImageRequirements: [
					{ role: "nuclei", required: true },
					{ role: "zap", required: false },
				],
			});
			expect(provider.plan?.repoPath).not.toBe(root);
			expect(provider.plan?.command).toEqual(["npm", "run", "start"]);
			expect(provider.runtimeIsolationPlanning).toMatchObject({
				status: "ready",
				plan: {
					source: {
						sourceSnapshotDigest: digest,
					},
				},
			});
			expect(provider.runtimeScannerImages).toEqual({
				"nuclei-safe": image("nuclei"),
			});
			expect(provider.preflightDockerImages).toEqual(
				expect.arrayContaining([
					{
						role: "scanner-nuclei",
						stepId: "runtime_scanner:nuclei-safe",
						image: image("nuclei"),
						required: true,
					},
					{
						role: "scanner-zap",
						stepId: "runtime_scanner:zap-baseline",
						image: null,
						required: false,
					},
				]),
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("returns a blocked planning result instead of throwing a generic error", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "runtime-provider-factory-blocked-"),
		);
		try {
			await fs.writeFile(
				path.join(root, "package.json"),
				JSON.stringify({ scripts: { start: "node server.js" } }),
			);
			const factory = createRuntimeIsolationProviderFactory({
				images: {
					namespaceOwner: image("owner"),
					nodeRuntime: image("node"),
					materializer: image("materializer"),
					registryProxy: image("proxy"),
					probe: image("probe"),
					httpExecutor: image("http"),
				},
				dockerDaemonIdentityHash: digest,
				qualificationHash: digest,
				inferTargetPlan: async ({ repoPath, port }) => ({
					pluginId: "build.npm",
					repoPath,
					scriptName: "start",
					script: "node server.js",
					packageManager: "npm",
					command: ["npm", "run", "start"],
					env: {},
					requiresProjectCodeConsent: false,
					port,
					origin: `http://127.0.0.1:${port}`,
					readinessPaths: ["/"],
					warnings: [],
				}),
				leaseRepository: {
					acquire: async () => ({ id: "lease" }),
					updateActiveReceipt: async () => null,
					release: async () => null,
					quarantine: async () => null,
				},
				runner: {
					run: async () => ({ exitCode: 0, stdout: "0", stderr: "" }),
				},
			});

			const provider = await factory({
				scanRunId: "scan",
				profileId: "runtime-web-safe",
				sourceSnapshot: {
					projectPath: root,
					snapshotDigest: "c".repeat(64),
					rootPath: root,
					sourceRevision: "c".repeat(40),
					cleanup: async () => {},
				},
			});

			expect(provider.runtimeIsolationPlanning).toEqual({
				status: "blocked",
				reasonCode: "runtime_dependency_lock_unsupported",
			});
			expect(provider.plan).toBeUndefined();
			await expect(
				provider.prepare({
					repoPath: root,
					readinessTimeoutMs: 1,
					consentProjectCodeExecution: true,
				}),
			).rejects.toThrow("runtime_dependency_lock_unsupported");
			await provider.dispose?.();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("propagates required scanner images into runtime planning", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "runtime-provider-factory-scanners-"),
		);
		try {
			await fs.writeFile(
				path.join(root, "package.json"),
				JSON.stringify({ scripts: { start: "node server.js" } }),
			);
			await fs.writeFile(
				path.join(root, "package-lock.json"),
				JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "sample" } } }),
			);
			const factory = createRuntimeIsolationProviderFactory({
				images: {
					namespaceOwner: image("owner"),
					nodeRuntime: image("node"),
					materializer: image("materializer"),
					registryProxy: image("proxy"),
					probe: image("probe"),
					httpExecutor: image("http"),
					nuclei: image("nuclei"),
				},
				dockerDaemonIdentityHash: digest,
				qualificationHash: digest,
				inferTargetPlan: async ({ repoPath, port }) => ({
					pluginId: "build.npm",
					repoPath,
					scriptName: "start",
					script: "node server.js",
					packageManager: "npm",
					command: ["npm", "run", "start"],
					env: {},
					requiresProjectCodeConsent: false,
					port,
					origin: `http://127.0.0.1:${port}`,
					readinessPaths: ["/"],
					warnings: [],
				}),
				leaseRepository: {
					acquire: async () => ({ id: "lease" }),
					updateActiveReceipt: async () => null,
					release: async () => null,
					quarantine: async () => null,
				},
				runner: {
					run: async () => ({ exitCode: 0, stdout: "0", stderr: "" }),
				},
			});

			const provider = await factory({
				scanRunId: "scan",
				profileId: "runtime-web-safe",
				sourceSnapshot: {
					projectPath: root,
					snapshotDigest: "c".repeat(64),
					rootPath: root,
					sourceRevision: "c".repeat(40),
					cleanup: async () => {},
				},
				requiredScannerImageRoles: ["nuclei", "zap"],
			});

			expect(provider.runtimeIsolationPlanning).toEqual({
				status: "blocked",
				reasonCode: "runtime_image_missing",
			});
			await provider.dispose?.();
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
