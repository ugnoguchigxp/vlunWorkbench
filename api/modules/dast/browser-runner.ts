import type { DastProfileDefinition } from "./profiles";
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
}

export class UnavailableBrowserAdapter implements DastBrowserAdapter {
	async loadRoute(): Promise<BrowserRouteResult> {
		throw new Error("browser_unavailable");
	}
}

export class MockBrowserAdapter implements DastBrowserAdapter {
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
		const configured = this.responses[params.path] ?? {};
		return {
			finalUrl: configured.finalUrl ?? params.url,
			status: configured.status ?? 200,
			consoleErrors: configured.consoleErrors ?? [],
			pageErrors: configured.pageErrors ?? [],
			failedRequests: configured.failedRequests ?? [],
			screenshot: configured.screenshot ?? {
				filename: `${params.path.replace(/[^a-zA-Z0-9]/g, "_") || "root"}.png`,
				bytes: new Uint8Array([137, 80, 78, 71]),
			},
			error: configured.error ?? null,
		};
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
	return Array.from(new Set(scoped)).slice(0, params.target.maxRequests);
}

export async function runBrowserSmoke(params: {
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	profileConfigRoutes: string[];
	timeoutSec?: number;
	maxRequests?: number;
	adapter: DastBrowserAdapter;
}): Promise<DastBrowserRawResult> {
	const startedAt = new Date();
	const timeoutMs =
		Math.min(
			params.timeoutSec ?? params.target.timeoutSec,
			params.target.timeoutSec,
		) * 1000;
	const maxRequests = Math.min(
		params.maxRequests ?? params.target.maxRequests,
		params.target.maxRequests,
	);
	const paths = routePathsForBrowser({
		target: params.target,
		profileConfigRoutes: params.profileConfigRoutes,
	}).slice(0, maxRequests);
	const routes: DastBrowserRouteObservation[] = [];
	const warnings = [...params.target.warnings];

	for (const path of paths) {
		const url = new URL(path, params.target.runnerOrigin).toString();
		const started = performance.now();
		try {
			const route = await params.adapter.loadRoute({ url, path, timeoutMs });
			if (!isUrlInDastScope(route.finalUrl, params.target)) {
				warnings.push(`browser final URL out of scope: ${route.finalUrl}`);
				route.error = route.error ?? "target_redirect_out_of_scope";
			}
			routes.push({
				...route,
				path,
				url,
				durationMs: Math.round(performance.now() - started),
			});
		} catch (error) {
			routes.push({
				path,
				url,
				finalUrl: url,
				status: null,
				consoleErrors: [],
				pageErrors: [],
				failedRequests: [],
				durationMs: Math.round(performance.now() - started),
				error: error instanceof Error ? error.message : "browser_unavailable",
			});
		}
	}

	return {
		kind: "browser",
		profileId: params.profile.id,
		targetOrigin: params.target.normalizedOrigin,
		startedAt: startedAt.toISOString(),
		completedAt: new Date().toISOString(),
		routes,
		warnings,
	};
}
