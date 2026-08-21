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
});
