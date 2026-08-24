const DOCKER_TOOL_ALLOWLIST: Record<string, Set<string>> = {
	gitleaks: new Set(["version", "detect"]),
	"osv-scanner": new Set(["--version", "--format", "scan"]),
	trivy: new Set(["--version", "fs", "image"]),
	nuclei: new Set(["--version", "-version", "-u"]),
	st: new Set(["run", "--version"]),
	"vwb-schemathesis-readonly-gateway": new Set(["run"]),
	cosign: new Set(["version", "verify-blob-attestation"]),
	"slsa-verifier": new Set(["version", "verify-artifact"]),
	zizmor: new Set(["--version", "--offline"]),
};

const DOCKER_ENTRYPOINTS: Record<string, string> = {};

export function registerDockerToolInvocationPolicy(
	binaryName: string,
	allowedFirstArgs: readonly string[],
): void {
	if (!/^[a-zA-Z0-9._-]+$/.test(binaryName) || allowedFirstArgs.length === 0) {
		throw new Error(`Invalid Docker scanner invocation policy: ${binaryName}`);
	}
	const requested = new Set<string>();
	for (const arg of allowedFirstArgs) {
		if (!arg || /[\r\n\0]/.test(arg)) {
			throw new Error(`Invalid Docker scanner first argument: ${binaryName}`);
		}
		requested.add(arg);
	}
	const existing = DOCKER_TOOL_ALLOWLIST[binaryName];
	if (
		existing &&
		(existing.size !== requested.size ||
			[...existing].some((arg) => !requested.has(arg)))
	) {
		throw new Error(
			`Conflicting Docker scanner invocation policy: ${binaryName}`,
		);
	}
	DOCKER_TOOL_ALLOWLIST[binaryName] = requested;
}

export function assertAllowedDockerInvocation(
	binaryName: string,
	args: string[],
): void {
	const allowedFirstArgs = DOCKER_TOOL_ALLOWLIST[binaryName];
	if (!allowedFirstArgs) {
		throw new Error(`Docker runner does not allow tool: ${binaryName}`);
	}
	const firstArg = args[0] ?? "";
	if (!allowedFirstArgs.has(firstArg)) {
		throw new Error(
			`Docker runner does not allow ${binaryName} invocation: ${firstArg || "(none)"}`,
		);
	}
}

export function dockerEntrypointFor(binaryName: string): string {
	return DOCKER_ENTRYPOINTS[binaryName] ?? `/usr/local/bin/${binaryName}`;
}
