import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "hono/bun";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { FailureKind } from "../../shared/schemas/failure.schema";
import { requireAuth } from "../middleware/auth";
import { rateLimiter } from "../middleware/rate-limiter";
import { HttpError } from "../modules/auth/errors";
import { IntegrationClientAuthenticationError } from "../modules/integrationClients/integration-client.service";
import { shouldLogAppError } from "./error-logging";

import type { AppRuntime } from "./hono-runtime";

export function configureHttpMiddleware(app: Hono, runtime: AppRuntime): void {
	const distWebRoot = path.resolve(process.cwd(), "dist-web");
	const _distWebIndex = path.resolve(distWebRoot, "index.html");
	const useHttpsSecurityHeaders =
		runtime.env.securityHeadersMode === "https" ||
		(runtime.env.securityHeadersMode === "auto" && runtime.env.secureCookie);
	const contentSecurityPolicy = {
		defaultSrc: ["'self'"],
		baseUri: ["'self'"],
		connectSrc: ["'self'"],
		fontSrc: ["'self'", "data:"],
		frameAncestors: ["'none'"],
		imgSrc: ["'self'", "data:", "blob:"],
		objectSrc: ["'none'"],
		scriptSrc: ["'self'"],
		styleSrc: ["'self'", "'unsafe-inline'"],
		workerSrc: ["'self'", "blob:"],
	};
	const secureHeaderOptions = useHttpsSecurityHeaders
		? runtime.env.cspMode === "enforce"
			? { contentSecurityPolicy }
			: { contentSecurityPolicyReportOnly: contentSecurityPolicy }
		: {
				...(runtime.env.cspMode === "enforce"
					? { contentSecurityPolicy }
					: { contentSecurityPolicyReportOnly: contentSecurityPolicy }),
				crossOriginOpenerPolicy: false,
				originAgentCluster: false,
				strictTransportSecurity: false,
			};
	const remoteAddressResolver = (c: Parameters<typeof getConnInfo>[0]) => {
		try {
			return getConnInfo(c).remote.address ?? null;
		} catch {
			return null;
		}
	};

	app.use("*", async (c, next) => {
		const suppliedRequestId = c.req.header("x-request-id");
		const requestId =
			suppliedRequestId && /^[A-Za-z0-9._:-]{1,64}$/.test(suppliedRequestId)
				? suppliedRequestId
				: randomUUID();
		const startedAt = performance.now();
		c.header("X-Request-Id", requestId);
		try {
			await next();
		} finally {
			console.log(
				JSON.stringify({
					version: 1,
					level: "info",
					event: "http_request",
					requestId,
					method: c.req.method,
					path: new URL(c.req.url).pathname,
					status: c.res.status,
					durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
				}),
			);
		}
	});
	app.use("*", secureHeaders(secureHeaderOptions));
	app.use(
		"/api/*",
		cors({
			origin: (origin) => {
				if (!origin) return undefined;
				if (runtime.env.corsOrigins.includes(origin)) return origin;
				return null;
			},
			credentials: true,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"Idempotency-Key",
				"X-Request-Id",
			],
		}),
	);
	app.use(
		"/api/*",
		bodyLimit({
			maxSize: 5 * 1024 * 1024,
			onError: (c) =>
				c.json({ message: "Request body exceeds the 5 MiB limit." }, 413),
		}),
	);
	app.use(
		"/api/*",
		rateLimiter({
			windowMs: 60 * 1000,
			limit: 200,
			trustProxy: runtime.env.trustProxy,
			trustedProxyCidrs: runtime.env.trustedProxyCidrs,
			remoteAddressResolver,
		}),
	);
	app.use(
		"/api/auth/login",
		rateLimiter({
			windowMs: 60 * 1000,
			limit: 10,
			trustProxy: runtime.env.trustProxy,
			trustedProxyCidrs: runtime.env.trustedProxyCidrs,
			remoteAddressResolver,
		}),
	);
	app.use(
		"/api/auth/login",
		rateLimiter({
			windowMs: 5 * 60 * 1000,
			limit: 20,
			keyGenerator: async (c) => {
				const body = await c.req.json().catch(() => null);
				const email =
					body &&
					typeof body === "object" &&
					"email" in body &&
					typeof body.email === "string"
						? body.email.trim().toLowerCase()
						: "invalid";
				return `login-email:${email}`;
			},
		}),
	);
	app.use(
		"/api/auth/refresh",
		rateLimiter({
			windowMs: 60 * 1000,
			limit: 20,
			trustProxy: runtime.env.trustProxy,
			trustedProxyCidrs: runtime.env.trustedProxyCidrs,
			remoteAddressResolver,
		}),
	);
	const csrfMiddleware = csrf();
	app.use("/api/*", async (c, next) => {
		const integrationPrefix = "/api/integrations/nightworkers/v1";
		const isIntegrationRequest =
			runtime.env.nightworkersIntegrationEnabled &&
			(c.req.path === integrationPrefix ||
				c.req.path.startsWith(`${integrationPrefix}/`));
		if (!isIntegrationRequest) {
			return await csrfMiddleware(c, next);
		}
		const match = c.req.header("authorization")?.match(/^Bearer ([^\s]+)$/);
		let client = null;
		if (match) {
			try {
				client = await runtime.integrationClientService.authenticate(match[1], {
					updateLastUsed: false,
				});
			} catch (error) {
				if (!(error instanceof IntegrationClientAuthenticationError)) {
					const requestId = integrationRequestId(c);
					console.error(
						JSON.stringify({
							version: 1,
							level: "error",
							event: "integration_authentication_backend_failure",
							requestId,
							errorName: error instanceof Error ? error.name : "UnknownError",
						}),
					);
					return c.json(
						{
							contractVersion: 1,
							requestId,
							error: {
								code: "provider_temporarily_unavailable",
								message:
									"Integration authentication is temporarily unavailable.",
								retryable: true,
							},
						},
						503,
					);
				}
			}
		}
		if (!client) {
			const requestId = integrationRequestId(c);
			return c.json(
				{
					contractVersion: 1,
					requestId,
					error: {
						code: "integration_unauthorized",
						message: "Valid integration bearer authentication is required.",
						retryable: false,
					},
				},
				401,
			);
		}
		await next();
	});
	const authenticateApiRequest = requireAuth({
		env: runtime.env,
		authService: runtime.authService,
	});
	app.use("/api/*", async (c, next) => {
		const publicPaths = new Set([
			"/api/health",
			"/api/auth/login",
			"/api/auth/refresh",
			"/api/auth/logout",
		]);
		const integrationPrefix = "/api/integrations/nightworkers/v1";
		const isIntegrationRequest =
			runtime.env.nightworkersIntegrationEnabled &&
			(c.req.path === integrationPrefix ||
				c.req.path.startsWith(`${integrationPrefix}/`));
		if (publicPaths.has(c.req.path) || isIntegrationRequest) {
			await next();
			return;
		}
		await authenticateApiRequest(c, next);
	});
	app.onError(async (error, c) => {
		if (shouldLogAppError(error)) {
			console.error(error);
		}
		const dbError = error as { code?: string; message?: string };
		if (
			dbError.code === "42703" &&
			typeof dbError.message === "string" &&
			dbError.message.includes("category")
		) {
			return c.json(
				{
					ok: false,
					kind: "unknown_error" as FailureKind,
					message:
						'Database schema is outdated. Run "bun run db:migrate" and retry.',
				},
				500,
			);
		}
		if (error instanceof HttpError) {
			return c.json(
				{
					ok: false,
					kind: error.kind || ("unknown_error" as FailureKind),
					message: error.message,
				},
				error.status as 400 | 401 | 403 | 404 | 409 | 500,
			);
		}
		if (error instanceof HTTPException) {
			const response = error.getResponse();
			const message =
				(await response
					.clone()
					.text()
					.catch(() => "")) ||
				error.message ||
				response.statusText ||
				"Request failed";
			let kind: FailureKind = "unknown_error";
			if (error.status === 403) {
				kind = "ownership_check_failed";
			} else if (error.status === 404) {
				kind = "artifact_read_failed";
			}
			return c.json(
				{
					ok: false,
					kind,
					message,
				},
				error.status as 400 | 401 | 403 | 404 | 409 | 500,
			);
		}
		if (error instanceof Error && error.message === "Unauthorized") {
			return c.json(
				{
					ok: false,
					kind: "ownership_check_failed" as FailureKind,
					message: "Unauthorized",
				},
				401,
			);
		}
		if (error instanceof Error && error.message === "Forbidden") {
			return c.json(
				{
					ok: false,
					kind: "ownership_check_failed" as FailureKind,
					message: "Forbidden",
				},
				403,
			);
		}
		const message =
			runtime.env.nodeEnv === "production"
				? "Internal server error"
				: error instanceof Error
					? error.message
					: "Internal server error";
		return c.json(
			{
				ok: false,
				kind: "unknown_error" as FailureKind,
				message,
			},
			500,
		);
	});
}

function integrationRequestId(c: {
	req: { header(name: string): string | undefined };
	res: { headers: Headers };
}): string {
	const supplied = c.req.header("x-request-id");
	if (supplied && /^[A-Za-z0-9._:-]{1,64}$/.test(supplied)) return supplied;
	const generated = c.res.headers.get("x-request-id");
	return generated && /^[A-Za-z0-9._:-]{1,64}$/.test(generated)
		? generated
		: randomUUID();
}
