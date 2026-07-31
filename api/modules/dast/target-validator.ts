import dns from "node:dns/promises";
import type { DastTargetConfig } from "../../../shared/schemas/dast.schema";
import {
	normalizeRelativeHttpPath,
	relativePathMatchesPrefix,
} from "../../../shared/schemas/http-target.schema";
import type { DastTargetValidationResult, ValidatedDastTarget } from "./types";

type AddressFamily = 4 | 6;

export type ResolveHost = (
	host: string,
) => Promise<Array<{ address: string; family: AddressFamily }>>;

export type ValidateDastTargetOptions = {
	requestedPath?: string;
	runner?: "host" | "docker";
	resolveHost?: ResolveHost;
};

const SECRET_HEADER_NAMES = new Set([
	"authorization",
	"cookie",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token",
]);
const TRANSPORT_CONTROLLED_HEADER_NAMES = new Set([
	"host",
	"content-length",
	"transfer-encoding",
	"connection",
	"upgrade",
	"te",
	"trailer",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCALHOST_ALIASES = new Set(["0.0.0.0", "::", "[::]"]);

function fail(
	reason: DastTargetValidationResult extends infer R
		? R extends { ok: false; reason: infer T }
			? T
			: never
		: never,
	message: string,
	resolvedAddresses: string[] = [],
	warnings: string[] = [],
): DastTargetValidationResult {
	return { ok: false, reason, message, warnings, resolvedAddresses };
}

export function normalizeDastOrigin(origin: string): string {
	const parsed = new URL(origin);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("unsupported_scheme");
	}
	if (parsed.username || parsed.password) {
		throw new Error("url_credentials_rejected");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("url_query_or_fragment_rejected");
	}
	if (parsed.pathname !== "/" && parsed.pathname !== "") {
		throw new Error("url_path_rejected");
	}
	if (parsed.hostname.includes("*")) {
		throw new Error("wildcard_host_rejected");
	}
	return parsed.origin;
}

function normalizePathList(
	paths: string[],
	fallback: string[],
): string[] | null {
	const source = paths.length > 0 ? paths : fallback;
	const normalized = source.map((path) => normalizeRelativeHttpPath(path));
	if (normalized.some((path) => path === null)) return null;
	return Array.from(new Set(normalized as string[]));
}

export function isPathAllowed(params: {
	path: string;
	allowedPaths: string[];
	excludedPaths: string[];
}): boolean {
	const path = normalizeRelativeHttpPath(params.path);
	if (!path) return false;
	const allowed = params.allowedPaths.some((prefix) =>
		relativePathMatchesPrefix(path, prefix),
	);
	const excluded = params.excludedPaths.some((prefix) =>
		relativePathMatchesPrefix(path, prefix),
	);
	return allowed && !excluded;
}

function ipv4ToNumber(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!/^\d+$/.test(part)) return null;
		const parsed = Number(part);
		if (parsed < 0 || parsed > 255) return null;
		value = value * 256 + parsed;
	}
	return value >>> 0;
}

function isIpv4InCidr(ip: string, cidrBase: string, bits: number): boolean {
	const ipNum = ipv4ToNumber(ip);
	const baseNum = ipv4ToNumber(cidrBase);
	if (ipNum === null || baseNum === null) return false;
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return (ipNum & mask) === (baseNum & mask);
}

function stripIpv6Brackets(host: string): string {
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isLoopbackAddress(address: string): boolean {
	const stripped = stripIpv6Brackets(address).toLowerCase();
	return (
		stripped === "localhost" ||
		stripped === "::1" ||
		stripped === "127.0.0.1" ||
		isIpv4InCidr(stripped, "127.0.0.0", 8) ||
		stripped === "::ffff:127.0.0.1"
	);
}

function isPrivateAddress(address: string): boolean {
	const stripped = stripIpv6Brackets(address).toLowerCase();
	return (
		isIpv4InCidr(stripped, "10.0.0.0", 8) ||
		isIpv4InCidr(stripped, "172.16.0.0", 12) ||
		isIpv4InCidr(stripped, "192.168.0.0", 16) ||
		stripped.startsWith("fc") ||
		stripped.startsWith("fd")
	);
}

function isMetadataOrLinkLocalAddress(address: string): boolean {
	const stripped = stripIpv6Brackets(address).toLowerCase();
	return (
		stripped === "169.254.169.254" ||
		isIpv4InCidr(stripped, "169.254.0.0", 16) ||
		stripped.startsWith("fe80:") ||
		stripped === "::ffff:169.254.169.254"
	);
}

function isLiteralAddress(host: string): boolean {
	const stripped = stripIpv6Brackets(host);
	return Boolean(ipv4ToNumber(stripped) !== null || stripped.includes(":"));
}

async function defaultResolveHost(
	host: string,
): Promise<Array<{ address: string; family: AddressFamily }>> {
	const results = await dns.lookup(host, { all: true });
	return results.map((item) => ({
		address: item.address,
		family: item.family as AddressFamily,
	}));
}

function buildRunnerOrigin(normalizedOrigin: string, runner?: string): string {
	if (runner !== "docker") return normalizedOrigin;
	const parsed = new URL(normalizedOrigin);
	if (
		parsed.hostname === "localhost" ||
		parsed.hostname === "127.0.0.1" ||
		parsed.hostname === "::1"
	) {
		parsed.hostname = "host.docker.internal";
	}
	return parsed.origin;
}

export async function validateDastTargetConfig(
	target: DastTargetConfig,
	options: ValidateDastTargetOptions = {},
): Promise<DastTargetValidationResult> {
	const warnings: string[] = [];
	if (!target.enabled) {
		return fail("target_disabled", "DAST target is disabled.");
	}

	let normalizedOrigin: string;
	try {
		normalizedOrigin = normalizeDastOrigin(target.origin);
	} catch (error) {
		const reason =
			error instanceof Error ? error.message : "unsupported_scheme";
		return fail(
			reason as "unsupported_scheme",
			`Invalid DAST target origin: ${reason}`,
		);
	}

	const parsed = new URL(normalizedOrigin);
	const host = parsed.hostname.toLowerCase();
	if (LOCALHOST_ALIASES.has(host)) {
		return fail(
			"localhost_alias_not_allowed",
			"Localhost aliases such as 0.0.0.0 are not allowed.",
		);
	}
	if (host.includes("*")) {
		return fail("wildcard_host_rejected", "Wildcard hosts are not allowed.");
	}

	const allowedPaths = normalizePathList(target.allowedPathsJson, ["/"]);
	const excludedPaths = normalizePathList(target.excludedPathsJson, []);
	if (!allowedPaths || !excludedPaths) {
		return fail(
			"invalid_path_config",
			"DAST target paths must be canonical single-origin HTTP paths.",
		);
	}
	if (
		options.requestedPath &&
		!isPathAllowed({
			path: options.requestedPath,
			allowedPaths,
			excludedPaths,
		})
	) {
		return fail("path_out_of_scope", "Requested path is outside target scope.");
	}

	for (const headerName of Object.keys(target.defaultHeadersJson ?? {})) {
		const normalizedHeaderName = headerName.toLowerCase();
		if (SECRET_HEADER_NAMES.has(normalizedHeaderName)) {
			return fail(
				"secret_header_rejected",
				"Secret-bearing default headers are not allowed for Phase 11 DAST.",
			);
		}
		if (TRANSPORT_CONTROLLED_HEADER_NAMES.has(normalizedHeaderName)) {
			return fail(
				"unsafe_header_rejected",
				"Transport-controlled default headers are not allowed for DAST.",
			);
		}
	}

	let resolved: Array<{ address: string; family: AddressFamily }>;
	try {
		if (LOOPBACK_HOSTS.has(host)) {
			resolved = [
				{ address: host === "localhost" ? "127.0.0.1" : host, family: 4 },
			];
		} else if (isLiteralAddress(host)) {
			resolved = [{ address: host, family: host.includes(":") ? 6 : 4 }];
		} else {
			resolved = await (options.resolveHost ?? defaultResolveHost)(host);
		}
	} catch {
		return fail(
			"target_resolution_failed",
			"Failed to resolve DAST target host.",
		);
	}

	const resolvedAddresses = resolved.map((item) => item.address);
	for (const address of resolvedAddresses) {
		if (isMetadataOrLinkLocalAddress(address)) {
			return fail(
				"metadata_service_target_rejected",
				"Metadata service and link-local targets are not allowed.",
				resolvedAddresses,
			);
		}
		if (isLoopbackAddress(address)) {
			if (!target.allowLoopback) {
				return fail(
					"private_network_target_not_allowed",
					"Loopback target requires allowLoopback=true.",
					resolvedAddresses,
				);
			}
			continue;
		}
		if (isPrivateAddress(address)) {
			if (!target.allowPrivateNetwork) {
				return fail(
					"private_network_target_not_allowed",
					"Private network target requires allowPrivateNetwork=true.",
					resolvedAddresses,
				);
			}
			warnings.push("private network target allowed by explicit config");
			continue;
		}
		return fail(
			"public_internet_target_rejected",
			"Public internet targets are not allowed in Phase 11.",
			resolvedAddresses,
		);
	}

	const result: ValidatedDastTarget = {
		ok: true,
		targetConfigId: target.id,
		normalizedOrigin,
		runnerOrigin: buildRunnerOrigin(normalizedOrigin, options.runner),
		allowedPaths,
		excludedPaths,
		defaultHeaders: target.defaultHeadersJson ?? {},
		maxDepth: target.maxDepth,
		maxRequests: target.maxRequests,
		rateLimitPerSec: target.rateLimitPerSec,
		timeoutSec: target.timeoutSec,
		resolvedAddresses,
		warnings,
	};
	return result;
}

export function isUrlInDastScope(
	url: string,
	target: Pick<
		ValidatedDastTarget,
		"normalizedOrigin" | "allowedPaths" | "excludedPaths"
	>,
): boolean {
	const parsed = new URL(url);
	if (parsed.origin !== target.normalizedOrigin) return false;
	return isPathAllowed({
		path: parsed.pathname,
		allowedPaths: target.allowedPaths,
		excludedPaths: target.excludedPaths,
	});
}
