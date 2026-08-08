import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationClientAuthenticationError } from "../modules/integrationClients/integration-client.service";
import { configureHttpMiddleware } from "./hono-middleware";
import type { AppRuntime } from "./hono-runtime";

function createMiddlewareApp(options?: {
	enabled?: boolean;
	authenticationFails?: boolean;
	authenticationBackendFails?: boolean;
}) {
	const authenticate = vi.fn(async () => {
		if (options?.authenticationBackendFails) {
			throw new Error("credential database unavailable");
		}
		if (options?.authenticationFails) {
			throw new IntegrationClientAuthenticationError(
				"invalid",
				"invalid token",
			);
		}
		return { id: "client-1" };
	});
	const runtime = {
		env: {
			securityHeadersMode: "http",
			secureCookie: false,
			cspMode: "report-only",
			corsOrigins: [],
			trustProxy: false,
			trustedProxyCidrs: [],
			nightworkersIntegrationEnabled: options?.enabled ?? true,
			nodeEnv: "test",
		},
		integrationClientService: { authenticate },
	} as unknown as AppRuntime;
	const app = new Hono();
	configureHttpMiddleware(app, runtime);
	app.post("/api/integrations/nightworkers/v1/probe", (c) =>
		c.json({ ok: true }),
	);
	app.post("/api/integrations/nightworkers/v10/probe", (c) =>
		c.json({ ok: true }),
	);
	app.post("/api/ordinary-probe", (c) => c.json({ ok: true }));
	return { app, authenticate };
}

const integrationHeaders = {
	Authorization:
		"Bearer vwi_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHijk",
	Origin: "https://untrusted.example",
};

describe("NightWorkers CSRF boundary", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("bypasses browser CSRF only for an authenticated, enabled integration route", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { app, authenticate } = createMiddlewareApp();

		const response = await app.request(
			"/api/integrations/nightworkers/v1/probe",
			{ method: "POST", headers: integrationHeaders },
		);

		expect(response.status).toBe(200);
		expect(authenticate).toHaveBeenCalledTimes(1);
	});

	it("rejects invalid bearer authentication before granting the CSRF exemption", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { app } = createMiddlewareApp({ authenticationFails: true });

		const response = await app.request(
			"/api/integrations/nightworkers/v1/probe",
			{ method: "POST", headers: integrationHeaders },
		);

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe(
			"integration_unauthorized",
		);
	});

	it("returns a retryable v1 error when authentication storage is unavailable", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { app } = createMiddlewareApp({ authenticationBackendFails: true });

		const response = await app.request(
			"/api/integrations/nightworkers/v1/probe",
			{
				method: "POST",
				headers: {
					...integrationHeaders,
					"X-Request-Id": "../../invalid reflected request id",
				},
			},
		);

		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body).toEqual({
			contractVersion: 1,
			requestId: expect.any(String),
			error: {
				code: "provider_temporarily_unavailable",
				message: "Integration authentication is temporarily unavailable.",
				retryable: true,
			},
		});
		expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("does not weaken CSRF for ordinary, prefix-collision, or feature-disabled routes", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const enabled = createMiddlewareApp();
		expect(
			(
				await enabled.app.request("/api/ordinary-probe", {
					method: "POST",
					headers: integrationHeaders,
				})
			).status,
		).toBe(403);
		expect(
			(
				await enabled.app.request(
					"/api/integrations/nightworkers/v10/probe",
					{ method: "POST", headers: integrationHeaders },
				)
			).status,
		).toBe(403);

		const disabled = createMiddlewareApp({ enabled: false });
		expect(
			(
				await disabled.app.request(
					"/api/integrations/nightworkers/v1/probe",
					{ method: "POST", headers: integrationHeaders },
				)
			).status,
		).toBe(403);
	});

	it("rejects oversized API bodies before JSON parsing", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const { app } = createMiddlewareApp();
		const response = await app.request("http://localhost/api/ordinary-probe", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"content-length": String(5 * 1024 * 1024 + 1),
			},
			body: "{}",
		});
		expect(response.status).toBe(413);
	});
});
