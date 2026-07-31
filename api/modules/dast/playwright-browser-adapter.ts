import { type Browser, type BrowserContext, chromium } from "playwright";
import type {
	DastAuthSecretPayload,
	DastAuthSuccessAssertion,
	DastLoginAction,
} from "../../../shared/schemas/dast-auth.schema";
import {
	authHeadersFor,
	redactDastEvidenceText,
	redactDastEvidenceUrl,
	secretFieldValue,
} from "./auth-material";
import type { BrowserRouteResult, DastBrowserAdapter } from "./browser-runner";
import { canonicalizeRoute } from "./route-inventory";
import { isUrlInDastScope } from "./target-validator";
import type { ValidatedDastTarget } from "./types";

const MAX_BROWSER_EVENTS_PER_ROUTE = 100;
const MAX_BROWSER_MESSAGE_CHARS = 4_000;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export type DastScreenshotPolicy =
	| { enabled: false }
	| {
			enabled: true;
			maskSelectors: string[];
			sensitivity: "internal" | "confidential";
	  };

export class PlaywrightBrowserAdapter implements DastBrowserAdapter {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private loginCompleted = false;
	private loginRetryUsed = false;
	private networkRequestCount = 0;
	private networkBudgetExhausted = false;

	constructor(
		private readonly options: {
			target: ValidatedDastTarget;
			authSecret?: DastAuthSecretPayload;
			loginFlow?: DastLoginAction[];
			successAssertions?: DastAuthSuccessAssertion[];
			requireAuthAssertion?: boolean;
			screenshotPolicy?: DastScreenshotPolicy;
			maxNetworkRequests?: number;
		},
	) {}

	async loadRoute(params: {
		url: string;
		path: string;
		timeoutMs: number;
	}): Promise<BrowserRouteResult> {
		try {
			const context = await this.ensureContext();
			if (
				!this.loginCompleted &&
				((this.options.loginFlow?.length ?? 0) > 0 ||
					this.options.requireAuthAssertion === true)
			) {
				await this.runLoginFlow(params.timeoutMs);
			}
			let result = await this.observeRoute(context, params);
			if (
				!this.loginRetryUsed &&
				(this.options.loginFlow?.length ?? 0) > 0 &&
				(result.status === 401 || result.status === 403)
			) {
				this.loginRetryUsed = true;
				await this.runLoginFlow(params.timeoutMs);
				result = await this.observeRoute(context, params);
			}
			return result;
		} catch (error) {
			if (this.networkBudgetExhausted) {
				throw new Error("request_budget_exhausted");
			}
			throw error;
		}
	}

	async close(): Promise<void> {
		await this.context?.close().catch(() => undefined);
		await this.browser?.close().catch(() => undefined);
		this.context = null;
		this.browser = null;
	}

	requestCount(): number {
		return this.networkRequestCount;
	}

	private async ensureContext(): Promise<BrowserContext> {
		if (this.context) return this.context;
		const runnerHost = new URL(this.options.target.runnerOrigin).hostname;
		const pinnedAddress = this.options.target.resolvedAddresses[0];
		if (!pinnedAddress) throw new Error("browser_pinned_address_unavailable");
		this.browser = await chromium.launch({
			headless: true,
			args: [
				`--host-resolver-rules=MAP ${runnerHost} ${pinnedAddress},EXCLUDE localhost`,
			],
		});
		const secret = this.options.authSecret;
		this.context = await this.browser.newContext({
			extraHTTPHeaders: authHeadersFor(secret),
			storageState:
				secret?.kind === "playwright_storage_state"
					? secret.storageState
					: undefined,
		});
		if (secret?.kind === "cookie_set") {
			await this.context.addCookies(
				secret.cookies.map((cookie) => ({
					name: cookie.name,
					value: cookie.value,
					domain: cookie.domain,
					path: cookie.path ?? "/",
					url: cookie.domain ? undefined : this.options.target.normalizedOrigin,
					secure: cookie.secure,
					httpOnly: cookie.httpOnly,
					sameSite: cookie.sameSite,
				})),
			);
		}
		await this.context.route("**/*", async (route) => {
			const url = route.request().url();
			const maxNetworkRequests =
				this.options.maxNetworkRequests ?? this.options.target.maxRequests;
			if (this.networkRequestCount >= maxNetworkRequests) {
				this.networkBudgetExhausted = true;
				await route.abort("blockedbyclient");
				return;
			}
			this.networkRequestCount += 1;
			if (!isUrlInDastScope(url, this.options.target)) {
				await route.abort("blockedbyclient");
				return;
			}
			await route.continue();
		});
		return this.context;
	}

	private async runLoginFlow(timeoutMs: number): Promise<void> {
		const context = await this.ensureContext();
		const page = await context.newPage();
		try {
			for (const action of this.options.loginFlow ?? []) {
				switch (action.action) {
					case "navigate":
						await page.goto(
							new URL(action.path, this.options.target.runnerOrigin).toString(),
							{ waitUntil: "domcontentloaded", timeout: timeoutMs },
						);
						break;
					case "fill_secret":
						if (!this.options.authSecret)
							throw new Error("login_flow_secret_unavailable");
						await page
							.locator(action.selector)
							.fill(
								secretFieldValue(this.options.authSecret, action.secretField),
								{ timeout: timeoutMs },
							);
						break;
					case "click":
						await page.locator(action.selector).click({ timeout: timeoutMs });
						break;
					case "wait_for_url":
						await page.waitForURL(
							new URL(
								action.pathPattern,
								this.options.target.runnerOrigin,
							).toString(),
							{ timeout: timeoutMs },
						);
						break;
					case "wait_for_selector":
						await page
							.locator(action.selector)
							.waitFor({ state: "visible", timeout: timeoutMs });
						break;
				}
			}
			await this.assertAuthenticationSucceeded(page, timeoutMs);
			if (!isUrlInDastScope(page.url(), this.options.target)) {
				throw new Error("login_redirect_out_of_scope");
			}
			this.loginCompleted = true;
		} finally {
			await page.close();
		}
	}

	private async assertAuthenticationSucceeded(
		page: import("playwright").Page,
		timeoutMs: number,
	): Promise<void> {
		const assertions = this.options.successAssertions ?? [];
		if (this.options.requireAuthAssertion && assertions.length === 0) {
			throw new Error("authentication_assertion_required");
		}
		for (const assertion of assertions) {
			switch (assertion.kind) {
				case "url": {
					const actual = new URL(page.url());
					if (actual.pathname !== assertion.pathPattern) {
						throw new Error("authentication_url_assertion_failed");
					}
					break;
				}
				case "selector":
					await page
						.locator(assertion.selector)
						.waitFor({ state: "visible", timeout: timeoutMs })
						.catch(() => {
							throw new Error("authentication_selector_assertion_failed");
						});
					break;
				case "status": {
					const response = await page.goto(
						new URL(
							assertion.path,
							this.options.target.runnerOrigin,
						).toString(),
						{ waitUntil: "domcontentloaded", timeout: timeoutMs },
					);
					if (
						response === null ||
						!assertion.expected.includes(response.status())
					) {
						throw new Error("authentication_status_assertion_failed");
					}
					break;
				}
			}
		}
	}

	private async observeRoute(
		context: BrowserContext,
		params: { url: string; path: string; timeoutMs: number },
	): Promise<BrowserRouteResult> {
		const page = await context.newPage();
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		const failedRequests: Array<{
			url: string;
			method: string;
			failure: string;
		}> = [];
		const networkRequests: BrowserRouteResult["networkRequests"] = [];
		const observedNetworkKeys = new Set<string>();
		const redact = (value: string) =>
			redactDastEvidenceText(value, this.options.authSecret).slice(
				0,
				MAX_BROWSER_MESSAGE_CHARS,
			);
		page.on("console", (message) => {
			if (
				message.type() === "error" &&
				consoleErrors.length < MAX_BROWSER_EVENTS_PER_ROUTE
			)
				consoleErrors.push(redact(message.text()));
		});
		page.on("pageerror", (error) => {
			if (pageErrors.length < MAX_BROWSER_EVENTS_PER_ROUTE) {
				pageErrors.push(redact(error.message));
			}
		});
		page.on("requestfailed", (request) => {
			if (failedRequests.length >= MAX_BROWSER_EVENTS_PER_ROUTE) return;
			failedRequests.push({
				url: redactDastEvidenceUrl(
					request.url(),
					this.options.authSecret,
				).slice(0, MAX_BROWSER_MESSAGE_CHARS),
				method: request.method(),
				failure: redact(request.failure()?.errorText ?? "request_failed"),
			});
		});
		page.on("response", (response) => {
			if (networkRequests.length >= MAX_BROWSER_EVENTS_PER_ROUTE) return;
			const request = response.request();
			const method = request.method();
			const canonical = canonicalizeRoute(response.url(), this.options.target);
			if (!canonical) return;
			const key = [
				method,
				canonical.path,
				canonical.queryShapeHash,
				response.status(),
			].join("\0");
			if (observedNetworkKeys.has(key)) return;
			observedNetworkKeys.add(key);
			networkRequests.push({
				path: canonical.path,
				queryKeys: canonical.queryKeys,
				method,
				status: response.status(),
			});
		});
		try {
			const response = await page.goto(params.url, {
				waitUntil: "domcontentloaded",
				timeout: params.timeoutMs,
			});
			const screenshot = await this.captureScreenshot(page, params.path);
			return {
				finalUrl: redactDastEvidenceUrl(page.url(), this.options.authSecret),
				status: response?.status() ?? null,
				requestBudgetExhausted: this.networkBudgetExhausted,
				consoleErrors,
				pageErrors,
				failedRequests,
				networkRequests,
				screenshot,
				error: null,
			};
		} catch (error) {
			return {
				finalUrl: redactDastEvidenceUrl(
					page.url() || params.url,
					this.options.authSecret,
				),
				status: null,
				requestBudgetExhausted: this.networkBudgetExhausted,
				consoleErrors,
				pageErrors,
				failedRequests,
				networkRequests,
				error: redact(
					error instanceof Error ? error.message : "browser_route_failed",
				),
			};
		} finally {
			await page.close();
		}
	}

	private async captureScreenshot(
		page: import("playwright").Page,
		path: string,
	): Promise<{ filename: string; bytes: Uint8Array } | undefined> {
		const policy = this.options.screenshotPolicy ?? { enabled: false };
		if (!policy.enabled) return undefined;
		if (policy.maskSelectors.length === 0) {
			throw new Error("authenticated_screenshot_requires_mask_selectors");
		}
		const bytes = await page.screenshot({
			fullPage: false,
			mask: policy.maskSelectors.map((selector) => page.locator(selector)),
		});
		if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
			throw new Error("browser_screenshot_size_limit_exceeded");
		}
		return {
			filename: `${path.replace(/[^a-zA-Z0-9]/g, "_") || "root"}.png`,
			bytes,
		};
	}
}
