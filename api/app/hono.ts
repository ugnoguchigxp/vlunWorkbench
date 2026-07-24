import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import { getConnInfo, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { FailureKind } from "../../shared/schemas/failure.schema";
import type { DbConnection } from "../db";
import { createDbConnection } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { rateLimiter } from "../middleware/rate-limiter";
import { AgenticSearchService } from "../modules/agentic-search/agentic-search.service";
import { OpenAiResponsesAdapter } from "../modules/agentic-search/llm/openai-responses-adapter";
import { AgenticSearchRunner } from "../modules/agentic-search/runner";
import { AgenticToolRegistry } from "../modules/agentic-search/tools/registry";
import type { AgenticSearchResult } from "../modules/agentic-search/types";
import { AuthService } from "../modules/auth/auth.service";
import { HttpError } from "../modules/auth/errors";
import { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { SourceRetriever } from "../modules/rag/retriever";
import { SearchEvidenceCollector } from "../modules/rag/search-evidence";
import { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { ScanReportRepository } from "../modules/scans/report-repository";
import { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { SettingsRepository } from "../modules/settings/settings.repository";
import { SourceRepository } from "../modules/sources/source.repository";
import {
	createWikiBlobSyncer,
	type WikiBlobSyncer,
} from "../modules/sources/wiki/blob-sync";
import { readPage } from "../modules/sources/wiki/content-repo";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import { LlmRouter } from "../providers/llmRouter";
import type {
	EmbeddingProvider,
	LlmProvider,
	WebSearchProvider,
} from "../providers/types";
import { createConfiguredWebSearchProvider } from "../providers/webSearchProviderFactory";
import { createAdminUsersRoute } from "../routes/admin-users.route";
import { createAgenticSearchRoute } from "../routes/agentic-search.route";
import { createArtifactsRoute } from "../routes/artifacts.route";
import { createAuthRoute } from "../routes/auth.route";
import { createChatRoute } from "../routes/chat.route";
import { createDastRoute } from "../routes/dast.route";
import { createDiagnosticsRoute } from "../routes/diagnostics.route";
import { createDynamicRoute } from "../routes/dynamic.route";
import { createFindingDecisionsRoute } from "../routes/finding-decisions.route";
import { createFindingReviewsRoute } from "../routes/finding-reviews.route";
import { createFindingsRoute } from "../routes/findings.route";
import { createHealthRoute } from "../routes/health.route";
import { createProjectsRoute } from "../routes/projects.route";
import { createReproductionsRoute } from "../routes/reproductions.route";
import { createScanProfilesRoute } from "../routes/scan-profiles.route";
import { createScanReportsRoute } from "../routes/scan-reports.route";
import { createScansRoute } from "../routes/scans.route";
import { createSearchRoute } from "../routes/search.route";
import { createSettingsRoute } from "../routes/settings.route";
import { createStaticIntelligenceRoute } from "../routes/static-intelligence.route";
import { createSourcesRoute } from "../routes/sources.route";
import { type AppEnv, readAppEnv } from "./env";
import { shouldLogAppError } from "./error-logging";

type AppRuntime = {
	env: AppEnv;
	dbConnection: DbConnection;
	llmProvider: LlmProvider;
	embeddingProvider: EmbeddingProvider;
	webSearchProvider?: WebSearchProvider;
	webSearchProviderName: string | null;
	webSearchUnavailableMessage: string | null;
	sourceRepository: SourceRepository;
	retriever: SourceRetriever;
	evidenceCollector: SearchEvidenceCollector;
	authService: AuthService;
	settingsRepository: SettingsRepository;
	llmSettingsRepository: LlmSettingsRepository;
	llmRouter: LlmRouter;
	wikiBlobSyncer: WikiBlobSyncer | null;
	scanSupervisor: ScanProcessSupervisor;
	agenticSearchService: {
		run(input: {
			query: string;
			userId: string;
			topK: number;
			category?: string;
		}): Promise<AgenticSearchResult>;
	};
};

function createAgenticLogger(debug: boolean) {
	return (params: {
		level: "info" | "debug" | "warn" | "error";
		event: string;
		data?: Record<string, unknown>;
	}) => {
		if (params.level === "debug" && !debug) return;
		const line = `[agentic-search][${params.level}] ${params.event}${
			params.data ? ` ${JSON.stringify(params.data)}` : ""
		}`;
		if (params.level === "error") {
			console.error(line);
			return;
		}
		console.log(line);
	};
}

class UnconfiguredProvider implements LlmProvider, EmbeddingProvider {
	constructor(private readonly reason: string) {}

	async chatCompletion(): Promise<never> {
		throw new Error(this.reason);
	}

	async createEmbedding(): Promise<never> {
		throw new Error(this.reason);
	}
}

class UnconfiguredAgenticSearchService {
	readonly __unconfigured = true;

	constructor(private readonly reason: string) {}

	async run(): Promise<never> {
		throw new Error(this.reason);
	}
}

declare global {
	var __honoStandardRuntime__: Promise<unknown> | undefined;
}

function isRuntimeShape(value: unknown): value is AppRuntime {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	const settingsRepo = obj.settingsRepository as
		| Record<string, unknown>
		| undefined;
	const agenticService = obj.agenticSearchService as
		| Record<string, unknown>
		| undefined;
	return (
		Boolean(obj.env) &&
		Boolean(obj.dbConnection) &&
		Boolean(obj.llmProvider) &&
		Boolean(obj.embeddingProvider) &&
		Object.hasOwn(obj, "webSearchProviderName") &&
		Object.hasOwn(obj, "webSearchUnavailableMessage") &&
		Boolean(obj.sourceRepository) &&
		Boolean(obj.retriever) &&
		Boolean(obj.evidenceCollector) &&
		Boolean(obj.authService) &&
		Boolean(obj.settingsRepository) &&
		Boolean(obj.llmSettingsRepository) &&
		Boolean(obj.llmRouter) &&
		Object.hasOwn(obj, "wikiBlobSyncer") &&
		Boolean(obj.scanSupervisor) &&
		typeof settingsRepo?.getSystemContextForUser === "function" &&
		typeof settingsRepo?.updateSystemContext === "function" &&
		Boolean(obj.agenticSearchService) &&
		typeof agenticService?.run === "function"
	);
}

function isUnconfiguredAgenticService(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return obj.__unconfigured === true;
}

async function createRuntime(): Promise<AppRuntime> {
	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);
	const wikiBlobSyncer = createWikiBlobSyncer(env);
	await wikiBlobSyncer?.pull({ force: true });

	let provider: LlmProvider & EmbeddingProvider;
	try {
		provider = createAzureOpenAiProviderFromAppEnv(env);
	} catch (error) {
		provider = new UnconfiguredProvider(
			error instanceof Error
				? error.message
				: "Azure OpenAI is not configured in environment variables.",
		);
	}

	const sourceRepository = new SourceRepository(dbConnection.db, provider);
	const retriever = new SourceRetriever(sourceRepository, provider);
	const configuredWebSearch = createConfiguredWebSearchProvider(env);
	const evidenceCollector = new SearchEvidenceCollector({
		retriever,
		webSearchProvider: configuredWebSearch.provider,
	});
	const authService = new AuthService(dbConnection.db, env);
	const settingsRepository = new SettingsRepository(dbConnection.db);
	const llmSettingsRepository = new LlmSettingsRepository(dbConnection.db, env);
	const llmRouter = new LlmRouter(llmSettingsRepository, env);
	const scanSupervisor = new ScanProcessSupervisor(
		new ScanRepository(dbConnection.db),
	);
	await scanSupervisor.recoverStaleWebScans();

	const agenticLogger = createAgenticLogger(env.openAiAgenticSearchDebug);
	const agenticDisabledReason = !env.openAiApiKey
		? "Agentic search requires OPENAI_API_KEY, or AZURE_OPENAI_API_KEY with AZURE_OPENAI_ENDPOINT."
		: env.openAiCredentialSource === "azure" && !env.openAiBaseUrl
			? "AZURE_OPENAI_ENDPOINT (or OPENAI_BASE_URL) is required when using AZURE_OPENAI_API_KEY for Agentic search."
			: null;
	const openAiApiKey = env.openAiApiKey;

	const agenticSearchService = !agenticDisabledReason
		? (() => {
				if (!openAiApiKey) {
					throw new Error("openAiApiKey is required for Agentic search.");
				}
				const llmAdapter = new OpenAiResponsesAdapter({
					apiKey: openAiApiKey,
					baseUrl: env.openAiBaseUrl,
					apiVersion: env.openAiApiVersion,
					model: env.openAiAgenticSearchModel,
					debug: env.openAiAgenticSearchDebug,
					log: agenticLogger,
				});
				const llmDiagnostics = llmAdapter.getDiagnostics();
				agenticLogger({
					level: "info",
					event: "runtime.adapter_config",
					data: {
						...llmDiagnostics,
						credentialSource: env.openAiCredentialSource,
					},
				});
				const toolRegistry = new AgenticToolRegistry({
					sourceRepository,
					createEmbedding: (input) => provider.createEmbedding(input),
					readWikiPage: async (slug) => {
						await wikiBlobSyncer?.pull();
						return readPage(env.contentRoot, slug);
					},
					evidenceCollector,
					webSearchProvider: configuredWebSearch.provider,
					webSearchUnavailableMessage:
						configuredWebSearch.unavailableMessage ?? undefined,
					maxContextChars: env.openAiAgenticSearchMaxContextChars,
				});
				const runner = new AgenticSearchRunner({
					llmAdapter,
					toolRegistry,
					options: {
						maxToolCalls: env.openAiAgenticSearchMaxToolCalls,
						maxFetchCalls: env.openAiAgenticSearchMaxFetchCalls,
						maxContextChars: env.openAiAgenticSearchMaxContextChars,
					},
					debug: env.openAiAgenticSearchDebug,
					log: agenticLogger,
				});
				return new AgenticSearchService({
					settingsRepository,
					runner,
					debug: env.openAiAgenticSearchDebug,
					log: agenticLogger,
				});
			})()
		: new UnconfiguredAgenticSearchService(agenticDisabledReason);

	return {
		env,
		dbConnection,
		llmProvider: provider,
		embeddingProvider: provider,
		webSearchProvider: configuredWebSearch.provider,
		webSearchProviderName: configuredWebSearch.providerName,
		webSearchUnavailableMessage: configuredWebSearch.unavailableMessage,
		sourceRepository,
		retriever,
		evidenceCollector,
		authService,
		settingsRepository,
		llmSettingsRepository,
		llmRouter,
		wikiBlobSyncer,
		scanSupervisor,
		agenticSearchService,
	};
}

export async function getAppRuntime(): Promise<AppRuntime> {
	if (!globalThis.__honoStandardRuntime__) {
		globalThis.__honoStandardRuntime__ = createRuntime().catch((error) => {
			globalThis.__honoStandardRuntime__ = undefined;
			throw error;
		});
	}
	let runtimeValue = await globalThis.__honoStandardRuntime__;
	if (!isRuntimeShape(runtimeValue)) {
		globalThis.__honoStandardRuntime__ = createRuntime().catch((error) => {
			globalThis.__honoStandardRuntime__ = undefined;
			throw error;
		});
		runtimeValue = await globalThis.__honoStandardRuntime__;
	}
	if (!isRuntimeShape(runtimeValue)) {
		throw new Error("App runtime bootstrap failed: invalid runtime shape.");
	}
	if (
		isUnconfiguredAgenticService(runtimeValue.agenticSearchService) &&
		readAppEnv().openAiApiKey
	) {
		globalThis.__honoStandardRuntime__ = createRuntime().catch((error) => {
			globalThis.__honoStandardRuntime__ = undefined;
			throw error;
		});
		const refreshed = await globalThis.__honoStandardRuntime__;
		if (!isRuntimeShape(refreshed)) {
			throw new Error("App runtime bootstrap failed after refresh.");
		}
		return refreshed;
	}
	return runtimeValue;
}

const runtime = await getAppRuntime();
const app = new Hono();
const distWebRoot = path.resolve(process.cwd(), "dist-web");
const distWebIndex = path.resolve(distWebRoot, "index.html");
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
		allowHeaders: ["Content-Type", "Authorization"],
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
app.use("/api/*", csrf());
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

const projectRepository = new ProjectRepository(runtime.dbConnection.db);
const scanRepository = new ScanRepository(runtime.dbConnection.db);
const artifactRepository = new ArtifactRepository(runtime.dbConnection.db);
const findingRepository = new FindingRepository(runtime.dbConnection.db);
const findingReviewRepository = new FindingReviewRepository(
	runtime.dbConnection.db,
);
const findingDecisionRepository = new FindingDecisionRepository(
	runtime.dbConnection.db,
);
const scanReportRepository = new ScanReportRepository(runtime.dbConnection.db);
const artifactStorage = new ArtifactStorage();

app.route(
	"/api",
	createStaticIntelligenceRoute({
		db: runtime.dbConnection.db,
		projectRepository,
		scanRepository,
	}),
);
// Register the static intelligence routes before /api/projects/:projectId.
// Hono resolves matching routes in registration order, and otherwise treats
// "intelligence-summaries" as a project ID.
app.route(
	"/api/projects",
	createProjectsRoute({
		projectRepository,
		scanRepository,
		scanSupervisor: runtime.scanSupervisor,
		env: runtime.env,
	}),
);
app.route("/api/scan-profiles", createScanProfilesRoute());
app.route(
	"/api/scans",
	createScansRoute({
		scanRepository,
		projectRepository,
		artifactRepository,
		findingRepository,
		decisionRepository: findingDecisionRepository,
		scanReportRepository,
		artifactStorage,
		db: runtime.dbConnection.db,
		llmRouter: runtime.llmRouter,
		scanSupervisor: runtime.scanSupervisor,
	}),
);
app.route(
	"/api/scan-reports",
	createScanReportsRoute({
		scanReportRepository,
		scanRepository,
		projectRepository,
		artifactRepository,
		artifactStorage,
		db: runtime.dbConnection.db,
	}),
);
app.route(
	"/api/findings",
	createFindingsRoute({
		findingRepository,
		projectRepository,
		reviewRepository: findingReviewRepository,
		decisionRepository: findingDecisionRepository,
		llmProvider: runtime.llmProvider,
		llmRouter: runtime.llmRouter,
		env: runtime.env,
		db: runtime.dbConnection.db,
	}),
);
app.route(
	"/api/finding-reviews",
	createFindingReviewsRoute({
		reviewRepository: findingReviewRepository,
		findingRepository,
		projectRepository,
	}),
);
app.route(
	"/api/finding-decisions",
	createFindingDecisionsRoute({
		decisionRepository: findingDecisionRepository,
		findingRepository,
		projectRepository,
	}),
);
app.route(
	"/api",
	createReproductionsRoute({
		db: runtime.dbConnection.db,
		findingRepository,
		projectRepository,
		env: runtime.env,
	}),
);
app.route(
	"/api",
	createDynamicRoute({
		db: runtime.dbConnection.db,
		findingRepository,
		projectRepository,
		env: runtime.env,
	}),
);
app.route(
	"/api",
	createDastRoute({
		db: runtime.dbConnection.db,
		projectRepository,
		env: runtime.env,
	}),
);
app.route(
	"/api",
	createDiagnosticsRoute({
		db: runtime.dbConnection.db,
		projectRepository,
		scanRepository,
		artifactRepository,
		artifactStorage,
	}),
);

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

export default app;
export type AppType = typeof app;
