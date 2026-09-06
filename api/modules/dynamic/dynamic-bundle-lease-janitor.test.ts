import { describe, expect, it } from "vitest";
import { DynamicBundleLeaseJanitor } from "./dynamic-bundle-lease-janitor";

describe("dynamic bundle lease janitor", () => {
	it("runs recovery once at startup and filters to Dynamic leases", async () => {
		let calls = 0;
		let provider: string | undefined;
		const janitor = new DynamicBundleLeaseJanitor({
			listRecoverable: async (_now: Date, requestedProvider?: string) => {
				calls++;
				provider = requestedProvider;
				return [];
			},
		} as never, { intervalMs: 60_000 });

		await janitor.start();
		await janitor.stop();

		expect(calls).toBe(1);
		expect(provider).toBe("docker-dynamic-isolation");
	});

	it("rejects an invalid interval after completing startup recovery", async () => {
		let calls = 0;
		const janitor = new DynamicBundleLeaseJanitor(
			{
				listRecoverable: async () => {
					calls++;
					return [];
				},
			} as never,
			{ intervalMs: 0 },
		);

		await expect(janitor.start()).rejects.toThrow(
			"Dynamic bundle cleanup interval must be positive.",
		);
		expect(calls).toBe(1);
	});

	it("coalesces overlapping recovery and makes start idempotent", async () => {
		let releaseRecovery: (() => void) | undefined;
		let calls = 0;
		const repository = {
			listRecoverable: async () => {
				calls++;
				if (calls === 1) {
					await new Promise<void>((resolve) => {
						releaseRecovery = resolve;
					});
				}
				return [];
			},
		};
		const janitor = new DynamicBundleLeaseJanitor(repository as never, {
			intervalMs: 60_000,
		});

		const first = janitor.runOnce();
		const second = janitor.runOnce();
		await Promise.resolve();
		expect(calls).toBe(1);
		releaseRecovery?.();
		await Promise.all([first, second]);
		await janitor.start();
		await janitor.start();
		await janitor.stop();
		expect(calls).toBe(2);
	});

	it("contains repository failures so the periodic worker can retry", async () => {
		const messages: string[] = [];
		const originalError = console.error;
		console.error = (message?: unknown) => messages.push(String(message));
		try {
			const janitor = new DynamicBundleLeaseJanitor({
				listRecoverable: async () => {
					throw new TypeError("database unavailable");
				},
			} as never);

			await expect(janitor.runOnce()).resolves.toBeUndefined();
			expect(messages).toHaveLength(1);
			expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({
				event: "dynamic_bundle_lease_reap_failed",
				errorName: "TypeError",
			});
		} finally {
			console.error = originalError;
		}
	});
});
