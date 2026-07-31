import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { authHeadersFor, redactDastEvidenceUrl } from "./auth-material";
import {
	analyzeBody,
	delayForRateLimit,
	discoverHtmlRoutes,
	emptyBodySignals,
	readBoundedBody,
	readNonNegativeInt,
	readPositiveInt,
	redactSetCookies,
	scopedRouteFromUrl,
	selectedHeaders,
} from "./bounded-crawler-observation";
import { evaluateDastCoverage } from "./coverage-evaluator";
import { pinnedDastFetch } from "./pinned-fetch";
import type { DastProfileDefinition } from "./profiles";
import { DastRequestBudget } from "./request-budget";
import { DastRouteInventory, type DastRouteSeed } from "./route-inventory";
import {
	collectDastSeeds,
	extractOpenApiReadOnlySeedResult,
} from "./seed-collector";
import type {
	DastHttpRawResult,
	DastHttpResponseObservation,
	ValidatedDastTarget,
} from "./types";

export type DastFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_DISCOVERED_URLS = 500;

export async function runBoundedHttpAssessment(params: {
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	profileConfigRoutes?: string[];
	checkOptions?: Record<string, unknown>;
	timeoutSec?: number;
	maxRequests?: number;
	fetchImpl?: DastFetch;
	authSecret?: DastAuthSecretPayload;
	projectRoot?: string;
}): Promise<DastHttpRawResult> {
	const startedAt = new Date();
	const fetchImpl =
		params.fetchImpl ??
		((input, init) => pinnedDastFetch(params.target, input, init));
	const maxRequests = Math.min(
		params.maxRequests ?? params.target.maxRequests,
		params.target.maxRequests,
		readPositiveInt(params.checkOptions?.aggregateRequestBudget) ??
			params.target.maxRequests,
	);
	const maxDiscoveredUrls = Math.min(
		readPositiveInt(params.checkOptions?.maxDiscoveredUrls) ??
			MAX_DISCOVERED_URLS,
		MAX_DISCOVERED_URLS,
	);
	const maxResponseBytes = Math.min(
		readPositiveInt(params.checkOptions?.maxResponseBytes) ??
			MAX_RESPONSE_BYTES,
		MAX_RESPONSE_BYTES,
	);
	const maxTotalResponseBytes = Math.min(
		readPositiveInt(params.checkOptions?.maxTotalResponseBytes) ??
			MAX_TOTAL_RESPONSE_BYTES,
		MAX_TOTAL_RESPONSE_BYTES,
	);
	const maxDepth = Math.min(
		readNonNegativeInt(params.checkOptions?.maxDepth) ?? params.target.maxDepth,
		params.target.maxDepth,
		3,
	);
	const timeoutMs =
		Math.min(
			params.timeoutSec ?? params.target.timeoutSec,
			params.target.timeoutSec,
		) * 1000;
	const totalTimeoutMs =
		Math.min(
			readPositiveInt(params.checkOptions?.totalTimeoutSec) ?? 600,
			600,
		) * 1000;
	const deadline = Date.now() + totalTimeoutMs;
	const authenticated = Boolean(params.authSecret);
	const inventory = new DastRouteInventory(params.target, maxDiscoveredUrls);
	const collected = await collectDastSeeds({
		configuredRoutes: params.profileConfigRoutes,
		projectRoot: params.projectRoot,
		includeApplicationModel:
			params.profile.crawlerEnabled &&
			params.checkOptions?.includeApplicationModelSeeds !== false,
		includeOpenApi:
			params.profile.crawlerEnabled &&
			params.checkOptions?.includeOpenApiSeeds !== false,
		authenticated,
		includeCommonProbes: params.checkOptions?.commonPathProbes !== false,
	});
	for (const seed of collected.seeds) inventory.add(seed);
	const warnings = [...params.target.warnings];
	const limitationCodes = [...collected.limitationCodes];
	const responses: DastHttpResponseObservation[] = [];
	const budget = new DastRequestBudget(maxRequests, maxTotalResponseBytes);

	while (true) {
		const entry = inventory
			.list()
			.find((candidate) => ["discovered", "planned"].includes(candidate.state));
		if (!entry) break;
		if (entry.depth > maxDepth) {
			inventory.mark(entry, "not_tested", {
				limitationCode: "max_depth_reached",
			});
			continue;
		}
		if (entry.queryKeys.includes("[secret-key]")) {
			limitationCodes.push("sensitive_query_parameter_omitted");
			inventory.mark(entry, "not_tested", {
				limitationCode: "sensitive_query_parameter_omitted",
			});
			continue;
		}
		if (Date.now() >= deadline) {
			limitationCodes.push("assessment_timeout");
			markRemaining(inventory, "assessment_timeout");
			break;
		}
		if (budget.remainingResponseBytes(maxResponseBytes) === 0) {
			limitationCodes.push("response_byte_budget_exhausted");
			markRemaining(inventory, "response_byte_budget_exhausted");
			break;
		}
		if (!budget.tryReserveRequest()) {
			limitationCodes.push("request_budget_exhausted");
			markRemaining(inventory, "request_budget_exhausted");
			break;
		}
		inventory.mark(entry, "attempted");
		if (responses.length > 0) {
			await delayForRateLimit(params.target.rateLimitPerSec);
		}
		const query = entry.queryKeys
			.map((key) => `${encodeURIComponent(key)}=`)
			.join("&");
		const url = new URL(
			`${entry.path}${query ? `?${query}` : ""}`,
			params.target.runnerOrigin,
		).toString();
		const requestStarted = performance.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response | null = null;
		try {
			response = await fetchImpl(url, {
				method: entry.method,
				headers: {
					...params.target.defaultHeaders,
					...authHeadersFor(params.authSecret),
				},
				redirect: "manual",
				signal: controller.signal,
			});
			const contentType = response.headers.get("content-type");
			const remaining = budget.remainingResponseBytes(maxResponseBytes);
			const body = await readBoundedBody(
				response,
				remaining,
				Math.min(timeoutMs, 1_000),
			);
			budget.recordResponseBytes(body.bytesRead);
			const signals = analyzeBody({
				path: entry.path,
				contentType,
				body: body.text,
			});
			const redirectChain: string[] = [];
			let finalUrl = response.url || url;
			const location = response.headers.get("location");
			if (location && response.status >= 300 && response.status < 400) {
				const next = scopedRouteFromUrl(location, url, params.target);
				if (next) {
					finalUrl = redactDastEvidenceUrl(
						new URL(location, url).toString(),
						params.authSecret,
					);
					redirectChain.push(finalUrl);
					addDiscoveredSeed(
						inventory,
						{
							path: next.path,
							source: "redirect",
							depth: entry.depth + 1,
							authMode: entry.authMode,
						},
						maxDepth,
					);
				} else {
					warnings.push("redirect out of scope blocked");
					limitationCodes.push("redirect_out_of_scope");
				}
			}
			if (params.profile.crawlerEnabled && entry.depth <= maxDepth) {
				for (const discovered of discoverHtmlRoutes(
					body.text,
					contentType,
					url,
				)) {
					addDiscoveredSeed(
						inventory,
						{
							...discovered,
							depth: entry.depth + 1,
							authMode: entry.authMode,
						},
						maxDepth,
					);
				}
				if (signals.openApiDocument && body.text) {
					try {
						const extracted = extractOpenApiReadOnlySeedResult(
							JSON.parse(body.text),
							entry.authMode,
						);
						limitationCodes.push(...extracted.limitationCodes);
						for (const seed of extracted.seeds) {
							addDiscoveredSeed(
								inventory,
								{ ...seed, depth: entry.depth + 1 },
								maxDepth,
							);
						}
					} catch {
						limitationCodes.push("openapi_parse_failed");
					}
				}
			}
			const classified = classifyHttpRoute({
				status: response.status,
				authenticated,
				commonProbe: entry.sources.includes("common_probe") && !entry.required,
				redirectOutOfScope:
					Boolean(location) &&
					response.status >= 300 &&
					response.status < 400 &&
					scopedRouteFromUrl(location as string, url, params.target) === null,
			});
			inventory.mark(entry, classified.state, {
				statusCode: response.status,
				limitationCode: classified.limitationCode,
			});
			const responseHeaders = selectedHeaders(response.headers);
			if (responseHeaders.location) {
				responseHeaders.location = redactDastEvidenceUrl(
					new URL(responseHeaders.location, url).toString(),
					params.authSecret,
				);
			}
			responses.push({
				path: entry.path,
				url,
				finalUrl,
				status: response.status,
				ok: response.ok,
				redirectChain,
				headers: responseHeaders,
				contentType,
				bodyBytesRead: body.bytesRead,
				bodyTruncated: body.truncated,
				bodySignals: signals,
				setCookies: redactSetCookies(response.headers),
				durationMs: Math.round(performance.now() - requestStarted),
				error: null,
			});
			if (body.truncated) limitationCodes.push("response_body_truncated");
			if (remaining === 0) {
				limitationCodes.push("response_byte_budget_exhausted");
				markRemaining(inventory, "response_byte_budget_exhausted");
				break;
			}
		} catch (error) {
			const errorCode =
				error instanceof Error && error.name === "AbortError"
					? "http_timeout"
					: "target_unreachable";
			inventory.mark(entry, "failed", { limitationCode: errorCode });
			responses.push({
				path: entry.path,
				url,
				finalUrl: url,
				status: null,
				ok: false,
				redirectChain: [],
				headers: {},
				contentType: null,
				bodyBytesRead: 0,
				bodyTruncated: false,
				bodySignals: emptyBodySignals(),
				setCookies: [],
				durationMs: Math.round(performance.now() - requestStarted),
				error: errorCode,
			});
		} finally {
			await response?.body?.cancel().catch(() => undefined);
			clearTimeout(timer);
		}
	}

	limitationCodes.push(...inventory.limitationCodes());
	const routeInventory = inventory.list();
	const evaluated = evaluateDastCoverage({
		routeInventory,
		requestCount: budget.requestCount,
		responseBytesRead: budget.responseBytes,
		findingCount: 0,
		budgetExhausted:
			limitationCodes.includes("request_budget_exhausted") ||
			limitationCodes.includes("response_byte_budget_exhausted"),
		authRequired: params.profile.requiresAuth,
		authSucceeded:
			!params.profile.requiresAuth ||
			!routeInventory.some(
				(entry) => entry.limitationCode === "authentication_failed",
			),
		limitationCodes,
	});
	return {
		kind: "http",
		profileId: params.profile.id,
		targetOrigin: params.target.normalizedOrigin,
		startedAt: startedAt.toISOString(),
		completedAt: new Date().toISOString(),
		requestCount: budget.requestCount,
		responses,
		routeInventory,
		coverage: evaluated.coverageSummary,
		warnings,
	};
}

function classifyHttpRoute(params: {
	status: number;
	authenticated: boolean;
	commonProbe: boolean;
	redirectOutOfScope: boolean;
}): {
	state:
		| "succeeded"
		| "denied_expected"
		| "denied_unexpected"
		| "blocked"
		| "failed";
	limitationCode: string | null;
} {
	if (params.redirectOutOfScope) {
		return { state: "failed", limitationCode: "redirect_out_of_scope" };
	}
	if (params.status === 401 || params.status === 403) {
		return params.authenticated
			? { state: "denied_unexpected", limitationCode: "authentication_failed" }
			: { state: "denied_expected", limitationCode: null };
	}
	if (params.status >= 200 && params.status < 400) {
		return { state: "succeeded", limitationCode: null };
	}
	if (params.commonProbe && (params.status === 404 || params.status === 410)) {
		return { state: "succeeded", limitationCode: null };
	}
	if (params.status === 404 || params.status === 410) {
		return { state: "failed", limitationCode: "route_not_found" };
	}
	if (params.status === 408) {
		return { state: "failed", limitationCode: "http_timeout" };
	}
	if (params.status === 429) {
		return { state: "failed", limitationCode: "target_throttled" };
	}
	if (params.status >= 500) {
		return { state: "failed", limitationCode: "server_error" };
	}
	return { state: "blocked", limitationCode: "request_shape_rejected" };
}

function addDiscoveredSeed(
	inventory: DastRouteInventory,
	seed: DastRouteSeed,
	maxDepth: number,
): void {
	const entry = inventory.add(seed);
	if (entry && (seed.depth ?? 0) > maxDepth) {
		inventory.mark(entry, "not_tested", {
			limitationCode: "max_depth_reached",
		});
	}
}

function markRemaining(
	inventory: DastRouteInventory,
	limitationCode: string,
): void {
	for (const entry of inventory.list()) {
		if (["discovered", "planned"].includes(entry.state)) {
			inventory.mark(entry, "not_tested", { limitationCode });
		}
	}
}
