export function buildDynamicEvidenceDescriptor(input: {
	dynamicKind: "test" | "sanitizer" | "fuzz";
	outcome: string;
	reason: string;
	exitCode: number | null;
	stdoutArtifactId: string;
	stderrArtifactId: string;
	collectedArtifactIds: string[];
}): {
	kind: string;
	title: string;
	artifactId: string;
	snippet: string;
} {
	if (input.dynamicKind === "test") {
		return {
			kind: "dynamic-test-log",
			title: `Dynamic Test check: ${input.outcome.toUpperCase()}`,
			artifactId:
				input.outcome === "passed"
					? input.stdoutArtifactId
					: input.stderrArtifactId,
			snippet: `Exit code ${input.exitCode}. Reason: ${input.reason}`,
		};
	}
	if (input.dynamicKind === "sanitizer") {
		return {
			kind:
				input.outcome === "crashed" ? "sanitizer-finding" : "dynamic-result",
			title: `Dynamic Sanitizer check: ${input.outcome.toUpperCase()}`,
			artifactId:
				input.outcome === "crashed"
					? input.stderrArtifactId
					: input.stdoutArtifactId,
			snippet: input.reason,
		};
	}
	return {
		kind: input.outcome === "crashed" ? "fuzz-crash" : "dynamic-result",
		title: `Dynamic Fuzz check: ${input.outcome.toUpperCase()}`,
		artifactId: input.collectedArtifactIds[0] ?? input.stdoutArtifactId,
		snippet: input.reason,
	};
}
