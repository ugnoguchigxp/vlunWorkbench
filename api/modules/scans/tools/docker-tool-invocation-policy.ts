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
	mvn: new Set(["--version", "--batch-mode"]),
};

const DOCKER_ENTRYPOINTS: Record<string, string> = {};

const MAVEN_CYCLONEDX_GOAL =
	"org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom";
const MAVEN_RESOLVER_FIXED_TAIL = [
	"-DskipTests=true",
	"-DschemaVersion=1.6",
	"-DoutputFormat=json",
	"-DoutputName=maven-resolved.cdx",
	"-DoutputDirectory=/workspace/out",
	"-DincludeTestScope=true",
	"-DincludeBomSerialNumber=false",
	"-DoutputReactorProjects=false",
	"-Dcyclonedx.skipAttach=true",
	MAVEN_CYCLONEDX_GOAL,
];

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
	if (binaryName === "mvn" && firstArg === "--batch-mode") {
		assertAllowedMavenResolverInvocation(args);
	}
}

function assertAllowedMavenResolverInvocation(args: string[]): void {
	let index = 0;
	const expectToken = (expected: string) => {
		if (args[index] !== expected) {
			throw new Error(
				`Docker runner rejected Maven resolver argument: ${args[index] ?? "(missing)"}`,
			);
		}
		index += 1;
	};
	expectToken("--batch-mode");
	expectToken("--no-transfer-progress");
	expectToken("--settings");
	if (!pathLikeArgument(args[index] ?? "")) {
		throw new Error("Docker runner rejected Maven option value: --settings");
	}
	index += 1;
	expectToken("-f");
	if (!pathLikeArgument(args[index] ?? "")) {
		throw new Error("Docker runner rejected Maven option value: -f");
	}
	index += 1;
	if (
		!/^-Dmaven\.repo\.local=\/workspace\/cache\/maven\/[a-f0-9]{24}\/repository$/.test(
			args[index] ?? "",
		)
	) {
		throw new Error("Docker runner rejected Maven local repository path.");
	}
	index += 1;
	const modelEnvironmentKeys = new Set<string>();
	while (/^-Denv\./.test(args[index] ?? "")) {
		const property = /^-Denv\.([A-Z_][A-Z0-9_]*)=([^\r\n\0]*)$/.exec(
			args[index] ?? "",
		);
		if (!property || modelEnvironmentKeys.has(property[1] ?? "")) {
			throw new Error(
				"Docker runner rejected Maven model environment property.",
			);
		}
		modelEnvironmentKeys.add(property[1] ?? "");
		index += 1;
	}
	const tail = args.slice(index);
	if (
		tail.length !== MAVEN_RESOLVER_FIXED_TAIL.length ||
		tail.some(
			(value, tailIndex) => value !== MAVEN_RESOLVER_FIXED_TAIL[tailIndex],
		)
	) {
		throw new Error(
			"Docker runner only allows the pinned CycloneDX makeAggregateBom Maven goal.",
		);
	}
}

function pathLikeArgument(value: string): boolean {
	return Boolean(value) && !/[\r\n\0]/.test(value) && value.startsWith("/");
}

export function dockerEntrypointFor(binaryName: string): string {
	return DOCKER_ENTRYPOINTS[binaryName] ?? `/usr/local/bin/${binaryName}`;
}
