import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import { parseOpenApiDocument } from "./openapi-document";
import {
	MAX_STRICT_JSON_BYTES,
	parseStrictJsonDocument,
	readStrictJsonDocument,
} from "./strict-json-document";

const FILE_CANDIDATES = [
	"openapi.json",
	"swagger.json",
	"api/openapi.json",
	"docs/openapi.json",
];
const YAML_FILE_CANDIDATES = [
	"openapi.yaml",
	"openapi.yml",
	"swagger.yaml",
	"swagger.yml",
];
const HTTP_CANDIDATES = ["/openapi.json", "/swagger.json", "/v3/api-docs"];
const API_SOURCE_EXTENSIONS = new Set([
	".js",
	".cjs",
	".mjs",
	".ts",
	".cts",
	".mts",
	".jsx",
	".tsx",
]);
const IGNORED_SOURCE_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"dist-web",
	"build",
	"coverage",
	"artifacts",
]);
const MAX_API_EVIDENCE_FILES = 500;
const MAX_API_EVIDENCE_BYTES = 256 * 1024;

/**
 * This is intentionally a conservative source-evidence probe, not framework
 * detection. A package dependency alone is insufficient: the strict API
 * profile is blocked only when a bounded first-party source file actually
 * declares a conventional HTTP route or server bootstrap.
 */
const API_ROUTE_EVIDENCE =
	/\b(?:app|router|server|api)\s*\.\s*(?:get|post|put|patch|delete|head|options|use|route)\s*\(|\b(?:express|fastify)\s*\(|\bnew\s+(?:Hono|Elysia)\s*\(/;

export type SchemaDiscoveryResult = {
	applicable: boolean;
	/** A schema itself is API evidence; otherwise this comes from first-party route source. */
	apiDetected: boolean;
	apiEvidencePaths: string[];
	schemaPath: string | null;
	schemaDigest?: string;
	cleanupPath?: string;
	source: "repository" | "target" | null;
	reasonCode: string | null;
};

async function collectApiEvidencePaths(params: {
	root: string;
	directory?: string;
	paths?: string[];
	state?: { sourceFilesRead: number };
}): Promise<string[]> {
	const directory = params.directory ?? params.root;
	const paths = params.paths ?? [];
	const state = params.state ?? { sourceFilesRead: 0 };
	if (state.sourceFilesRead >= MAX_API_EVIDENCE_FILES) return paths;
	let entries: Dirent[];
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch {
		return paths;
	}
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (state.sourceFilesRead >= MAX_API_EVIDENCE_FILES) break;
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORED_SOURCE_DIRECTORIES.has(entry.name)) {
				await collectApiEvidencePaths({
					root: params.root,
					directory: entryPath,
					paths,
					state,
				});
			}
			continue;
		}
		if (
			!entry.isFile() ||
			!API_SOURCE_EXTENSIONS.has(path.extname(entry.name))
		) {
			continue;
		}
		state.sourceFilesRead += 1;
		const source = await fs.readFile(entryPath, "utf8").catch(() => null);
		if (
			source !== null &&
			source.length <= MAX_API_EVIDENCE_BYTES &&
			API_ROUTE_EVIDENCE.test(source)
		) {
			paths.push(path.relative(params.root, entryPath));
		}
	}
	return paths;
}

export async function detectRepositoryApiEvidence(repoPath: string): Promise<{
	detected: boolean;
	paths: string[];
}> {
	const paths = await collectApiEvidencePaths({ root: repoPath });
	return { detected: paths.length > 0, paths };
}

function looksLikeApiSchema(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		(typeof record.openapi === "string" && record.openapi.length > 0) ||
		(typeof record.swagger === "string" && record.swagger.length > 0) ||
		(typeof record.paths === "object" && record.paths !== null) ||
		(typeof record.asyncapi === "string" && record.asyncapi.length > 0)
	);
}

export async function discoverRepositoryApiSchema(
	repoPath: string,
): Promise<SchemaDiscoveryResult> {
	for (const candidate of FILE_CANDIDATES) {
		const candidatePath = path.resolve(repoPath, candidate);
		try {
			const document = await readStrictJsonDocument(candidatePath, repoPath);
			parseOpenApiDocument(document);
			const bytes = await fs.readFile(candidatePath);
			return {
				applicable: true,
				apiDetected: true,
				apiEvidencePaths: [candidate],
				schemaPath: candidatePath,
				schemaDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
				source: "repository",
				reasonCode: null,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				return {
					applicable: false,
					apiDetected: true,
					apiEvidencePaths: [candidate],
					schemaPath: null,
					source: null,
					reasonCode:
						error instanceof Error
							? error.message.split(":")[0]
							: "openapi_schema_required",
				};
			// bounded candidate lookup intentionally ignores missing files
		}
	}
	for (const candidate of YAML_FILE_CANDIDATES) {
		try {
			const stat = await fs.lstat(path.resolve(repoPath, candidate));
			if (stat.isFile() || stat.isSymbolicLink())
				return {
					applicable: false,
					apiDetected: true,
					apiEvidencePaths: [candidate],
					schemaPath: null,
					source: null,
					reasonCode: "openapi_yaml_not_qualified",
				};
		} catch {
			// missing YAML candidates are expected
		}
	}
	const apiEvidence = await detectRepositoryApiEvidence(repoPath);
	return {
		applicable: false,
		apiDetected: apiEvidence.detected,
		apiEvidencePaths: apiEvidence.paths,
		schemaPath: null,
		source: null,
		reasonCode: "schema_not_found",
	};
}

export async function discoverTargetApiSchema(params: {
	targetOrigin: string;
	fetchImpl?: (input: URL, init?: RequestInit) => Promise<Response>;
}): Promise<SchemaDiscoveryResult> {
	const fetchImpl = params.fetchImpl ?? fetch;
	for (const candidate of HTTP_CANDIDATES) {
		let tempRoot: string | null = null;
		try {
			const response = await fetchImpl(
				new URL(candidate, params.targetOrigin),
				{ method: "GET", redirect: "manual" },
			);
			if (response.status === 401 || response.status === 403)
				return {
					applicable: false,
					apiDetected: false,
					apiEvidencePaths: [],
					schemaPath: null,
					source: null,
					reasonCode: "authentication_required",
				};
			if (!response.ok) continue;
			const body = await response.text();
			const bytes = new TextEncoder().encode(body);
			if (bytes.byteLength > MAX_STRICT_JSON_BYTES) continue;
			let parsed: unknown;
			try {
				parsed = parseStrictJsonDocument(bytes);
				parseOpenApiDocument(parsed);
			} catch {
				continue;
			}
			if (!looksLikeApiSchema(parsed)) continue;
			tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vuln-schema-"));
			const tempPath = path.join(tempRoot, "openapi.json");
			await fs.writeFile(tempPath, body, "utf8");
			return {
				applicable: true,
				apiDetected: true,
				apiEvidencePaths: [candidate],
				schemaPath: tempPath,
				schemaDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
				cleanupPath: path.dirname(tempPath),
				source: "target",
				reasonCode: null,
			};
		} catch {
			if (tempRoot) {
				await cleanupTemporaryPaths(
					[tempRoot],
					"api_schema_discovery_cleanup_failed",
				);
			}
			// bounded probe; the caller records a coverage gap if no candidate works
		}
	}
	return {
		applicable: false,
		apiDetected: false,
		apiEvidencePaths: [],
		schemaPath: null,
		source: null,
		reasonCode: "schema_not_found",
	};
}

/**
 * Legacy discovery sequence. Profile execution intentionally uses the
 * repository-only probe first, so it can declare N/A without starting a target.
 */
export async function discoverApiSchema(params: {
	repoPath: string;
	targetOrigin?: string;
	fetchImpl?: (input: URL, init?: RequestInit) => Promise<Response>;
}): Promise<SchemaDiscoveryResult> {
	const repository = await discoverRepositoryApiSchema(params.repoPath);
	if (repository.applicable || !params.targetOrigin) return repository;
	return await discoverTargetApiSchema({
		targetOrigin: params.targetOrigin,
		fetchImpl: params.fetchImpl,
	});
}
