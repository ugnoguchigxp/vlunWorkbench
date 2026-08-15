import { describe, expect, test } from "bun:test";
import { runAuthorizationShadowCli } from "./authorization-shadow-assessment";

describe("authorization shadow CLI", () => {
	test("does not read input unless explicitly enabled", async () => {
		let reads = 0;
		let output = "";
		const exitCode = await runAuthorizationShadowCli([], {
			readInput: async () => {
				reads += 1;
				return "{}";
			},
			writeOutput: (value) => {
				output += value;
			},
			writeError: () => undefined,
		});
		expect(exitCode).toBe(0);
		expect(reads).toBe(0);
		expect(JSON.parse(output)).toEqual({ status: "disabled" });
	});

	test("requires an input only after explicit enablement", async () => {
		let error = "";
		const exitCode = await runAuthorizationShadowCli(["--enable"], {
			readInput: async () => "{}",
			writeOutput: () => undefined,
			writeError: (value) => {
				error += value;
			},
		});
		expect(exitCode).toBe(2);
		expect(JSON.parse(error).code).toBe("input_required");
	});
});
