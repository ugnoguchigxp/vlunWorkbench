import type { DastProfileDefinition } from "./profiles";
import { evaluateDastCoverage } from "./coverage-evaluator";
import { DastRouteInventory } from "./route-inventory";
import { isPathAllowed, isUrlInDastScope } from "./target-validator";
import type {
	DastBrowserRawResult,
	DastBrowserRouteObservation,
	ValidatedDastTarget,
} from "./types";

export type BrowserRouteResult = Omit<
	DastBrowserRouteObservation,
	"path" | "url" | "durationMs"
>;

export interface DastBrowserAdapter {
	loadRoute(params: {
		url: string;
		path: string;
		timeoutMs: number;
	}): Promise<BrowserRouteResult>;
	requestCount?(): number;
	close?(): Promise<void>;
}

export class UnavailableBrowserAdapter implements DastBrowserAdapter {
	async loadRoute(): Promise<BrowserRouteResult> {
		throw new Error("browser_unavailable");
	}
}

export class MockBrowserAdapter implements DastBrowserAdapter {
	private loadedRouteCount = 0;

	constructor(
		private readonly responses: Record<
			string,
			Partial<BrowserRouteResult>
		> = {},
	) {}

	async loadRoute(params: {
		url: string;
		path: string;
		timeoutMs: number;
	}): Promise<BrowserRouteResult> {
		this.loadedRouteCount += 1;
		const configured = this.responses[params.path] ?? {};
		return {
			finalUrl: configured.finalUrl ?? params.url,
			status: configured.status ?? 200,
			requestBudgetExhausted: configured.requestBudgetExhausted ?? false,
			consoleErrors: configured.consoleErrors ?? [],
			pageErrors: configured.pageErrors ?? [],
			failedRequests: configured.failedRequests ?? [],
			networkRequests: configured.networkRequests ?? [],
			screenshot: configured.screenshot ?? {
				filename: `${params.path.replace(/[^a-zA-Z0-9]/g, "_") || "root"}.png`,
				bytes: new Uint8Array([137, 80, 78, 71]),
			},
			error: configured.error ?? null,
		};
	}

	requestCount(): number {
		return this.loadedRouteCount;
	}
}

function routePathsForBrowser(params: {
	target: ValidatedDastTarget;
	profileConfigRoutes?: string[];
}): string[] {
	const candidates = params.profileConfigRoutes ?? [];
	const scoped = candidates.filter((path) =>
		isPathAllowed({
			path,
			allowedPaths: params.target.allowedPaths,
			excludedPaths: params.target.excludedPaths,
		}),
	);
	return Array.from(new Set(scoped)).slice(0, 500);
}

export async function runBrowserSmoke(params: {
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	profileConfigRoutes: string[];
	timeoutSec?: number;
	totalTimeoutSec?: number;
	maxRequests?: number;
	adapter: DastBrowserAdapter;
}): Promise<DastBrowserRawResult> {
	const startedAt = new Date();
	const timeoutMs =
		Math.min(
			params.timeoutSec ?? params.target.timeoutSec,
			params.target.timeoutSec,
		) * 1000;
	const totalTimeoutMs = Math.min(params.totalTimeoutSec ?? 600, 600) * 1000;
	const deadline = Date.now() + totalTimeoutMs;
	const maxRequests = Math.min(
		params.maxRequests ?? params.target.maxRequests,
		params.target.maxRequests,
	);
	const paths = routePathsForBrowser({
		target: params.target,
		profileConfigRoutes: params.profileConfigRoutes,
	});
	const routes: DastBrowserRouteObservation[] = [];
	const warnings = [...params.target.warnings];
	const inventory = new DastRouteInventory(params.target, 500);
	for (const path of paths) {
		inventory.add({
			path,
			source: "configured",
			required: true,
			authMode: params.profile.requiresAuth ? "authenticated" : "anonymous",
		});
	}

	try {
		while (true) {
			const entry = inventory
				.list()
				.find((candidate) =>
					["discovered", "planned"].includes(candidate.state),
				);
			if (!entry) break;
			if (Date.now() >= deadline) {
				markRemainingBrowserRoutes(inventory, "assessment_timeout");
				break;
			}
			if (routes.length >= maxRequests) {
				markRemainingBrowserRoutes(inventory, "request_budget_exhausted");
				break;
			}
			if (entry.depth > params.target.maxDepth) {
				inventory.mark(entry, "not_tested", {
					limitationCode: "max_depth_reached",
				});
				continue;
			}
			const path = entry.path;
			inventory.mark(entry, "attempted");
			const url = new URL(path, params.target.runnerOrigin).toString();
			const started = performance.now();
			try {
				const route = await params.adapter.loadRoute({
					url,
					path,
					timeoutMs: Math.min(timeoutMs, Math.max(1, deadline - Date.now())),
				});
				if (!isUrlInDastScope(route.finalUrl, params.target)) {
					warnings.push(`browser final URL out of scope: ${route.finalUrl}`);
					route.error = route.error ?? "target_redirect_out_of_scope";
				}
				if (route.error || route.status === null) {
					inventory.mark(entry, "failed", {
						statusCode: route.status,
						limitationCode: browserLimitationCode(route.error),
					});
				} else {
					const classified = classifyBrowserRouteStatus(
						route.status,
						params.profile.requiresAuth,
					);
					inventory.mark(entry, classified.state, {
						statusCode: route.status,
						limitationCode: classified.limitationCode,
					});
				}
				if (route.requestBudgetExhausted) {
					inventory.mark(entry, entry.state, {
						statusCode: route.status,
						limitationCode: "request_budget_exhausted",
					});
				}
				if (params.profile.crawlerEnabled) {
					for (const request of route.networkRequests) {
						if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) continue;
						const query = request.queryKeys
							.map((key) => `${encodeURIComponent(key)}=`)
							.join("&");
						const discovered = inventory.add({
							method: request.method as "GET" | "HEAD" | "OPTIONS",
							path: `${request.path}${query ? `?${query}` : ""}`,
							source: "browser_network",
							depth: entry.depth + 1,
							authMode: entry.authMode,
						});
						if (
							discovered &&
							discovered.state === "discovered" &&
							discovered.depth > params.target.maxDepth
						) {
							inventory.mark(discovered, "not_tested", {
								statusCode: request.status,
								limitationCode: "max_depth_reached",
							});
						} else if (discovered?.state === "discovered") {
							const classified = classifyBrowserRouteStatus(
								request.status,
								params.profile.requiresAuth,
							);
							inventory.mark(discovered, classified.state, {
								statusCode: request.status,
								limitationCode: classified.limitationCode,
							});
						}
					}
				}
				routes.push({
					...route,
					path,
					url,
					durationMs: Math.round(performance.now() - started),
				});
				if (route.requestBudgetExhausted) {
					markRemainingBrowserRoutes(inventory, "request_budget_exhausted");
					break;
				}
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "browser_unavailable";
				inventory.mark(entry, "failed", {
					limitationCode: browserLimitationCode(message),
				});
				routes.push({
					path,
					url,
					finalUrl: url,
					status: null,
					requestBudgetExhausted:
						browserLimitationCode(message) === "request_budget_exhausted",
					consoleErrors: [],
					pageErrors: [],
					failedRequests: [],
					networkRequests: [],
					durationMs: Math.round(performance.now() - started),
					error: message,
				});
				if (entry.limitationCode === "request_budget_exhausted") {
					markRemainingBrowserRoutes(inventory, "request_budget_exhausted");
					break;
				}
			}
			if (params.profile.requiresAuth && entry.state === "denied_unexpected") {
				for (const remaining of inventory
					.list()
					.filter((candidate) =>
						["discovered", "planned"].includes(candidate.state),
					)) {
					inventory.mark(remaining, "not_tested", {
						limitationCode: "session_expired",
					});
				}
				break;
			}
		}
	} finally {
		await params.adapter.close?.();
	}

	const routeInventory = inventory.list();
	const requestCount =
		params.adapter.requestCount?.() ??
		routes.filter((route) => route.status !== null).length;
	const evaluated = evaluateDastCoverage({
		routeInventory,
		requestCount,
		findingCount: 0,
		authRequired: params.profile.requiresAuth,
		authSucceeded:
			!params.profile.requiresAuth ||
			(routes.length > 0 &&
				!routeInventory.some(
					(entry) => entry.limitationCode === "authentication_failed",
				)),
		budgetExhausted: routeInventory.some(
			(entry) => entry.limitationCode === "request_budget_exhausted",
		),
		limitationCodes: inventory.limitationCodes(),
	});
	return {
		kind: "browser",
		profileId: params.profile.id,
		targetOrigin: params.target.normalizedOrigin,
		startedAt: startedAt.toISOString(),
		completedAt: new Date().toISOString(),
		routes,
		routeInventory,
		coverage: evaluated.coverageSummary,
		warnings,
	};
}

function classifyBrowserRouteStatus(
	status: number,
	authenticated: boolean,
): {
	state:
		| "succeeded"
		| "denied_expected"
		| "denied_unexpected"
		| "blocked"
		| "failed";
	limitationCode: string | null;
} {
	if (status === 401 || status === 403) {
		return authenticated
			? { state: "denied_unexpected", limitationCode: "authentication_failed" }
			: { state: "denied_expected", limitationCode: null };
	}
	if (status >= 200 && status < 400) {
		return { state: "succeeded", limitationCode: null };
	}
	if (status === 404 || status === 410) {
		return { state: "failed", limitationCode: "route_not_found" };
	}
	if (status === 408) {
		return { state: "failed", limitationCode: "browser_timeout" };
	}
	if (status === 429) {
		return { state: "failed", limitationCode: "target_throttled" };
	}
	if (status >= 500) {
		return { state: "failed", limitationCode: "server_error" };
	}
	return { state: "blocked", limitationCode: "request_shape_rejected" };
}

function markRemainingBrowserRoutes(
	inventory: DastRouteInventory,
	limitationCode: string,
): void {
	for (const entry of inventory.list()) {
		if (["discovered", "planned"].includes(entry.state)) {
			inventory.mark(entry, "not_tested", { limitationCode });
		}
	}
}

function browserLimitationCode(error: string | null): string {
	if (!error) return "browser_route_failed";
	if (/request_budget_exhausted/i.test(error))
		return "request_budget_exhausted";
	if (/timeout/i.test(error)) return "browser_timeout";
	if (/login|auth|session|credential/i.test(error))
		return "authentication_failed";
	if (/out_of_scope/i.test(error)) return "redirect_out_of_scope";
	return "browser_route_failed";
}
