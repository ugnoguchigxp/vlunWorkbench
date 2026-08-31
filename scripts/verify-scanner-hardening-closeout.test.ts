import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	assertExactIds,
	closeoutReceiptArgv,
	resolveContained,
} from "./verify-scanner-hardening-closeout";

describe("scanner hardening closeout verifier guards", () => {
	test("accepts only the exact command identity set", () => {
		expect(() => assertExactIds(["scope", "strict"], ["scope", "strict"], "mismatch")).not.toThrow();
		expect(() => assertExactIds(["scope", "scope"], ["scope", "strict"], "mismatch")).toThrow("mismatch");
		expect(() => assertExactIds(["scope"], ["scope", "strict"], "mismatch")).toThrow("mismatch");
		expect(() =>
			assertExactIds(["strict", "scope"], ["scope", "strict"], "mismatch"),
		).toThrow("mismatch");
	});

	test("pins exact argv without persisting machine-local paths", () => {
		const commit = "a".repeat(40);
		expect(closeoutReceiptArgv("scope", commit)).toEqual([
			"bun",
			"run",
			"scripts/check-scanner-hardening-closeout-scope.ts",
			"--candidate",
			commit,
			"--out",
			"$RUN_ROOT/scope.v1.json",
		]);
		expect(
			closeoutReceiptArgv("failure-verify", commit).some((entry) =>
				path.isAbsolute(entry),
			),
		).toBe(false);
	});

	test("rejects a receipt file outside its run directory", () => {
		const root = path.resolve("artifacts/closeout/run");
		expect(resolveContained(root, "evidence/result.json")).toBe(
			path.join(root, "evidence/result.json"),
		);
		expect(() => resolveContained(root, "../other/receipt.json")).toThrow(
			"scanner_hardening_closeout_path_escape",
		);
	});
});
