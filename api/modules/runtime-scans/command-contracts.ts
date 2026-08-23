import crypto from "node:crypto";

export const NUCLEI_SAFE_POLICY_ID = "nuclei-safe-v1";
export const NUCLEI_SAFE_TEMPLATE_TREE_HASH =
	"sha256:d4d866e40b03eb7857b578792c09dee46e35d0e1dec18c6fbac3a59623d4f775";
export const NUCLEI_SAFE_POLICY_HASH = crypto
	.createHash("sha256")
	.update(
		`nuclei-safe:v1:omit-raw,no-interactsh,rate-limit=5,concurrency=5,retries=0,request-budget=20,templates=${NUCLEI_SAFE_TEMPLATE_TREE_HASH}`,
	)
	.digest("hex");

export function buildNucleiSafeCommand(
	targetOrigin: string,
	outputPath: string,
	templateRoot: string,
): string[] {
	if (
		!/^https?:\/\/(?:127\.0\.0\.1|host\.docker\.internal)(?::\d+)?$/.test(
			targetOrigin,
		)
	) {
		throw new Error(
			"Nuclei safe scan requires an auto-started loopback origin.",
		);
	}
	return [
		"-u",
		targetOrigin,
		"-jsonl-export",
		outputPath,
		"-silent",
		"-no-color",
		"-omit-raw",
		"-disable-update-check",
		"-no-interactsh",
		"-rate-limit",
		"5",
		"-concurrency",
		"5",
		"-timeout",
		"5",
		"-retries",
		"0",
		"-templates",
		templateRoot,
	];
}

export function buildZapBaselineCommand(
	targetOrigin: string,
	outputPath: string,
): string[] {
	if (
		!/^https?:\/\/(?:127\.0\.0\.1|localhost|host\.docker\.internal|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?$/.test(
			targetOrigin,
		)
	) {
		throw new Error("ZAP baseline requires an auto-started loopback origin.");
	}
	return [
		"zap-baseline.py",
		"-t",
		targetOrigin,
		"-m",
		"1",
		"-T",
		"3",
		"-J",
		outputPath,
	];
}

export function buildSchemathesisReadonlyCommand(
	schemaPath: string,
	targetOrigin: string,
	outputPath: string,
	operationPathRegex?: string,
): string[] {
	if (
		!/^https?:\/\/(?:127\.0\.0\.1|host\.docker\.internal)(?::\d+)?$/.test(
			targetOrigin,
		)
	) {
		throw new Error(
			"Schemathesis scan requires an auto-started loopback origin.",
		);
	}
	return [
		"run",
		schemaPath,
		"--url",
		targetOrigin,
		"--workers",
		"1",
		"--max-examples",
		"20",
		"--max-failures",
		"20",
		"--rate-limit",
		"2/s",
		"--max-redirects",
		"0",
		"--request-timeout",
		"10",
		"--request-retries",
		"0",
		"--generation-deterministic",
		"--include-method",
		"GET",
		"--include-method",
		"HEAD",
		"--include-method",
		"OPTIONS",
		...(operationPathRegex ? ["--include-path-regex", operationPathRegex] : []),
		"--report",
		"ndjson",
		"--report-ndjson-path",
		outputPath,
		"--output-sanitize",
		"true",
		"--output-truncate",
		"true",
	];
}

export function buildTrivySbomCommand(
	outputPath: string,
	repoPath: string,
): string[] {
	return ["fs", "--format", "cyclonedx", "--output", outputPath, repoPath];
}

export function buildTrivyImageCommand(
	input: { imageRef?: string; imageTar?: string },
	outputPath: string,
): string[] {
	if (input.imageRef && input.imageTar)
		throw new Error("Specify either image-ref or image-tar, not both.");
	if (!input.imageRef && !input.imageTar)
		throw new Error("An existing image ref or image tar is required.");
	return [
		"image",
		"--format",
		"json",
		"--output",
		outputPath,
		...(input.imageRef
			? [input.imageRef]
			: ["--input", input.imageTar as string]),
	];
}
