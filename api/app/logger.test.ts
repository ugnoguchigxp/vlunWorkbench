import { describe, expect, it } from "vitest";
import { createLogger, withLogContext } from "./logger";

describe("structured logger", () => {
	it("only emits allowed fields and rejects paths and multiline identifiers", () => {
		const lines: string[] = [];
		createLogger((line) => lines.push(line))({ level: "error", event: "scan.failed", scanRunId: "run-1", errorCode: "/private/secret\nvalue", durationMs: 1.7, prompt: "secret", message: "token" } as never);
		expect(JSON.parse(lines[0])).toMatchObject({ event: "scan.failed", scanRunId: "run-1", durationMs: 2 });
		expect(lines[0]).not.toMatch(/secret|token|prompt|message|private/);
	});
	it("isolates concurrent request IDs and inherits scan correlation", async () => {
		const lines: string[] = [];
		const log = createLogger((line) => lines.push(line));
		await Promise.all(["request-a", "request-b"].map((requestId) => withLogContext({ requestId }, async () => {
			await Promise.resolve();
			await withLogContext({ scanRunId: `scan-${requestId}` }, async () => { await Promise.resolve(); log({ level: "error", event: "llm.call.failed" }); });
		})));
		expect(lines.map((line) => JSON.parse(line)).every((event) => event.scanRunId === `scan-${event.requestId}`)).toBe(true);
		expect(new Set(lines.map((line) => JSON.parse(line).requestId)).size).toBe(2);
	});

	it("does not fail an operation when the sink throws", () => {
		expect(() => createLogger(() => { throw new Error("closed"); })({ level: "error", event: "writer.unavailable" })).not.toThrow();
	});
});
