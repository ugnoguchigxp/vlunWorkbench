import { describe, expect, test } from "bun:test";
import { cleanupScannerE2ETemporaryRoot } from "./scanner-e2e-cleanup";

function permissionError(code: "EACCES" | "EPERM") {
	return Object.assign(new Error("permission denied"), { code });
}

describe("cleanupScannerE2ETemporaryRoot", () => {
	test("removes the root directly when host permissions allow it", async () => {
		const commands: string[][] = [];
		const removals: string[] = [];
		await cleanupScannerE2ETemporaryRoot({
			root: "/tmp/e2e-root",
			toolCacheDir: "/tmp/e2e-root/tool-cache",
			toolboxImage: "toolbox@sha256:abc",
			command: async (argv) => {
				commands.push(argv);
				return { exitCode: 0 };
			},
			removeRoot: async (root) => {
				removals.push(root);
			},
		});

		expect(removals).toEqual(["/tmp/e2e-root"]);
		expect(commands).toEqual([]);
	});

	test.each(["EACCES", "EPERM"] as const)(
		"recovers scanner-owned cache entries after %s",
		async (code) => {
			const commands: string[][] = [];
			let removeAttempts = 0;
			await cleanupScannerE2ETemporaryRoot({
				root: "/tmp/e2e-root",
				toolCacheDir: "/tmp/e2e-root/tool-cache",
				toolboxImage: "toolbox@sha256:abc",
				command: async (argv) => {
					commands.push(argv);
					return { exitCode: 1 };
				},
				removeRoot: async () => {
					removeAttempts += 1;
					if (removeAttempts === 1) throw permissionError(code);
				},
			});

			expect(removeAttempts).toBe(2);
			expect(commands).toEqual([
				[
					"docker",
					"run",
					"--rm",
					"--network",
					"none",
					"--user",
					"65532:65532",
					"--cap-drop",
					"ALL",
					"--security-opt",
					"no-new-privileges",
					"--read-only",
					"--volume",
					"/tmp/e2e-root/tool-cache:/workspace/cache:rw",
					"--entrypoint",
					"/bin/chmod",
					"toolbox@sha256:abc",
					"-R",
					"a+rwX",
					"/workspace/cache",
				],
			]);
		},
	);

	test("does not invoke Docker for unrelated removal errors", async () => {
		let commandCalled = false;
		const failure = Object.assign(new Error("busy"), { code: "EBUSY" });

		await expect(
			cleanupScannerE2ETemporaryRoot({
				root: "/tmp/e2e-root",
				toolCacheDir: "/tmp/e2e-root/tool-cache",
				toolboxImage: "toolbox@sha256:abc",
				command: async () => {
					commandCalled = true;
					return { exitCode: 0 };
				},
				removeRoot: async () => {
					throw failure;
				},
			}),
		).rejects.toBe(failure);
		expect(commandCalled).toBe(false);
	});
});
