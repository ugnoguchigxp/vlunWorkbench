const PASSIVE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertAuthenticatedPassiveScanRequest(
	method: string,
	phase: "login" | "scan",
) {
	if (phase === "scan" && !PASSIVE_METHODS.has(method.toUpperCase())) {
		throw new Error("policy_rejected");
	}
}
