import { describe, expect, it } from "bun:test";
import { main } from "./dynamic-run";

describe("dynamic:run CLI", () => {
	it("requires a parent scan before it can create recoverable Docker resources", async () => {
		const output: Record<string, unknown>[] = [];
		const exitCode = await main(
			[
				"--project-id",
				"project-1",
				"--profile",
				"bun-test",
				"--consent-project-code-execution",
				"true",
			],
			(payload) => output.push(payload),
		);

		expect(exitCode).toBe(1);
		expect(output).toEqual([
			expect.objectContaining({ message: expect.stringContaining("--scan-run-id") }),
		]);
	});
});
