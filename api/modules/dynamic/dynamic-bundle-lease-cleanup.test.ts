import { describe, expect, it } from "vitest";
import { cleanupExpiredDynamicBundle } from "./dynamic-bundle-lease-cleanup";

describe("dynamic bundle lease cleanup", () => {
	it("removes only a validated Dynamic container and its output volume", async () => {
		const calls: string[][] = [];
		await cleanupExpiredDynamicBundle({
			lease: {
				provider: "docker-dynamic-isolation",
				resourceType: "dynamic_bundle",
				receipt: {
					containerName: "vuln-workbench-dyn-test-1",
					outputVolumeName: "vuln-workbench-dyn-test-1-out",
				},
			},
			runner: {
				run: async (argv) => {
					calls.push(argv);
					return { exitCode: 0, stdout: "", stderr: "" };
				},
			},
		});
		expect(calls).toEqual([
			["docker", "rm", "-f", "vuln-workbench-dyn-test-1"],
			["docker", "volume", "rm", "-f", "vuln-workbench-dyn-test-1-out"],
		]);
	});

	it("rejects receipts that cannot be proven to own the output volume", async () => {
		await expect(
			cleanupExpiredDynamicBundle({
				lease: {
					provider: "docker-dynamic-isolation",
					resourceType: "dynamic_bundle",
					receipt: {
						containerName: "vuln-workbench-dyn-test-1",
						outputVolumeName: "other-volume",
					},
				},
				runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
			}),
		).rejects.toThrow("dynamic_bundle_receipt_invalid");
	});

	it("treats resources already removed by normal completion as reclaimed", async () => {
		await expect(
			cleanupExpiredDynamicBundle({
				lease: {
					provider: "docker-dynamic-isolation",
					resourceType: "dynamic_bundle",
					receipt: {
						containerName: "vuln-workbench-dyn-test-1",
						outputVolumeName: "vuln-workbench-dyn-test-1-out",
					},
				},
				runner: {
					run: async (argv) => ({
						exitCode: 1,
						stdout: "",
						stderr: `Error: No such ${argv[1] === "volume" ? "volume" : "container"}`,
					}),
				},
			}),
		).resolves.toBeUndefined();
	});
});
