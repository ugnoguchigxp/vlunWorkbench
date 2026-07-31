import type { Hono } from "hono";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { createAdminUsersRoute } from "../routes/admin-users.route";
import { createAgenticSearchRoute } from "../routes/agentic-search.route";
import { createArtifactsRoute } from "../routes/artifacts.route";
import { createAuthRoute } from "../routes/auth.route";
import { createChatRoute } from "../routes/chat.route";
import { createHealthRoute } from "../routes/health.route";
import { createSearchRoute } from "../routes/search.route";
import { createSettingsRoute } from "../routes/settings.route";
import { createSourcesRoute } from "../routes/sources.route";

import type { AppRuntime } from "./hono-runtime";

export function registerApplicationRoutes(
	app: Hono,
	runtime: AppRuntime,
): void {
	app.route(
		"/api/health",
		createHealthRoute({
			env: runtime.env,
			dbConnection: runtime.dbConnection,
		}),
	);
	app.use(
		"/api/auth/me",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.route(
		"/api/auth",
		createAuthRoute({
			authService: runtime.authService,
			env: runtime.env,
		}),
	);
	app.use(
		"/api/settings/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/settings",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/sources/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/search/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/search",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/agentic-search/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/agentic-search",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/chat/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/chat",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/artifacts/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/artifacts",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/projects/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/projects",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scan-profiles/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scan-profiles",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scans/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scans",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scan-reports/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/scan-reports",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/findings/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/findings",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/reproduction-runs/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/reproduction-runs",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/dynamic-runs/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/dynamic-runs",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/dast-runs/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/dast-runs",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/diagnostic-reports/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/diagnostic-reports",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/finding-reviews/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/finding-reviews",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/finding-decisions/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/finding-decisions",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use(
		"/api/admin/*",
		requireAuth({
			env: runtime.env,
			authService: runtime.authService,
		}),
	);
	app.use("/api/admin/*", requireAdmin());
	app.route(
		"/api/admin",
		createAdminUsersRoute({
			authService: runtime.authService,
		}),
	);
	app.route(
		"/api/sources",
		createSourcesRoute({
			contentRoot: runtime.env.contentRoot,
			sourceRepository: runtime.sourceRepository,
			wikiBlobSyncer: runtime.wikiBlobSyncer,
		}),
	);
	app.route(
		"/api/search",
		createSearchRoute({
			retriever: runtime.retriever,
			webSearchProvider: runtime.webSearchProvider,
			webSearchProviderName: runtime.webSearchProviderName,
			webSearchUnavailableMessage: runtime.webSearchUnavailableMessage,
		}),
	);
	app.route(
		"/api/settings",
		createSettingsRoute({
			settingsRepository: runtime.settingsRepository,
			llmSettingsRepository: runtime.llmSettingsRepository,
			runtimeEnv: runtime.env,
		}),
	);
	app.route(
		"/api/agentic-search",
		createAgenticSearchRoute({
			service: runtime.agenticSearchService,
		}),
	);
	app.route(
		"/api/chat",
		createChatRoute({
			db: runtime.dbConnection.db,
			llmProvider: runtime.llmProvider,
			evidenceCollector: runtime.evidenceCollector,
		}),
	);
	app.route(
		"/api/artifacts",
		createArtifactsRoute({
			db: runtime.dbConnection.db,
		}),
	);
}
