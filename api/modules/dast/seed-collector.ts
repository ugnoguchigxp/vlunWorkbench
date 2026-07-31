import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRelativeHttpPath } from "../../../shared/schemas/http-target.schema";
import { extractEndpoints } from "../threat-models/endpoint-extractors";
import { readProjectModelSources } from "../threat-models/project-source-reader";
import type { DastRouteSeed } from "./route-inventory";

const OPENAPI_FILES = [
	"openapi.json",
	"swagger.json",
	"api/openapi.json",
	"docs/openapi.json",
];

export async function collectDastSeeds(params: {
	configuredRoutes?: string[];
	projectRoot?: string;
	includeApplicationModel?: boolean;
	includeOpenApi?: boolean;
	authenticated?: boolean;
	includeCommonProbes?: boolean;
}): Promise<{ seeds: DastRouteSeed[]; limitationCodes: string[] }> {
	const authMode = params.authenticated ? "authenticated" : "anonymous";
	const seeds: DastRouteSeed[] = [];
	const limitationCodes: string[] = [];
	const configured =
		params.configuredRoutes && params.configuredRoutes.length > 0
			? params.configuredRoutes
			: ["/"];
	for (const route of configured) {
		seeds.push({
			path: route,
			source: "configured",
			required: true,
			authMode,
		});
	}
	if (params.includeCommonProbes !== false) {
		for (const route of ["/.env", "/openapi.json", "/swagger.json", "/debug"]) {
			seeds.push({ path: route, source: "common_probe", authMode });
		}
	}
	if (params.projectRoot && params.includeApplicationModel !== false) {
		try {
			const sources = await readProjectModelSources(params.projectRoot, {
				maxFiles: 500,
				maxFileBytes: 512 * 1024,
				maxTotalBytes: 5 * 1024 * 1024,
				maxEntries: 20_000,
				maxDepth: 32,
			});
			for (const endpoint of sources.flatMap(extractEndpoints)) {
				if (!["GET", "HEAD", "OPTIONS"].includes(endpoint.method)) continue;
				const route = executablePath(endpoint.path);
				if (!route) {
					limitationCodes.push("parameter_example_missing");
					continue;
				}
				seeds.push({
					method: endpoint.method as "GET" | "HEAD" | "OPTIONS",
					path: route,
					source: "application_model",
					authMode,
				});
			}
		} catch {
			limitationCodes.push("application_model_sources_unavailable");
		}
	}
	if (params.projectRoot && params.includeOpenApi !== false) {
		const schema = await readRepositoryOpenApi(params.projectRoot);
		if (schema) {
			const extracted = extractOpenApiReadOnlySeedResult(schema, authMode);
			seeds.push(...extracted.seeds);
			limitationCodes.push(...extracted.limitationCodes);
		}
	}
	return {
		seeds,
		limitationCodes: [...new Set(limitationCodes)].sort(),
	};
}

export function extractOpenApiReadOnlySeeds(
	value: unknown,
	authMode: "anonymous" | "authenticated" = "anonymous",
): DastRouteSeed[] {
	return extractOpenApiReadOnlySeedResult(value, authMode).seeds;
}

export function extractOpenApiReadOnlySeedResult(
	value: unknown,
	authMode: "anonymous" | "authenticated" = "anonymous",
): { seeds: DastRouteSeed[]; limitationCodes: string[] } {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { seeds: [], limitationCodes: [] };
	const paths = (value as Record<string, unknown>).paths;
	if (!paths || typeof paths !== "object" || Array.isArray(paths))
		return { seeds: [], limitationCodes: [] };
	const output: DastRouteSeed[] = [];
	const limitationCodes: string[] = [];
	for (const [routeTemplate, item] of Object.entries(paths)) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const pathItem = item as Record<string, unknown>;
		for (const method of ["get", "head", "options"] as const) {
			if (!(method in pathItem)) continue;
			const operation = asRecord(pathItem[method]);
			const route = executableOpenApiPath(routeTemplate, [
				...readParameters(pathItem.parameters),
				...readParameters(operation?.parameters),
			]);
			if (!route) {
				limitationCodes.push("parameter_example_missing");
				continue;
			}
			output.push({
				method: method.toUpperCase() as "GET" | "HEAD" | "OPTIONS",
				path: route,
				source: "openapi",
				authMode,
			});
		}
	}
	return {
		seeds: output,
		limitationCodes: [...new Set(limitationCodes)].sort(),
	};
}

async function readRepositoryOpenApi(
	projectRoot: string,
): Promise<unknown | null> {
	for (const candidate of OPENAPI_FILES) {
		try {
			return JSON.parse(
				await readFile(path.resolve(projectRoot, candidate), "utf8"),
			);
		} catch {
			// The bounded candidate list intentionally ignores missing/invalid files.
		}
	}
	return null;
}

function executablePath(value: string): string | null {
	if (/(?:\/:[A-Za-z_][\w-]*|\/\{[A-Za-z_][\w-]*\})/.test(value)) return null;
	return normalizeRelativeHttpPath(value);
}

function executableOpenApiPath(
	value: string,
	parameters: Array<Record<string, unknown>>,
): string | null {
	let route = value;
	for (const match of value.matchAll(/\{([A-Za-z_][\w-]*)\}/g)) {
		const name = match[1];
		const parameter = parameters.find(
			(candidate) => candidate.in === "path" && candidate.name === name,
		);
		const schema = asRecord(parameter?.schema);
		const example =
			parameter?.example ??
			schema?.example ??
			schema?.default ??
			(Array.isArray(schema?.enum) ? schema.enum[0] : undefined);
		if (
			!["string", "number", "boolean"].includes(typeof example) ||
			String(example).length === 0
		) {
			return null;
		}
		route = route.replace(`{${name}}`, encodeURIComponent(String(example)));
	}
	return executablePath(route);
}

function readParameters(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value)
		? value.filter(
				(item): item is Record<string, unknown> =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
