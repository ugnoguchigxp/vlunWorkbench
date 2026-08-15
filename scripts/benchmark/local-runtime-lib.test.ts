import { describe, expect, test } from "bun:test";
import {
	classifyGitSourceState,
	medianSummary,
	percentile,
	summarizeObservation,
} from "./local-runtime-lib";

describe("local runtime benchmark metrics", () => {
	test("distinguishes clean, dirty, and unavailable Git state", () => {
		expect(classifyGitSourceState(0, "")).toBe("clean");
		expect(classifyGitSourceState(0, " M package.json\n")).toBe("dirty");
		expect(classifyGitSourceState(128, "")).toBe("unknown");
	});

	test("uses nearest-rank percentiles and reports queue/error truthfully", () => {
		expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
		expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
		expect(
			summarizeObservation({
				id: "writer",
				durationsMs: [1, 2, 3],
				operations: 3,
				elapsedMs: 6,
				maxQueueDepth: 2,
				errors: 1,
				rejections: 1,
			}),
		).toMatchObject({ p50Ms: 2, p95Ms: 3, maxQueueDepth: 2, errors: 1, rejections: 1 });
	});

	test("takes the median timing from three runs and the worst queue depth", () => {
		const result = medianSummary("writer", [
			{ id: "writer", p50Ms: 1, p95Ms: 3, p99Ms: 4, throughputPerSecond: 8, maxQueueDepth: 1, errors: 0, rejections: 0 },
			{ id: "writer", p50Ms: 2, p95Ms: 2, p99Ms: 3, throughputPerSecond: 9, maxQueueDepth: 4, errors: 0, rejections: 0 },
			{ id: "writer", p50Ms: 3, p95Ms: 4, p99Ms: 5, throughputPerSecond: 7, maxQueueDepth: 2, errors: 0, rejections: 0 },
		]);
		expect(result).toMatchObject({ p50Ms: 2, p95Ms: 3, p99Ms: 4, throughputPerSecond: 8, maxQueueDepth: 4 });
	});
});
