import { describe, expect, it } from "bun:test";
import {
	decodeFindingCursor,
	encodeFindingCursor,
} from "./nightworkers-integration-cursor";

describe("NightWorkers finding cursor", () => {
	it("round-trips a filter-bound cursor", () => {
		const payload = {
			version: 1 as const,
			scanRunId: "scan-1",
			createdAt: "2026-07-30T00:00:00.000Z",
			id: "finding-1",
			severity: "high",
			tool: null,
		};
		const cursor = encodeFindingCursor(payload, "secret-key");
		expect(decodeFindingCursor(cursor, "secret-key")).toEqual(payload);
		expect(decodeFindingCursor(cursor, "other-key")).toBeNull();
	});

	it("rejects tampering", () => {
		const cursor = encodeFindingCursor(
			{
				version: 1,
				scanRunId: "scan-1",
				createdAt: "2026-07-30T00:00:00.000Z",
				id: "finding-1",
				severity: null,
				tool: null,
			},
			"secret-key",
		);
		expect(decodeFindingCursor(`${cursor}x`, "secret-key")).toBeNull();
	});
});
