import fs from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { DbRuntime } from "../db";
import { createDbRuntime } from "../db";
import { requireAuth } from "../middleware/auth";
import { AuthService } from "../modules/auth/auth.service";
import { HttpError } from "../modules/auth/errors";
import { createAuthRoute } from "../routes/auth.route";
import { createHealthRoute } from "../routes/health.route";
import { createProtectedRoute } from "../routes/protected.route";
import { readAppEnv, type AppEnv } from "./env";
import { appContentSecurityPolicy } from "./security-headers";

export type AppDeps = {
	env: AppEnv;
	dbRuntime: DbRuntime;
	authService: AuthService;
};

declare global {
	var __honoStandardRuntime__: Promise<AppDeps> | undefined;
}

export async function createDefaultAppDeps(): Promise<AppDeps> {
	const env = readAppEnv();
	const dbRuntime = createDbRuntime(env);
	const authService = new AuthService(dbRuntime.client, env);
	return { env, dbRuntime, authService };
}

export async function getAppRuntime(): Promise<AppDeps> {
	if (!globalThis.__honoStandardRuntime__) {
		globalThis.__honoStandardRuntime__ = createDefaultAppDeps().catch(
			(error) => {
				globalThis.__honoStandardRuntime__ = undefined;
				throw error;
			},
		);
	}
	return globalThis.__honoStandardRuntime__;
}

const distWebRoot = path.resolve(process.cwd(), "dist-web");
const distWebIndex = path.resolve(distWebRoot, "index.html");

export function createApiRoutes(deps: AppDeps) {
	return new Hono()
		.route("/health", createHealthRoute())
		.use(
			"/protected/*",
			requireAuth({
				env: deps.env,
				authService: deps.authService,
			}),
		)
		.route("/protected", createProtectedRoute())
		.use(
			"/auth/me",
			requireAuth({
				env: deps.env,
				authService: deps.authService,
			}),
		)
		.route(
			"/auth",
			createAuthRoute({
				authService: deps.authService,
				env: deps.env,
			}),
		);
}

export function createApp(deps: AppDeps) {
	const app = new Hono();
	const useHttpsSecurityHeaders =
		deps.env.securityHeadersMode === "https" ||
		(deps.env.securityHeadersMode === "auto" && deps.env.secureCookie);
	const secureHeaderOptions = useHttpsSecurityHeaders
		? { contentSecurityPolicy: appContentSecurityPolicy }
		: {
				contentSecurityPolicy: appContentSecurityPolicy,
				crossOriginOpenerPolicy: false,
				originAgentCluster: false,
				strictTransportSecurity: false,
			};

	app.use("*", logger());
	app.use("*", secureHeaders(secureHeaderOptions));
	app.use(
		"/api/*",
		cors({
			origin: (origin) => {
				if (!origin) return undefined;
				if (deps.env.corsOrigins.includes(origin)) return origin;
				return null;
			},
			credentials: true,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
		}),
	);
	app.use("/api/*", csrf());

	app.onError(async (error, c) => {
		if (error instanceof HttpError) {
			if (error.status >= 500) {
				console.error(error);
			}
			return c.json(
				{ message: error.message },
				error.status as 400 | 401 | 403 | 404 | 409 | 500,
			);
		}
		if (error instanceof HTTPException) {
			const response = error.getResponse();
			if (response.status >= 500) {
				console.error(error);
			}
			const message =
				(await response
					.clone()
					.text()
					.catch(() => "")) ||
				error.message ||
				response.statusText ||
				"Request failed";
			return c.json(
				{ message },
				error.status as 400 | 401 | 403 | 404 | 409 | 500,
			);
		}
		const message =
			deps.env.nodeEnv === "production"
				? "Internal server error"
				: error instanceof Error
					? error.message
					: "Internal server error";
		console.error(error);
		return c.json({ message }, 500);
	});

	app.route("/api", createApiRoutes(deps));

	app.use("/assets/*", serveStatic({ root: "./dist-web" }));
	app.use("/favicon.ico", serveStatic({ root: "./dist-web" }));
	app.get("*", async (c) => {
		if (c.req.path.startsWith("/api/")) {
			return c.notFound();
		}
		try {
			const html = await fs.readFile(distWebIndex, "utf8");
			return c.html(html);
		} catch {
			return c.text(
				"Frontend is not built. Run `bun run build:web` or `bun run dev`.",
				404,
			);
		}
	});

	return app;
}

const runtime = await getAppRuntime();
const app = createApp(runtime);

export default app;
export type AppType = ReturnType<typeof createApiRoutes>;
