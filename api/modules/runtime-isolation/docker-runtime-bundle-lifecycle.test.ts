import { describe, expect, it } from "vitest";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import { startDockerRuntimeBundle } from "./docker-runtime-bundle-lifecycle";

const digest = `sha256:${"a".repeat(64)}`;

function plan(mode: RuntimeIsolationPlanV1["database"]["mode"] = "postgres_ephemeral"): RuntimeIsolationPlanV1 {
	return {
		schemaVersion: 1, profileId: "runtime-web-safe",
		source: { sourceSnapshotDigest: digest, runtimeProjectionDigest: digest, projectionPolicyVersion: 1 },
		recipe: { recipeHash: digest, startPlannerId: "build.npm" },
		dependency: { adapterId: "npm-package-lock-v1", policyVersion: 1, lockDigest: digest },
		images: { namespaceOwnerImageDigest: digest, nodeRuntimeImageDigest: digest, materializerImageDigest: digest, registryProxyImageDigest: digest, probeImageDigest: digest, httpExecutorImageDigest: digest, databaseImageDigest: digest, scannerImageDigests: {} },
		start: { executable: "npm", args: ["run", "start"], port: 18080, readinessPaths: ["/"] },
		database: { mode, policyVersion: 1, bindings: mode === "postgres_ephemeral" ? [{ key: "DATABASE_URL", valueKind: "url" }] : [] },
		environment: { policyVersion: 1 }, network: { kind: "container_namespace", policyVersion: 1 },
		limits: { policyVersion: 1, targetMemoryMiB: 1024, targetPids: 256 }, cleanup: { required: true, policyVersion: 1 },
		dockerDaemonIdentityHash: digest, qualificationHash: digest,
	};
}

describe("docker runtime bundle lifecycle", () => {
	it("persists every created child before start and keeps database secrets out of argv and receipts", async () => {
		const calls: Array<{ argv: string[]; env?: Record<string, string> }> = [];
		const receipts: Record<string, unknown>[] = [];
		const bundle = await startDockerRuntimeBundle({
			scanRunId: "scan-1", projectionPath: "/private/sanitized-projection", plan: plan(), planHash: digest,
			images: { namespaceOwner: "owner@sha256:a", nodeRuntime: "node@sha256:a", materializer: "materializer@sha256:a", registryProxy: "proxy@sha256:a", probe: "probe@sha256:a", httpExecutor: "http@sha256:a", postgres: "postgres@sha256:a" },
			leaseRepository: {
				acquire: async () => ({ id: "lease-1" }),
				updateActiveReceipt: async (_id, receipt) => { receipts.push(receipt); },
				release: async () => null, quarantine: async () => null,
			},
			runner: { run: async (argv, options) => { calls.push({ argv, env: options?.env }); return { exitCode: 0, stdout: argv[1] === "wait" ? "0\n" : "", stderr: "" }; } },
		});

		expect(receipts).toHaveLength(10);
		expect(calls.some((call) => call.argv.join(" ").includes("npm ci --ignore-scripts"))).toBe(true);
		expect(calls.find((call) => call.argv.includes("materializer@sha256:a"))?.argv.join(" ")).toContain("chmod -R a+rwX /workspace");
		expect(calls.some((call) => call.argv.includes("--internal"))).toBe(true);
		expect(calls.find((call) => call.argv.includes("materializer@sha256:a"))?.argv.join(" ")).toContain("/private/sanitized-projection");
		const databaseCall = calls.find((call) => call.argv.includes("postgres@sha256:a"));
		expect(databaseCall?.argv.join(" ")).not.toContain("POSTGRES_PASSWORD=");
		expect(databaseCall?.env?.POSTGRES_PASSWORD).toBeTruthy();
		const serialized = JSON.stringify({ calls: calls.map((call) => call.argv), receipts });
		expect(serialized).not.toContain(databaseCall?.env?.POSTGRES_PASSWORD ?? "not-a-secret");
		await bundle.stop();
		expect(calls.filter((call) => call.argv[1] === "rm").length).toBeGreaterThan(0);
	});
});
