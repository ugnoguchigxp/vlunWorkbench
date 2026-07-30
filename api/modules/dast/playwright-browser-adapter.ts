import { chromium, type Browser, type BrowserContext } from "playwright";
import type {
	DastAuthSecretPayload,
	DastLoginAction,
} from "../../../shared/schemas/dast-auth.schema";
import {
	authHeadersFor,
	redactSecretText,
	secretFieldValue,
} from "./auth-material";
import type { BrowserRouteResult, DastBrowserAdapter } from "./browser-runner";
import { isUrlInDastScope } from "./target-validator";
import type { ValidatedDastTarget } from "./types";

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

	constructor(
		private readonly options: {
			target: ValidatedDastTarget;
			authSecret?: DastAuthSecretPayload;
			loginFlow?: DastLoginAction[];
			screenshotPolicy?: DastScreenshotPolicy;
		},
	) {}

	async loadRoute(params: {
		url: string;
		path: string;
		timeoutMs: number;
	}): Promise<BrowserRouteResult> {
		const context = await this.ensureContext();
		if (!this.loginCompleted && (this.options.loginFlow?.length ?? 0) > 0) {
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
	}

	async close(): Promise<void> {
		await this.context?.close().catch(() => undefined);
		await this.browser?.close().catch(() => undefined);
		this.context = null;
		this.browser = null;
	}

	private async ensureContext(): Promise<BrowserContext> {
		if (this.context) return this.context;
		this.browser = await chromium.launch({ headless: true });
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
			if (!isUrlInDastScope(page.url(), this.options.target)) {
				throw new Error("login_redirect_out_of_scope");
			}
			this.loginCompleted = true;
		} finally {
			await page.close();
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
		const redact = (value: string) =>
			redactSecretText(value, this.options.authSecret);
		page.on("console", (message) => {
			if (message.type() === "error")
				consoleErrors.push(redact(message.text()));
		});
		page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
		page.on("requestfailed", (request) => {
			failedRequests.push({
				url: redact(request.url()),
				method: request.method(),
				failure: redact(request.failure()?.errorText ?? "request_failed"),
			});
		});
		try {
			const response = await page.goto(params.url, {
				waitUntil: "domcontentloaded",
				timeout: params.timeoutMs,
			});
			const screenshot = await this.captureScreenshot(page, params.path);
			return {
				finalUrl: page.url(),
				status: response?.status() ?? null,
				consoleErrors,
				pageErrors,
				failedRequests,
				screenshot,
				error: null,
			};
		} catch (error) {
			return {
				finalUrl: page.url() || params.url,
				status: null,
				consoleErrors,
				pageErrors,
				failedRequests,
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
			fullPage: true,
			mask: policy.maskSelectors.map((selector) => page.locator(selector)),
		});
		return {
			filename: `${path.replace(/[^a-zA-Z0-9]/g, "_") || "root"}.png`,
			bytes,
		};
	}
}
