import path from "node:path";
import { z } from "zod";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const pinnedImagePattern = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/;

type SanitizedSemgrepEvidenceResult = {
	check_id: string;
	path: string;
	start: Record<string, number> | null;
	end: Record<string, number> | null;
	extra: {
		metadata: {
			cwe?: string | number | Array<string | number>;
		};
	};
};

const corpusEvidencePathSchema = z
	.string()
	.max(4_096)
	.superRefine((value, context) => {
		const segments = value.split("/");
		if (
			segments[0] !== "corpus" ||
			segments.length < 2 ||
			value.includes("\\") ||
			value.includes("\0") ||
			/[\r\n]/.test(value) ||
			segments.some(
				(segment) => segment === "" || segment === "." || segment === "..",
			)
		) {
			context.addIssue({
				code: "custom",
				message: "invalid_corpus_evidence_path",
			});
		}
	});

const semgrepPositionSchema = z
	.object({
		line: z.number().int().nonnegative().optional(),
		col: z.number().int().nonnegative().optional(),
		offset: z.number().int().nonnegative().optional(),
	})
	.strict()
	.nullable();

export const sanitizedSemgrepEvidenceArtifactSchema = z
	.object({
		schemaVersion: z.literal(1),
		artifactKind: z.literal("sanitized_semgrep_result"),
		scannerVersion: z.string().min(1).max(100).nullable(),
		errors: z.tuple([]),
		results: z.array(
			z
				.object({
					check_id: z.string().min(1).max(500),
					path: corpusEvidencePathSchema,
					start: semgrepPositionSchema,
					end: semgrepPositionSchema,
					extra: z
						.object({
							metadata: z
								.object({
									cwe: z
										.union([
											z.string().max(100),
											z.number(),
											z.array(z.union([z.string().max(100), z.number()])),
										])
										.optional(),
								})
								.strict(),
						})
						.strict(),
				})
				.strict(),
		),
		vulnWorkbenchSuppressed: z.array(
			z
				.object({
					checkId: z.string().min(1).max(500),
					path: corpusEvidencePathSchema,
					line: z.number().int().nonnegative().nullable(),
					reason: z.enum([
						"contextual_output_encoding",
						"constant_branch",
						"constant_switch",
						"collection_overwrite",
						"constant_interprocedural_flow",
					]),
				})
				.strict(),
		),
	})
	.strict();

export function pinnedImageDigest(image: string): string {
	if (!pinnedImagePattern.test(image)) {
		throw new Error("owasp_semgrep_image_must_be_digest_pinned");
	}
	const digest = image.slice(image.lastIndexOf("@") + 1);
	if (!digestPattern.test(digest)) {
		throw new Error("owasp_semgrep_image_digest_invalid");
	}
	return digest;
}

export function buildPinnedSemgrepDockerCommand(params: {
	image: string;
	expectedImageDigest?: string;
	repositoryRoot: string;
	corpusSource: string;
	rawOutputPath: string;
}): string[] {
	const digest = pinnedImageDigest(params.image);
	if (
		params.expectedImageDigest !== undefined &&
		digest !== params.expectedImageDigest
	) {
		throw new Error("owasp_semgrep_image_digest_mismatch");
	}

	const repositoryRoot = safeMountPath(params.repositoryRoot);
	const corpusSource = safeMountPath(params.corpusSource);
	const outputRoot = safeMountPath(path.dirname(params.rawOutputPath));
	const outputName = path.basename(params.rawOutputPath);
	if (!/^[a-z0-9][a-z0-9._-]{0,199}$/i.test(outputName)) {
		throw new Error("owasp_semgrep_output_name_invalid");
	}

	return [
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"256",
		"--env",
		"SEMGREP_SEND_METRICS=off",
		"--env",
		"SEMGREP_ENABLE_VERSION_CHECK=0",
		"--mount",
		`type=bind,src=${repositoryRoot},dst=/src,readonly`,
		"--mount",
		`type=bind,src=${corpusSource},dst=/workspace/corpus,readonly`,
		"--mount",
		`type=bind,src=${outputRoot},dst=/workspace/output`,
		"--workdir",
		"/src",
		params.image,
		"semgrep",
		"scan",
		"--strict",
		"--config",
		"/src/docker/toolbox/scanner-data/semgrep-rules",
		"--json",
		"--output",
		`/workspace/output/${outputName}`,
		"--quiet",
		"--no-git-ignore",
		"/workspace/corpus",
	];
}

export function buildPinnedSemgrepRepositoryCommand(params: {
	image: string;
	expectedImageDigest?: string;
	repositoryRoot: string;
	semgrepArguments: string[];
}): string[] {
	const digest = pinnedImageDigest(params.image);
	if (
		params.expectedImageDigest !== undefined &&
		digest !== params.expectedImageDigest
	) {
		throw new Error("owasp_semgrep_image_digest_mismatch");
	}
	if (
		params.semgrepArguments.length === 0 ||
		params.semgrepArguments.some(
			(argument) => argument.includes("\0") || /[\r\n]/.test(argument),
		)
	) {
		throw new Error("semgrep_container_arguments_invalid");
	}
	const repositoryRoot = safeMountPath(params.repositoryRoot);
	return [
		"docker",
		"run",
		"--rm",
		"--network",
		"none",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"256",
		"--env",
		"SEMGREP_SEND_METRICS=off",
		"--env",
		"SEMGREP_ENABLE_VERSION_CHECK=0",
		"--mount",
		`type=bind,src=${repositoryRoot},dst=/src,readonly`,
		"--workdir",
		"/src",
		params.image,
		"semgrep",
		...params.semgrepArguments,
	];
}

export function containerCorpusPathToHost(
	containerPath: string,
	corpusSource: string,
): string {
	const containerRoot = "/workspace/corpus";
	if (containerPath === containerRoot) return path.resolve(corpusSource);
	if (!containerPath.startsWith(`${containerRoot}/`)) {
		throw new Error("owasp_semgrep_container_result_path_outside_corpus");
	}
	const relative = containerPath.slice(containerRoot.length + 1);
	if (
		relative.length === 0 ||
		relative.includes("\\") ||
		relative.includes("\0") ||
		relative.split("/").some((segment) => segment === "" || segment === "..")
	) {
		throw new Error("owasp_semgrep_container_result_path_invalid");
	}
	const hostPath = path.resolve(corpusSource, ...relative.split("/"));
	const hostRoot = path.resolve(corpusSource);
	const hostRelative = path.relative(hostRoot, hostPath);
	if (
		hostRelative === ".." ||
		hostRelative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(hostRelative)
	) {
		throw new Error("owasp_semgrep_container_result_path_escaped");
	}
	return hostPath;
}

export function hostCorpusPath(filePath: string, corpusSource: string): string {
	if (
		filePath.length === 0 ||
		filePath.includes("\0") ||
		/[\r\n]/.test(filePath)
	) {
		throw new Error("owasp_semgrep_host_result_path_invalid");
	}
	const hostRoot = path.resolve(corpusSource);
	const candidates = path.isAbsolute(filePath)
		? [path.resolve(filePath)]
		: [path.resolve(filePath), path.resolve(hostRoot, filePath)];
	const hostPath = candidates.find((candidate) =>
		isPathInsideRoot(candidate, hostRoot),
	);
	if (!hostPath) {
		throw new Error("owasp_semgrep_host_result_path_outside_corpus");
	}
	return hostPath;
}

export function hostCorpusPathToEvidencePath(
	filePath: string,
	corpusSource: string,
): string {
	const hostRoot = path.resolve(corpusSource);
	const relative = path.relative(
		hostRoot,
		hostCorpusPath(filePath, corpusSource),
	);
	return `corpus/${relative.split(path.sep).join("/")}`;
}

export function repositoryRelativeEvidencePath(
	filePath: string,
	repositoryRoot = process.cwd(),
): string {
	if (filePath.includes("\0") || /[\r\n]/.test(filePath)) {
		throw new Error("owasp_evidence_path_invalid");
	}
	const root = path.resolve(repositoryRoot);
	const relative = path.relative(root, path.resolve(filePath));
	if (
		relative.length === 0 ||
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error("owasp_evidence_path_outside_repository");
	}
	return relative.split(path.sep).join("/");
}

export function sanitizeSemgrepEvidenceArtifact(
	input: unknown,
	corpusSource: string,
): {
	schemaVersion: 1;
	artifactKind: "sanitized_semgrep_result";
	scannerVersion: string | null;
	errors: [];
	results: SanitizedSemgrepEvidenceResult[];
	vulnWorkbenchSuppressed: Array<Record<string, unknown>>;
} {
	if (!isRecord(input) || !Array.isArray(input.results)) {
		throw new Error("owasp_semgrep_result_envelope_invalid");
	}
	if (Array.isArray(input.errors) && input.errors.length > 0) {
		throw new Error("owasp_semgrep_reported_errors");
	}
	const results = input.results.map((rawResult) => {
		if (!isRecord(rawResult)) {
			throw new Error("owasp_semgrep_result_invalid");
		}
		const checkId = rawResult.check_id;
		const resultPath = rawResult.path;
		if (typeof checkId !== "string" || typeof resultPath !== "string") {
			throw new Error("owasp_semgrep_result_identity_invalid");
		}
		const extra = isRecord(rawResult.extra) ? rawResult.extra : {};
		const metadata = isRecord(extra.metadata) ? extra.metadata : {};
		const sanitizedMetadata: SanitizedSemgrepEvidenceResult["extra"]["metadata"] =
			{};
		const cwe = metadata.cwe;
		if (
			typeof cwe === "string" ||
			typeof cwe === "number" ||
			(Array.isArray(cwe) &&
				cwe.every(
					(value) => typeof value === "string" || typeof value === "number",
				))
		) {
			sanitizedMetadata.cwe = cwe;
		}
		return {
			check_id: checkId,
			path: hostCorpusPathToEvidencePath(resultPath, corpusSource),
			start: sanitizePosition(rawResult.start),
			end: sanitizePosition(rawResult.end),
			extra: { metadata: sanitizedMetadata },
		};
	});
	const suppressions = Array.isArray(input.vulnWorkbenchSuppressed)
		? input.vulnWorkbenchSuppressed.map((rawSuppression) => {
				if (!isRecord(rawSuppression)) {
					throw new Error("owasp_semgrep_suppression_invalid");
				}
				if (
					typeof rawSuppression.checkId !== "string" ||
					typeof rawSuppression.path !== "string" ||
					typeof rawSuppression.reason !== "string"
				) {
					throw new Error("owasp_semgrep_suppression_identity_invalid");
				}
				return {
					checkId: rawSuppression.checkId,
					path: hostCorpusPathToEvidencePath(rawSuppression.path, corpusSource),
					line:
						typeof rawSuppression.line === "number"
							? rawSuppression.line
							: null,
					reason: rawSuppression.reason,
				};
			})
		: [];
	return sanitizedSemgrepEvidenceArtifactSchema.parse({
		schemaVersion: 1,
		artifactKind: "sanitized_semgrep_result",
		scannerVersion: typeof input.version === "string" ? input.version : null,
		errors: [],
		results,
		vulnWorkbenchSuppressed: suppressions,
	});
}

function sanitizePosition(value: unknown): Record<string, number> | null {
	if (!isRecord(value)) return null;
	const position: Record<string, number> = {};
	for (const key of ["line", "col", "offset"] as const) {
		const item = value[key];
		if (typeof item === "number" && Number.isInteger(item) && item >= 0) {
			position[key] = item;
		}
	}
	return Object.keys(position).length > 0 ? position : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative.length > 0 &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function safeMountPath(value: string): string {
	const resolved = path.resolve(value);
	if (
		resolved.includes(",") ||
		resolved.includes("\0") ||
		/[\r\n]/.test(resolved)
	) {
		throw new Error("owasp_semgrep_mount_path_invalid");
	}
	return resolved;
}
