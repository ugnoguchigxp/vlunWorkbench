export function getReproductionBaseMetadata(
	recordMetadata: unknown,
): Record<string, unknown> {
	return recordMetadata && typeof recordMetadata === "object"
		? (recordMetadata as Record<string, unknown>)
		: {};
}

export function withReproductionRunnerMetadata(
	baseMetadata: Record<string, unknown>,
	executionMetadata?: Record<string, unknown>,
): Record<string, unknown> {
	if (!executionMetadata) return baseMetadata;
	return {
		...baseMetadata,
		runnerMetadata: executionMetadata,
	};
}

export function classifyReproductionExecutionFailure(input: {
	error?: string;
	stderr?: string;
}): {
	status: "failed" | "timed_out";
	failureKind: string;
} {
	const text = `${input.error ?? ""}\n${input.stderr ?? ""}`.toLowerCase();
	if (text.includes("timed out") || text.includes("timeout")) {
		return { status: "timed_out", failureKind: "sandbox_timeout" };
	}
	if (
		text.includes("no such image") ||
		text.includes("unable to find image") ||
		text.includes("pull access denied") ||
		text.includes("manifest unknown")
	) {
		return { status: "failed", failureKind: "docker_image_missing" };
	}
	if (
		text.includes("docker process error") ||
		text.includes("enoent") ||
		text.includes("cannot connect to the docker daemon") ||
		text.includes("is the docker daemon running")
	) {
		return { status: "failed", failureKind: "docker_unavailable" };
	}
	return { status: "failed", failureKind: "unknown_error" };
}
