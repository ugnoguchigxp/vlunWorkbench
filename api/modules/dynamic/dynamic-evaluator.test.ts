import { describe, expect, it } from "vitest";
import { evaluateDynamicOutcome } from "./dynamic-evaluator";

describe("Dynamic Outcome Evaluator", () => {
	describe("Test dynamic Kind", () => {
		it("should evaluate exit code 0 as passed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "test",
				exitCode: 0,
				stdout: "All 5 tests passed",
				stderr: "",
				isTimeout: false,
			});
			expect(res.outcome).toBe("passed");
			expect(res.reason).toContain("completed successfully");
		});

		it("should evaluate non-zero exit code as failed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "test",
				exitCode: 1,
				stdout: "2 of 5 tests failed",
				stderr: "",
				isTimeout: false,
			});
			expect(res.outcome).toBe("failed");
			expect(res.reason).toContain("failed");
		});

		it("should evaluate timeout as timed_out", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "test",
				exitCode: null,
				stdout: "",
				stderr: "",
				isTimeout: true,
			});
			expect(res.outcome).toBe("timed_out");
			expect(res.reason).toContain("timed out");
		});

		it("should evaluate null exit code as error", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "test",
				exitCode: null,
				stdout: "",
				stderr: "Killed by OS",
				isTimeout: false,
			});
			expect(res.outcome).toBe("error");
			expect(res.reason).toContain("terminated abnormally");
		});
	});

	describe("Sanitizer dynamic Kind", () => {
		it("should evaluate exit code 0 as passed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "sanitizer",
				exitCode: 0,
				stdout: "",
				stderr: "",
				isTimeout: false,
			});
			expect(res.outcome).toBe("passed");
		});

		it("should evaluate crash signature as crashed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "sanitizer",
				exitCode: 1,
				stdout: "some stdout",
				stderr: "ERROR: AddressSanitizer: heap-buffer-overflow on address 0x602000000010",
				isTimeout: false,
			});
			expect(res.outcome).toBe("crashed");
			expect(res.reason).toContain("Sanitizer crash detected");
			expect(res.metadata.matchedSignatures).toContain("AddressSanitizer");
		});

		it("should evaluate exit code 1 without signature as failed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "sanitizer",
				exitCode: 1,
				stdout: "compile error",
				stderr: "",
				isTimeout: false,
			});
			expect(res.outcome).toBe("failed");
			expect(res.reason).toContain("exited with non-zero code");
		});
	});

	describe("Fuzz dynamic Kind", () => {
		it("should evaluate exit code 0 as passed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "fuzz",
				exitCode: 0,
				stdout: "fuzzing done, 0 crashes",
				stderr: "",
				isTimeout: false,
			});
			expect(res.outcome).toBe("passed");
		});

		it("should evaluate timeout without crash as passed (normal fuzzer execution)", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "fuzz",
				exitCode: null,
				stdout: "fuzzing...",
				stderr: "",
				isTimeout: true,
			});
			expect(res.outcome).toBe("passed");
			expect(res.reason).toContain("completed successfully without finding any crashes");
		});

		it("should evaluate timeout with crash signature as crashed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "fuzz",
				exitCode: null,
				stdout: "panic: index out of bounds",
				stderr: "",
				isTimeout: true,
			});
			expect(res.outcome).toBe("crashed");
			expect(res.reason).toContain("Matched crash signature");
		});

		it("should evaluate expected artifacts as crashed", () => {
			const res = evaluateDynamicOutcome({
				dynamicKind: "fuzz",
				exitCode: 1,
				stdout: "terminated",
				stderr: "",
				isTimeout: false,
				hasExpectedArtifacts: true,
			});
			expect(res.outcome).toBe("crashed");
			expect(res.reason).toContain("Fuzz crash artifact files were generated");
		});
	});
});
