export function scanProfileExitCode(params: {
	executionSurface: "cli" | "web";
	ok: boolean;
	resultPolicy: "advisory" | "gate";
	gateDecision: "not_requested" | "pass" | "fail" | "blocked";
}): number {
	if (
		params.resultPolicy === "gate" &&
		params.gateDecision !== "not_requested"
	) {
		return params.executionSurface === "web" ? 0 : 3;
	}
	return params.ok ? 0 : 1;
}
