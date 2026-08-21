import { describe, expect, it } from "vitest";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import { createDockerRuntimeTargetProvider } from "./docker-runtime-target-provider";

const digest = `sha256:${"b".repeat(64)}`;
const plan: RuntimeIsolationPlanV1 = {
	schemaVersion: 1, profileId: "runtime-web-safe",
	source: { sourceSnapshotDigest: digest, runtimeProjectionDigest: digest, projectionPolicyVersion: 1 }, recipe: { recipeHash: digest, startPlannerId: "build.npm" },
	dependency: { adapterId: "npm-package-lock-v1", policyVersion: 1, lockDigest: digest },
	images: { namespaceOwnerImageDigest: digest, nodeRuntimeImageDigest: digest, materializerImageDigest: digest, registryProxyImageDigest: digest, probeImageDigest: digest, httpExecutorImageDigest: digest, databaseImageDigest: null, scannerImageDigests: {} },
	start: { executable: "npm", args: ["run", "start"], port: 18080, readinessPaths: ["/"] }, database: { mode: "none", policyVersion: 1, bindings: [] }, environment: { policyVersion: 1 }, network: { kind: "container_namespace", policyVersion: 1 }, limits: { policyVersion: 1, targetMemoryMiB: 1024, targetPids: 256 }, cleanup: { required: true, policyVersion: 1 }, dockerDaemonIdentityHash: digest, qualificationHash: digest,
};

describe("docker runtime target provider", () => {
	it("rejects a path other than the sanitized projection before Docker resources are created", async () => {
		let calls = 0;
		const provider = createDockerRuntimeTargetProvider({
			scanRunId: "scan", projectionPath: "/runtime/projection", plan, planHash: digest,
			images: { namespaceOwner: "owner", nodeRuntime: "node", materializer: "materializer", registryProxy: "proxy", probe: "probe", httpExecutor: "http" },
			leaseRepository: { acquire: async () => { calls++; return { id: "lease" }; }, updateActiveReceipt: async () => null, release: async () => null, quarantine: async () => null },
			runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
		});
		await expect(provider.prepare({ repoPath: "/original/repository", readinessTimeoutMs: 1, consentProjectCodeExecution: true })).rejects.toThrow("runtime_projection_path_mismatch");
		expect(calls).toBe(0);
	});
});
