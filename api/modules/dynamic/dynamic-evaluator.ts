import type { DynamicOutcome } from "../../../shared/schemas/dynamic.schema";

export interface EvaluationInput {
	dynamicKind: "test" | "sanitizer" | "fuzz";
	exitCode: number | null;
	stdout: string;
	stderr: string;
	isTimeout: boolean;
	hasExpectedArtifacts?: boolean;
}

export interface EvaluationResult {
	outcome: DynamicOutcome;
	reason: string;
	metadata: {
		matchedSignatures: string[];
		hasExpectedArtifacts: boolean;
	};
}

const SANITIZER_SIGNATURES = [
	"AddressSanitizer",
	"LeakSanitizer",
	"ThreadSanitizer",
	"MemorySanitizer",
	"UndefinedBehaviorSanitizer",
	"ASan:",
	"LSan:",
	"TSan:",
	"MSan:",
	"UBSan:",
	"ERROR: AddressSanitizer",
	"ERROR: LeakSanitizer",
	"ERROR: ThreadSanitizer",
	"ERROR: MemorySanitizer",
	"ERROR: UndefinedBehaviorSanitizer",
	"SUMMARY: AddressSanitizer",
	"SUMMARY: UndefinedBehaviorSanitizer",
	"leak-check",
];

const FUZZ_SIGNATURES = [
	...SANITIZER_SIGNATURES,
	"panic:",
	"Assertion failed",
	"assertion failed",
	"segmentation fault",
	"Segmentation fault",
	"deadly signal",
	"fuzz crash",
	"Fuzz crash",
	"CRASH",
];

export function evaluateDynamicOutcome(
	input: EvaluationInput,
): EvaluationResult {
	const {
		dynamicKind,
		exitCode,
		stdout,
		stderr,
		isTimeout,
		hasExpectedArtifacts = false,
	} = input;
	const combinedLogs = `${stdout}\n${stderr}`;
	const matchedSignatures: string[] = [];

	if (dynamicKind === "test") {
		if (isTimeout) {
			return {
				outcome: "timed_out",
				reason: "Test execution timed out.",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}
		if (exitCode === null) {
			return {
				outcome: "error",
				reason: "Test terminated abnormally without an exit code.",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}
		if (exitCode === 0) {
			return {
				outcome: "passed",
				reason: "Tests completed successfully (exit code 0).",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}
		return {
			outcome: "failed",
			reason: `Tests failed (exit code ${exitCode}).`,
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	if (dynamicKind === "sanitizer") {
		// Scan for sanitizer signatures
		for (const sig of SANITIZER_SIGNATURES) {
			if (combinedLogs.includes(sig)) {
				matchedSignatures.push(sig);
			}
		}

		if (matchedSignatures.length > 0) {
			return {
				outcome: "crashed",
				reason: `Sanitizer crash detected. Matched: ${matchedSignatures.join(", ")}`,
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}

		if (isTimeout) {
			return {
				outcome: "timed_out",
				reason: "Sanitizer run timed out.",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}

		if (exitCode === null) {
			return {
				outcome: "error",
				reason: "Sanitizer run terminated abnormally without an exit code.",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}

		if (exitCode === 0) {
			return {
				outcome: "passed",
				reason: "Sanitizer checks passed (exit code 0).",
				metadata: { matchedSignatures, hasExpectedArtifacts },
			};
		}

		return {
			outcome: "failed",
			reason: `Sanitizer check command exited with non-zero code ${exitCode} without active sanitizer crash signature.`,
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	// fuzz
	for (const sig of FUZZ_SIGNATURES) {
		if (combinedLogs.includes(sig)) {
			matchedSignatures.push(sig);
		}
	}

	const hasCrashIndicators =
		matchedSignatures.length > 0 || hasExpectedArtifacts;

	if (hasCrashIndicators) {
		const reasons: string[] = [];
		if (matchedSignatures.length > 0) {
			reasons.push(`Matched crash signature: ${matchedSignatures.join(", ")}`);
		}
		if (hasExpectedArtifacts) {
			reasons.push("Fuzz crash artifact files were generated.");
		}
		return {
			outcome: "crashed",
			reason: reasons.join(" / "),
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	if (isTimeout) {
		// Fuzzing timing out without crash indicates success/passed, as fuzzers run until timeout.
		return {
			outcome: "passed",
			reason:
				"Fuzz target execution completed successfully without finding any crashes (ran to timeout).",
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	if (exitCode === null) {
		return {
			outcome: "error",
			reason: "Fuzz target terminated abnormally without an exit code.",
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	if (exitCode === 0) {
		return {
			outcome: "passed",
			reason: "Fuzz target completed successfully (exit code 0).",
			metadata: { matchedSignatures, hasExpectedArtifacts },
		};
	}

	return {
		outcome: "failed",
		reason: `Fuzz target exited with non-zero code ${exitCode} without active crash indicators.`,
		metadata: { matchedSignatures, hasExpectedArtifacts },
	};
}
