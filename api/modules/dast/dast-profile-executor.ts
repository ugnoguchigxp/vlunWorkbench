import type {
	DastAuthSecretPayload,
	DastLoginAction,
} from "../../../shared/schemas/dast-auth.schema";
import {
	type DastBrowserAdapter,
	MockBrowserAdapter,
	runBrowserSmoke,
} from "./browser-runner";
import { runHttpBaseline, type DastFetch } from "./http-runner";
import {
	PlaywrightBrowserAdapter,
	type DastScreenshotPolicy,
} from "./playwright-browser-adapter";
import type { DastProfileDefinition } from "./profiles";
import type { DastRawResult, ValidatedDastTarget } from "./types";

export async function executeDastProfile(params: {
	profile: DastProfileDefinition;
	target: ValidatedDastTarget;
	profileConfig: {
		routePathsJson: string[];
		checkOptionsJson: Record<string, unknown>;
		timeoutSec: number | null;
		maxRequests: number | null;
	} | null;
	timeoutSec?: number;
	maxRequests?: number;
	runner?: "host" | "docker" | "mock";
	fetchImpl?: DastFetch;
	browserAdapter?: DastBrowserAdapter;
	authMaterial?: {
		secret: DastAuthSecretPayload;
		context: { loginFlow: DastLoginAction[] };
	};
}): Promise<DastRawResult> {
	const timeoutSec =
		params.timeoutSec ?? params.profileConfig?.timeoutSec ?? undefined;
	const maxRequests =
		params.maxRequests ?? params.profileConfig?.maxRequests ?? undefined;
	if (params.profile.kind === "http") {
		return await runHttpBaseline({
			target: params.target,
			profile: params.profile,
			profileConfigRoutes: params.profileConfig?.routePathsJson,
			checkOptions: params.profileConfig?.checkOptionsJson,
			timeoutSec,
			maxRequests,
			fetchImpl: params.fetchImpl,
			authSecret: params.authMaterial?.secret,
		});
	}
	if (params.profile.kind === "browser") {
		const adapter =
			params.browserAdapter ??
			(params.runner === "mock"
				? new MockBrowserAdapter()
				: new PlaywrightBrowserAdapter({
						target: params.target,
						authSecret: params.authMaterial?.secret,
						loginFlow: params.authMaterial?.context.loginFlow,
						screenshotPolicy: readScreenshotPolicy(
							params.profileConfig?.checkOptionsJson,
						),
					}));
		return await runBrowserSmoke({
			target: params.target,
			profile: params.profile,
			profileConfigRoutes: params.profileConfig?.routePathsJson ?? [],
			timeoutSec,
			maxRequests,
			adapter,
		});
	}
	throw new Error("form-baseline runner is not enabled.");
}

function readScreenshotPolicy(
	options: Record<string, unknown> | undefined,
): DastScreenshotPolicy {
	if (options?.screenshotEnabled !== true) return { enabled: false };
	const maskSelectors = Array.isArray(options.screenshotMaskSelectors)
		? options.screenshotMaskSelectors.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0,
			)
		: [];
	const sensitivity =
		options.screenshotSensitivity === "confidential"
			? "confidential"
			: options.screenshotSensitivity === "internal"
				? "internal"
				: null;
	if (!sensitivity || maskSelectors.length === 0) {
		throw new Error(
			"authenticated_screenshot_requires_mask_selectors_and_sensitivity",
		);
	}
	return { enabled: true, maskSelectors, sensitivity };
}
