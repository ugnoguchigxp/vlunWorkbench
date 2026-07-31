import type {
	DastAuthSecretPayload,
	DastAuthSuccessAssertion,
	DastLoginAction,
} from "../../../shared/schemas/dast-auth.schema";
import { type DastBrowserAdapter, runBrowserSmoke } from "./browser-runner";
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
	checkOptions?: Record<string, unknown>;
	runner?: "host" | "docker";
	fetchImpl?: DastFetch;
	browserAdapter?: DastBrowserAdapter;
	projectRoot?: string;
	authMaterial?: {
		secret: DastAuthSecretPayload;
		context: {
			loginFlow: DastLoginAction[];
			successAssertions: DastAuthSuccessAssertion[];
		};
	};
}): Promise<DastRawResult> {
	const timeoutSec =
		params.timeoutSec ?? params.profileConfig?.timeoutSec ?? undefined;
	const maxRequests =
		params.maxRequests ?? params.profileConfig?.maxRequests ?? undefined;
	const checkOptions = {
		...(params.profileConfig?.checkOptionsJson ?? {}),
		...(params.checkOptions ?? {}),
	};
	if (params.profile.kind === "http") {
		return await runHttpBaseline({
			target: params.target,
			profile: params.profile,
			profileConfigRoutes: params.profileConfig?.routePathsJson,
			checkOptions,
			timeoutSec,
			maxRequests,
			fetchImpl: params.fetchImpl,
			authSecret: params.authMaterial?.secret,
			projectRoot: params.projectRoot,
		});
	}
	if (params.profile.kind === "browser") {
		const adapter =
			params.browserAdapter ??
			new PlaywrightBrowserAdapter({
				target: params.target,
				authSecret: params.authMaterial?.secret,
				loginFlow: params.authMaterial?.context.loginFlow,
				successAssertions: params.authMaterial?.context.successAssertions,
				requireAuthAssertion:
					params.profile.id === "authenticated-readonly-standard",
				screenshotPolicy: readScreenshotPolicy(checkOptions),
				maxNetworkRequests: Math.min(
					maxRequests ?? params.target.maxRequests,
					params.target.maxRequests,
				),
			});
		return await runBrowserSmoke({
			target: params.target,
			profile: params.profile,
			profileConfigRoutes: params.profileConfig?.routePathsJson ?? [],
			timeoutSec,
			totalTimeoutSec: readPositiveBoundedInt(
				checkOptions.totalTimeoutSec,
				600,
			),
			maxRequests,
			adapter,
		});
	}
	throw new Error("form-baseline runner is not enabled.");
}

function readPositiveBoundedInt(
	value: unknown,
	maximum: number,
): number | undefined {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value > 0 &&
		value <= maximum
		? value
		: undefined;
}

function readScreenshotPolicy(
	options: Record<string, unknown> | undefined,
): DastScreenshotPolicy {
	if (options?.screenshotEnabled !== true) return { enabled: false };
	const maskSelectors = Array.isArray(options.screenshotMaskSelectors)
		? options.screenshotMaskSelectors
				.filter(
					(value): value is string =>
						typeof value === "string" &&
						value.length > 0 &&
						value.length <= 500,
				)
				.slice(0, 100)
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
