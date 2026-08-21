import crypto from "node:crypto";
import type {
	FindingDedupeIdentityV1,
	FindingDedupeLocation,
} from "../../../shared/schemas/finding-group.schema";
import {
	findingDedupeIdentitySchema,
	GROUPING_ALGORITHM_VERSION,
} from "../../../shared/schemas/finding-group.schema";
import { findingFamilyKeys, inferIssueKind } from "./finding-dedupe-families";

export type FindingIdentityInput = {
	sourceTool: string;
	ruleId: string;
	primaryLocation: Record<string, unknown> | null;
	metadata: Record<string, unknown> | null;
};

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const asPositiveInteger = (value: unknown): number | null => {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
};

const sorted = (values: Iterable<string>) =>
	[...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort(
		(a, b) => a.localeCompare(b),
	);

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort((left, right) => left.localeCompare(right))
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

/** Stable hashes must not depend on JavaScript object insertion order. */
export function canonicalJsonHash(value: unknown): string {
	return `sha256:${crypto
		.createHash("sha256")
		.update(canonicalJson(value))
		.digest("hex")}`;
}

export { GROUPING_ALGORITHM_VERSION };

export function normalizeProjectPath(value: string | null): string | null {
	if (!value) return null;
	const path = value
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/+/g, "/");
	if (!path || path === "." || path.startsWith("../") || path === "..") {
		return null;
	}
	return path;
}

export function normalizeUrl(value: string | null): {
	assetKey: string | null;
	path: string | null;
} {
	if (!value) return { assetKey: null, path: null };
	try {
		const url = new URL(value);
		const origin = url.origin.toLowerCase();
		const path = url.pathname.replace(/\/{2,}/g, "/") || "/";
		return { assetKey: `${origin}${path}`, path: `${origin}${path}` };
	} catch {
		return { assetKey: null, path: null };
	}
}

function advisoryIds(
	metadata: Record<string, unknown>,
	ruleId: string,
): string[] {
	const aliases = Array.isArray(metadata.aliases)
		? metadata.aliases.filter(
				(value): value is string => typeof value === "string",
			)
		: [];
	const primary = [
		asString(metadata.advisoryId),
		asString(metadata.vulnerabilityId),
		asString(metadata.id),
		...aliases,
		/^(?:CVE|GHSA)-/i.test(ruleId) ? ruleId : null,
	].filter((value): value is string => value !== null);
	return sorted(primary.map((value) => value.toUpperCase()));
}

function projectLocation(input: FindingIdentityInput): FindingDedupeLocation {
	const location = input.primaryLocation ?? {};
	const metadata = input.metadata ?? {};
	const urlValue = asString(location.url) ?? asString(metadata.url);
	const url = normalizeUrl(urlValue);
	const path = normalizeProjectPath(
		asString(location.path) ??
			asString(location.file) ??
			asString(metadata.path) ??
			asString(metadata.target),
	);
	const resource =
		asString(location.resource) ??
		asString(metadata.resource) ??
		asString(metadata.resourceName) ??
		null;
	const hasPackage =
		asString(metadata.packageName) !== null ||
		asString(metadata.package) !== null;
	return {
		kind: url.path
			? "url"
			: hasPackage
				? "package"
				: resource
					? "resource"
					: path
						? "source"
						: "unknown",
		path: url.path ?? path,
		startLine: asPositiveInteger(location.startLine ?? metadata.startLine),
		endLine: asPositiveInteger(location.endLine ?? metadata.endLine),
		startCol: asPositiveInteger(
			location.startCol ??
				location.column ??
				metadata.startCol ??
				metadata.column,
		),
		endCol: asPositiveInteger(location.endCol ?? metadata.endCol),
		method:
			(asString(location.method) ?? asString(metadata.method))?.toUpperCase() ??
			null,
		parameter:
			asString(location.parameter) ?? asString(metadata.parameter) ?? null,
		resource,
	};
}

function packageKey(metadata: Record<string, unknown>): string | null {
	const ecosystem = asString(metadata.ecosystem) ?? asString(metadata.type);
	const name = asString(metadata.packageName) ?? asString(metadata.package);
	const version =
		asString(metadata.installedVersion) ?? asString(metadata.packageVersion);
	if (!ecosystem || !name || !version) return null;
	return `${ecosystem.toLowerCase()}:${name.toLowerCase()}@${version}`;
}

function sourceAnchor(metadata: Record<string, unknown>, isSecret: boolean) {
	if (isSecret) return null;
	const value =
		asString(metadata.anchor) ??
		asString(metadata.symbol) ??
		asString(metadata.resource) ??
		null;
	if (!value) return null;
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/**
 * Raw finding rows remain untouched. Invalid or incomplete inputs become an
 * explicit unknown identity and therefore cannot be auto-merged.
 */
export function projectFindingDedupeIdentity(
	input: FindingIdentityInput,
): FindingDedupeIdentityV1 {
	try {
		const metadata = input.metadata ?? {};
		const issueKind = inferIssueKind(input);
		const location = projectLocation(input);
		const pkg = packageKey(metadata);
		const url = normalizeUrl(
			asString(input.primaryLocation?.url) ?? asString(metadata.url),
		);
		const assetKey =
			issueKind === "dependency"
				? [
						pkg,
						normalizeProjectPath(
							asString(metadata.manifestPath) ?? asString(metadata.target),
						),
					]
						.filter((value): value is string => Boolean(value))
						.join(":") || null
				: issueKind === "web" || issueKind === "api"
					? url.assetKey
					: location.path;
		const limitations: string[] = [];
		if (!assetKey) limitations.push("asset_key_missing");
		const identity = {
			version: 1 as const,
			issueKind,
			assetKey,
			location,
			familyKeys: findingFamilyKeys(input),
			advisoryIds: advisoryIds(metadata, input.ruleId),
			packageKey: pkg,
			anchor: sourceAnchor(metadata, issueKind === "secret"),
			limitations,
		};
		return findingDedupeIdentitySchema.parse(identity);
	} catch {
		return {
			version: 1,
			issueKind: "unknown",
			assetKey: null,
			location: {
				kind: "unknown",
				path: null,
				startLine: null,
				endLine: null,
				startCol: null,
				endCol: null,
				method: null,
				parameter: null,
				resource: null,
			},
			familyKeys: ["family:unknown"],
			advisoryIds: [],
			packageKey: null,
			anchor: null,
			limitations: ["identity_projection_failed"],
		};
	}
}
