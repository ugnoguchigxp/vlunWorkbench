import type { DbConnection } from "../db";
import { createDbConnection } from "../db";
import { AgenticSearchService } from "../modules/agentic-search/agentic-search.service";
import { OpenAiResponsesAdapter } from "../modules/agentic-search/llm/openai-responses-adapter";
import { AgenticSearchRunner } from "../modules/agentic-search/runner";
import { AgenticToolRegistry } from "../modules/agentic-search/tools/registry";
import type { AgenticSearchResult } from "../modules/agentic-search/types";
import { AuthService } from "../modules/auth/auth.service";
import { BusinessLogicRunner } from "../modules/business-logic/business-logic-runner";
import { ActiveAssessmentRunner } from "../modules/dast/active-assessment-runner";
import { DastAuthContextCrypto } from "../modules/dast/auth-context-crypto";
import { DastAuthContextRepository } from "../modules/dast/auth-context-repository";
import { IntegrationClientService } from "../modules/integrationClients/integration-client.service";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { SourceRetriever } from "../modules/rag/retriever";
import { SearchEvidenceCollector } from "../modules/rag/search-evidence";
import { ScanReportRunner } from "../modules/reports/scan-report-runner";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { ScanReportRepository } from "../modules/scans/report-repository";
import {
	ArtifactRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { ScanDiagnosticRunner } from "../modules/scans/scan-diagnostic-runner";
import { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import { ScanReviewRepository } from "../modules/scans/scan-review-repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
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
import { type AppEnv, readAppEnv } from "./env";

export type AppRuntime = {
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
	scanReportRunner: ScanReportRunner;
	scanDiagnosticRunner: ScanDiagnosticRunner;
	activeAssessmentRunner: ActiveAssessmentRunner;
	businessLogicRunner: BusinessLogicRunner;
	integrationClientService: IntegrationClientService;
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
		Boolean(obj.scanReportRunner) &&
		Boolean(obj.scanDiagnosticRunner) &&
		Boolean(obj.activeAssessmentRunner) &&
		Boolean(obj.businessLogicRunner) &&
		Boolean(obj.integrationClientService) &&
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
	const startupEnv = readAppEnv();
	const dbConnection = createDbConnection(startupEnv.databaseUrl);
	const settingsRepository = new SettingsRepository(dbConnection.db);
	const env = await settingsRepository.resolveAppEnv(startupEnv);
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
	const llmSettingsRepository = new LlmSettingsRepository(dbConnection.db, env);
	const llmRouter = new LlmRouter(llmSettingsRepository, env);
	const scanRepository = new ScanRepository(dbConnection.db);
	const scanReportRepository = new ScanReportRepository(dbConnection.db);
	const scanReportRunner = new ScanReportRunner(dbConnection.db, {
		reportRepository: scanReportRepository,
		artifactRepository: new ArtifactRepository(dbConnection.db),
		artifactStorage: new ArtifactStorage(),
		llmRouter,
		concurrency: env.nightworkersReportRunnerConcurrency,
		maxReportBytes: env.nightworkersIntegrationMaxReportBytes,
	});
	await scanReportRunner.recover();
	const scanReviewRepository = new ScanReviewRepository(dbConnection.db);
	const scanReviewRunner = new ScanReviewRunner(dbConnection.db, {
		llmRouter,
		reviewRepository: scanReviewRepository,
	});
	const scanDiagnosticRunner = new ScanDiagnosticRunner(dbConnection.db, {
		scanRepository,
		reviewRepository: scanReviewRepository,
		reportRepository: scanReportRepository,
		reviewRunner: scanReviewRunner,
		reportRunner: scanReportRunner,
	});
	const dastAuthContextRepository = env.dastAuthEncryptionKey
		? new DastAuthContextRepository(
				dbConnection.db,
				new DastAuthContextCrypto(
					env.dastAuthEncryptionKey,
					env.dastAuthPreviousEncryptionKeys,
				),
			)
		: undefined;
	const activeAssessmentRunner = new ActiveAssessmentRunner(dbConnection.db, {
		authContextRepository: dastAuthContextRepository,
		zapActiveEnabled: env.zapActiveEnabled,
		artifactStorage: new ArtifactStorage(),
	});
	const businessLogicRunner = new BusinessLogicRunner(dbConnection.db, {
		authContextRepository: dastAuthContextRepository,
	});
	const scanSupervisor = new ScanProcessSupervisor(scanRepository, {
		onCompletedScan: async (scanRunId) => {
			const started = await scanDiagnosticRunner.start(scanRunId);
			void started.completion.catch((error) => {
				console.error(
					`Automated diagnostic ${started.diagnosticRunId} failed:`,
					error,
				);
			});
		},
	});
	await scanSupervisor.recoverStaleWebScans();
	await scanDiagnosticRunner.recover();
	await activeAssessmentRunner.recover();
	await businessLogicRunner.recover();
	const integrationClientService = new IntegrationClientService(
		dbConnection.db,
	);

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
		scanReportRunner,
		scanDiagnosticRunner,
		activeAssessmentRunner,
		businessLogicRunner,
		integrationClientService,
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
