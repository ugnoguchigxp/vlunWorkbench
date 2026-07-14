import fs from "node:fs/promises";
import path from "node:path";

const FILE_CANDIDATES = [
	"openapi.json",
	"openapi.yaml",
	"openapi.yml",
	"swagger.json",
	"swagger.yaml",
	"swagger.yml",
	"api/openapi.json",
	"docs/openapi.json",
];
const HTTP_CANDIDATES = ["/openapi.json", "/swagger.json", "/v3/api-docs"];

export type SchemaDiscoveryResult = {
	applicable: boolean;
	schemaPath: string | null;
	cleanupPath?: string;
	source: "repository" | "target" | null;
	reasonCode: "schema_not_found" | "authentication_required" | null;
};

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

export async function discoverApiSchema(params: {
	repoPath: string;
	targetOrigin?: string;
	fetchImpl?: (input: URL, init?: RequestInit) => Promise<Response>;
}): Promise<SchemaDiscoveryResult> {
	for (const candidate of FILE_CANDIDATES) {
		const candidatePath = path.resolve(params.repoPath, candidate);
		try {
			const stat = await fs.stat(candidatePath);
			if (stat.isFile())
				return {
					applicable: true,
					schemaPath: candidatePath,
					source: "repository",
					reasonCode: null,
				};
		} catch {
			// bounded candidate lookup intentionally ignores missing files
		}
	}
	if (params.targetOrigin) {
		const fetchImpl = params.fetchImpl ?? fetch;
		for (const candidate of HTTP_CANDIDATES) {
			try {
				const response = await fetchImpl(
					new URL(candidate, params.targetOrigin),
					{ method: "GET", redirect: "manual" },
				);
				if (response.status === 401 || response.status === 403)
					return {
						applicable: false,
						schemaPath: null,
						source: null,
						reasonCode: "authentication_required",
					};
				if (!response.ok) continue;
				const body = await response.text();
				let parsed: unknown;
				try {
					parsed = JSON.parse(body);
				} catch {
					continue;
				}
				if (!looksLikeApiSchema(parsed)) continue;
				const tempPath = path.join(
					await fs.mkdtemp(path.join("/tmp", "vuln-schema-")),
					"openapi.json",
				);
				await fs.writeFile(tempPath, body, "utf8");
				return {
					applicable: true,
					schemaPath: tempPath,
					cleanupPath: path.dirname(tempPath),
					source: "target",
					reasonCode: null,
				};
			} catch {
				// bounded probe; the caller records a coverage gap if no candidate works
			}
		}
	}
	return {
		applicable: false,
		schemaPath: null,
		source: null,
		reasonCode: "schema_not_found",
	};
}
