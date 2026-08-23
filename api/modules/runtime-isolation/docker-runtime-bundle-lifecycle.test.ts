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

function bunPlan(): RuntimeIsolationPlanV1 {
	const base = plan("none");
	return {
		...base,
		dependency: { adapterId: "bun-lock-v1", policyVersion: 1, lockDigest: digest },
		start: { executable: "bun", args: ["--bun", "run", "dev"], port: 18080, readinessPaths: ["/"] },
		images: { ...base.images, databaseImageDigest: null },
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
		const databaseStartIndex = calls.findIndex(
			(call) =>
				call.argv[1] === "start" &&
				call.argv.at(-1)?.endsWith("-database"),
		);
		const databaseReadyIndex = calls.findIndex(
			(call) =>
				call.argv[1] === "exec" && call.argv.join(" ").includes("pg_isready"),
		);
		const targetCreateIndex = calls.findIndex(
			(call) =>
				call.argv[1] === "create" &&
				call.argv[call.argv.indexOf("--name") + 1]?.endsWith("-target"),
		);
		expect(databaseReadyIndex).toBeGreaterThan(databaseStartIndex);
		expect(databaseReadyIndex).toBeLessThan(targetCreateIndex);
		const serialized = JSON.stringify({ calls: calls.map((call) => call.argv), receipts });
		expect(serialized).not.toContain(databaseCall?.env?.POSTGRES_PASSWORD ?? "not-a-secret");
		await bundle.stop();
		expect(calls.filter((call) => call.argv[1] === "rm").length).toBeGreaterThan(0);
	});

	it("installs Bun dependencies from the isolated proxy with scripts disabled", async () => {
		const calls: string[][] = [];
		const runtimePlan = bunPlan();
		runtimePlan.start.readinessPaths = ["/not-ready", "/health"];
		const bundle = await startDockerRuntimeBundle({
			scanRunId: "scan-bun",
			projectionPath: "/private/sanitized-projection",
			plan: runtimePlan,
			planHash: digest,
			images: { namespaceOwner: "owner", nodeRuntime: "runtime", materializer: "materializer", registryProxy: "proxy", probe: "probe", httpExecutor: "http" },
			leaseRepository: { acquire: async () => ({ id: "lease-bun" }), updateActiveReceipt: async () => null, release: async () => null, quarantine: async () => null },
			runner: { run: async (argv) => { calls.push(argv); return { exitCode: 0, stdout: argv[1] === "wait" ? "0\n" : "", stderr: "" }; } },
		});
		const dependencyCall = calls.find((argv) =>
			argv.some((value) => value.endsWith("-dependency-fetch")),
		);
		expect(dependencyCall?.join(" ")).toContain("bun install --frozen-lockfile --ignore-scripts");
		expect(dependencyCall?.join(" ")).toContain("--registry http://");
		expect(dependencyCall?.join(" ")).toContain(
			"--cache-dir=/workspace/.bun-cache --network-concurrency=8",
		);
		expect(dependencyCall?.join(" ")).toContain("volume-nocopy");
		for (const suffix of [
			"-registry-proxy",
			"-materializer",
			"-dependency-fetch",
			"-probe",
		]) {
			const createCall = calls.find(
				(argv) =>
					argv[1] === "create" &&
					argv[argv.indexOf("--name") + 1]?.endsWith(suffix),
			);
			expect(createCall).toContain("--memory");
			expect(createCall).toContain("--pids-limit");
			if (suffix === "-materializer") {
				expect(createCall).toContain("0:0");
			}
		}
		const proxyStopIndex = calls.findIndex(
			(argv) => argv[1] === "stop" && argv.at(-1)?.endsWith("-registry-proxy"),
		);
		const targetCreateIndex = calls.findIndex(
			(argv) =>
				argv[1] === "create" &&
				argv[argv.indexOf("--name") + 1]?.endsWith("-target"),
		);
		expect(proxyStopIndex).toBeGreaterThan(-1);
		expect(proxyStopIndex).toBeLessThan(targetCreateIndex);
		const targetCall = calls.find(
			(argv) => argv.includes("runtime") && argv.at(-4) === "bun",
		);
		expect(targetCall?.slice(-4)).toEqual(["bun", "--bun", "run", "dev"]);
		const probeCall = calls.find((argv) =>
			argv.some((value) => value.endsWith("-probe")),
		);
		const probeScript = probeCall?.find((value) =>
			value.includes("for url"),
		);
		expect(probeScript).toContain('"$url"');
		expect(probeScript).toContain("[1-4][0-9][0-9]");
		expect(probeCall?.slice(-2)).toEqual([
			"http://127.0.0.1:18080/not-ready",
			"http://127.0.0.1:18080/health",
		]);
		await bundle.stop();
	});
});
