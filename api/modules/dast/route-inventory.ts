import crypto from "node:crypto";
import { normalizeRelativeHttpPath } from "../../../shared/schemas/http-target.schema";
import type {
	DastRouteInventoryEntry,
	DastRouteSource,
	DastRouteState,
} from "../../../shared/schemas/dast-coverage.schema";
import { isPathAllowed } from "./target-validator";
import type { ValidatedDastTarget } from "./types";

export type DastRouteSeed = {
	method?: "GET" | "HEAD" | "OPTIONS";
	path: string;
	source: DastRouteSource;
	depth?: number;
	required?: boolean;
	authMode?: "anonymous" | "authenticated";
};

export function queryShapeHash(queryKeys: string[]): string {
	return crypto
		.createHash("sha256")
		.update([...queryKeys].sort().join("\0"))
		.digest("hex");
}

export function canonicalizeRoute(
	value: string,
	target: Pick<
		ValidatedDastTarget,
		"normalizedOrigin" | "runnerOrigin" | "allowedPaths" | "excludedPaths"
	>,
): { path: string; queryKeys: string[]; queryShapeHash: string } | null {
	let parsed: URL;
	try {
		parsed = new URL(value, target.normalizedOrigin);
	} catch {
		return null;
	}
	if (
		parsed.origin !== target.normalizedOrigin &&
		parsed.origin !== target.runnerOrigin
	) {
		return null;
	}
	const path = normalizeRelativeHttpPath(parsed.pathname);
	if (
		!path ||
		!isPathAllowed({
			path,
			allowedPaths: target.allowedPaths,
			excludedPaths: target.excludedPaths,
		})
	) {
		return null;
	}
	const queryKeys = [
		...new Set(
			[...parsed.searchParams.keys()]
				.filter((key) => !isTrackingQueryKey(key))
				.map((key) => redactQueryKey(key)),
		),
	].sort();
	if (queryKeys.some((key) => key.length === 0)) return null;
	return { path, queryKeys, queryShapeHash: queryShapeHash(queryKeys) };
}

export class DastRouteInventory {
	private readonly entriesByKey = new Map<string, DastRouteInventoryEntry>();
	private readonly queryShapesByRoute = new Map<string, Set<string>>();
	private discoveryLimitReached = false;
	private queryShapeLimitReached = false;

	constructor(
		private readonly target: Pick<
			ValidatedDastTarget,
			"normalizedOrigin" | "runnerOrigin" | "allowedPaths" | "excludedPaths"
		>,
		private readonly maxDiscoveredUrls = 500,
		private readonly maxQueryShapesPerPath = 3,
	) {}

	add(seed: DastRouteSeed): DastRouteInventoryEntry | null {
		const canonical = canonicalizeRoute(seed.path, this.target);
		if (!canonical) return null;
		const method = seed.method ?? "GET";
		const authMode = seed.authMode ?? "anonymous";
		const key = [
			method,
			canonical.path,
			canonical.queryShapeHash,
			authMode,
		].join("\0");
		const existing = this.entriesByKey.get(key);
		if (existing) {
			existing.sources = [
				...new Set([...existing.sources, seed.source]),
			].sort() as DastRouteSource[];
			existing.required ||= seed.required === true;
			existing.depth = Math.min(existing.depth, seed.depth ?? 0);
			return existing;
		}
		if (this.entriesByKey.size >= this.maxDiscoveredUrls) {
			this.discoveryLimitReached = true;
			return null;
		}
		const routeKey = [method, canonical.path, authMode].join("\0");
		const queryShapes =
			this.queryShapesByRoute.get(routeKey) ?? new Set<string>();
		if (
			!queryShapes.has(canonical.queryShapeHash) &&
			queryShapes.size >= this.maxQueryShapesPerPath
		) {
			this.queryShapeLimitReached = true;
			return null;
		}
		const entry: DastRouteInventoryEntry = {
			method,
			path: canonical.path,
			queryKeys: canonical.queryKeys,
			queryShapeHash: canonical.queryShapeHash,
			sources: [seed.source],
			depth: seed.depth ?? 0,
			required: seed.required ?? false,
			authMode,
			state: "discovered",
			statusCode: null,
			limitationCode: null,
		};
		this.entriesByKey.set(key, entry);
		queryShapes.add(canonical.queryShapeHash);
		this.queryShapesByRoute.set(routeKey, queryShapes);
		return entry;
	}

	mark(
		entry: DastRouteInventoryEntry,
		state: DastRouteState,
		options: {
			statusCode?: number | null;
			limitationCode?: string | null;
		} = {},
	): void {
		entry.state = state;
		if (options.statusCode !== undefined) entry.statusCode = options.statusCode;
		if (options.limitationCode !== undefined)
			entry.limitationCode = options.limitationCode;
	}

	list(): DastRouteInventoryEntry[] {
		return [...this.entriesByKey.values()].sort(
			(left, right) =>
				Number(right.required) - Number(left.required) ||
				left.depth - right.depth ||
				sourcePriority(left.sources) - sourcePriority(right.sources) ||
				left.path.localeCompare(right.path) ||
				left.method.localeCompare(right.method),
		);
	}

	limitationCodes(): string[] {
		return [
			...(this.discoveryLimitReached ? ["route_inventory_limit_reached"] : []),
			...(this.queryShapeLimitReached ? ["query_shape_limit_reached"] : []),
		];
	}
}

function sourcePriority(sources: DastRouteSource[]): number {
	const priority: DastRouteSource[] = [
		"configured",
		"readiness",
		"openapi",
		"application_model",
		"html_link",
		"browser_network",
		"redirect",
		"html_form",
		"common_probe",
	];
	return Math.min(...sources.map((source) => priority.indexOf(source)));
}

function isTrackingQueryKey(key: string): boolean {
	const lower = key.toLowerCase();
	return (
		lower.startsWith("utm_") ||
		["gclid", "fbclid", "mc_cid", "mc_eid"].includes(lower)
	);
}

function redactQueryKey(key: string): string {
	if (
		/(?:token|secret|password|passwd|authorization|api[_-]?key|session)/i.test(
			key,
		)
	) {
		return "[secret-key]";
	}
	return key.slice(0, 200);
}
