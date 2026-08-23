export function assertDifferentialAuthReadiness(params: {
	unauthenticatedStatus: number;
	authenticatedStatus: number;
	unauthenticatedDigest: string;
	authenticatedDigest: string;
}): void {
	if (params.authenticatedStatus < 200 || params.authenticatedStatus >= 400) {
		throw new Error("authentication_assertion_required");
	}
	if (
		params.unauthenticatedStatus === params.authenticatedStatus &&
		params.unauthenticatedDigest === params.authenticatedDigest
	) {
		throw new Error("authentication_assertion_required");
	}
}
