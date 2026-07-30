import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { authHeadersFor } from "./auth-material";
import { pinnedDastFetch } from "./pinned-fetch";
import type { DastProfileDefinition } from "./profiles";
import { isPathAllowed, isUrlInDastScope } from "./target-validator";
import type {
	DastHttpRawResult,
	DastHttpResponseObservation,
	ValidatedDastTarget,
} from "./types";

export type DastFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const DEFAULT_COMMON_PROBES = [
	"/.env",
	"/openapi.json",
	"/swagger.json",
	"/debug",
];

function redactSetCookie(value: string): Array<{
	name: string;
	attributes: string[];
	secure: boolean;
	httpOnly: boolean;
	sameSite: boolean;
}> {
	return value
		.split(/,(?=[^;,]+=)/)
		.map((cookie) => {
			const parts = cookie.split(";").map((part) => part.trim());
			const [namePart] = parts;
			const name = namePart.split("=")[0] || "unknown";
			const attributes = parts.slice(1).map((part) => part.split("=")[0]);
			const lowerAttributes = attributes.map((part) => part.toLowerCase());
			return {
				name,
				attributes,
				secure: lowerAttributes.includes("secure"),
				httpOnly: lowerAttributes.includes("httponly"),
				sameSite: lowerAttributes.includes("samesite"),
			};
		})
		.filter((cookie) => cookie.name.length > 0);
}

function selectedHeaders(headers: Headers): Record<string, string> {
	const keep = new Set([
		"content-security-policy",
		"x-frame-options",
		"x-content-type-options",
		"referrer-policy",
		"permissions-policy",
		"access-control-allow-origin",
		"set-cookie",
		"content-type",
		"location",
		"server",
	]);
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		if (!keep.has(key.toLowerCase())) return;
		result[key.toLowerCase()] =
			key.toLowerCase() === "set-cookie" ? "[redacted-cookie-value]" : value;
	});
	return result;
}

function routePathsForRun(params: {
	target: ValidatedDastTarget;
	profileConfigRoutes?: string[];
	checkOptions?: Record<string, unknown>;
}): string[] {
	const baseRoutes =
		params.profileConfigRoutes && params.profileConfigRoutes.length > 0
			? params.profileConfigRoutes
			: ["/"];
	const includeCommonProbes =
		params.checkOptions?.commonPathProbes === true ||
		params.checkOptions?.commonPathProbes === undefined;
	const probes = includeCommonProbes ? DEFAULT_COMMON_PROBES : [];
	const candidates = [...baseRoutes, ...probes];
	const scoped = candidates.filter((path) =>
		isPathAllowed({
			path,
			allowedPaths: params.target.allowedPaths,
			excludedPaths: params.target.excludedPaths,
		}),
	);
	return Array.from(new Set(scoped)).slice(0, params.target.maxRequests);
}

async function delayForRateLimit(rateLimitPerSec: number): Promise<void> {
	if (rateLimitPerSec <= 0) return;
	const delayMs = Math.ceil(1000 / rateLimitPerSec);
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runHttpBaseline(params: {
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	profileConfigRoutes?: string[];
	checkOptions?: Record<string, unknown>;
	timeoutSec?: number;
	maxRequests?: number;
	fetchImpl?: DastFetch;
	authSecret?: DastAuthSecretPayload;
}): Promise<DastHttpRawResult> {
	const startedAt = new Date();
	const fetchImpl =
		params.fetchImpl ??
		((input, init) => pinnedDastFetch(params.target, input, init));
	const maxRequests = Math.min(
		params.maxRequests ?? params.target.maxRequests,
		params.target.maxRequests,
	);
	const paths = routePathsForRun({
		target: params.target,
		profileConfigRoutes: params.profileConfigRoutes,
		checkOptions: params.checkOptions,
	}).slice(0, maxRequests);
	const responses: DastHttpResponseObservation[] = [];
	const warnings = [...params.target.warnings];
	const timeoutMs =
		Math.min(
			params.timeoutSec ?? params.target.timeoutSec,
			params.target.timeoutSec,
		) * 1000;

	for (const path of paths) {
		if (responses.length > 0) {
			await delayForRateLimit(params.target.rateLimitPerSec);
		}
		const url = new URL(path, params.target.runnerOrigin).toString();
		const requestStarted = performance.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response | null = null;
		try {
			response = await fetchImpl(url, {
				method: "GET",
				headers: {
					...params.target.defaultHeaders,
					...authHeadersFor(params.authSecret),
				},
				redirect: "manual",
				signal: controller.signal,
			});
			const location = response.headers.get("location");
			const redirectChain: string[] = [];
			let finalUrl = response.url || url;
			if (location && response.status >= 300 && response.status < 400) {
				const nextUrl = new URL(location, url).toString();
				redirectChain.push(nextUrl);
				if (!isUrlInDastScope(nextUrl, params.target)) {
					warnings.push(`redirect out of scope blocked: ${nextUrl}`);
				} else {
					finalUrl = nextUrl;
				}
			}
			responses.push({
				path,
				url,
				finalUrl,
				status: response.status,
				ok: response.ok,
				redirectChain,
				headers: selectedHeaders(response.headers),
				setCookies: response.headers.get("set-cookie")
					? redactSetCookie(response.headers.get("set-cookie") ?? "")
					: [],
				durationMs: Math.round(performance.now() - requestStarted),
				error: null,
			});
		} catch (error) {
			responses.push({
				path,
				url,
				finalUrl: url,
				status: null,
				ok: false,
				redirectChain: [],
				headers: {},
				setCookies: [],
				durationMs: Math.round(performance.now() - requestStarted),
				error:
					error instanceof Error && error.name === "AbortError"
						? "http_timeout"
						: error instanceof Error
							? error.message
							: "target_unreachable",
			});
		} finally {
			await response?.body?.cancel().catch(() => undefined);
			clearTimeout(timer);
		}
	}

	return {
		kind: "http",
		profileId: params.profile.id,
		targetOrigin: params.target.normalizedOrigin,
		startedAt: startedAt.toISOString(),
		completedAt: new Date().toISOString(),
		requestCount: responses.length,
		responses,
		warnings,
	};
}
