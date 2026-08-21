import { describe, expect, it } from "vitest";
import { RuntimeBundleLeaseJanitor } from "./runtime-bundle-lease-janitor";

describe("runtime bundle lease janitor", () => {
	it("runs recovery once at startup and can stop without an overlapping run", async () => {
		let calls = 0;
		let provider: string | undefined;
		const janitor = new RuntimeBundleLeaseJanitor({
			listRecoverable: async (_now: Date, requestedProvider?: string) => {
				calls++;
				provider = requestedProvider;
				return [];
			},
		} as never, { intervalMs: 60_000 });
		await janitor.start();
		await janitor.stop();
		expect(calls).toBe(1);
		expect(provider).toBe("docker-runtime-isolation");
	});
});
