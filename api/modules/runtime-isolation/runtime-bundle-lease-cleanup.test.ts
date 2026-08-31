import { describe, expect, it } from "vitest";
import { cleanupExpiredRuntimeBundle } from "./runtime-bundle-lease-cleanup";

describe("runtime bundle lease cleanup", () => {
	it("reclaims only runtime-bundle receipts and rejects malformed receipts", async () => {
		const calls: string[][] = [];
		await cleanupExpiredRuntimeBundle({
			runner: { run: async (argv) => { calls.push(argv); return { exitCode: 0, stdout: "", stderr: "" }; } },
			lease: { provider: "docker-runtime-isolation", resourceType: "runtime_bundle", receipt: { bundleId: "bundle", scanRunId: "scan", children: [{ role: "target", kind: "container", id: "target" }] } },
		});
		expect(calls).toEqual([["docker", "rm", "-f", "target"]]);
		await expect(cleanupExpiredRuntimeBundle({ runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) }, lease: { provider: "docker-runtime-isolation", resourceType: "runtime_bundle", receipt: {} } })).rejects.toThrow("runtime_bundle_receipt_invalid");
	});
});
