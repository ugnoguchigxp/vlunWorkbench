import path from "node:path";
import { z } from "zod";
import {
	APP_CONFIG_DEFAULTS,
	SECURITY_CAPABILITY_DEFAULTS,
} from "../config/appDefaults";
import { RUNTIME_SETTINGS_DEFAULTS } from "../config/runtime-settings";
import { AGENTIC_SEARCH_DEFAULTS } from "../modules/agentic-search/constants";
import {
	normalizeOpenAiBaseUrl,
	normalizeSqliteDatabaseUrl,
	parseAllowedProjectRoots,
	parseCorsOrigins,
	toAzureCompatibleBaseUrl,
} from "./env-normalizers";

const optionalTrimmedString = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().optional());

const optionalUrl = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, z.string().url().optional());

const optionalBoolean = z.preprocess((value) => {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return undefined;
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return value;
}, z.boolean().optional());

const optionalCookieSameSite = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}, z.enum(["lax", "strict", "none"]).optional());

const optionalJwtDuration = z.preprocess(
	(value) => {
		if (typeof value !== "string") return value;
		const normalized = value.trim().toLowerCase();
		return normalized.length > 0 ? normalized : undefined;
	},
	z
		.string()
		.regex(/^\d+[smhd]$/)
		.optional(),
);

const optionalPositiveInteger = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, z.coerce.number().int().positive().optional());

function parseUuidCsv(value: string | undefined): string[] {
	if (!value) return [];
	const uuidSchema = z.string().uuid();
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	]
		.map((item) => uuidSchema.parse(item))
		.sort();
}

const optionalSecurityHeadersMode = z.preprocess(
	(value) => {
		if (typeof value !== "string") return value;
		const normalized = value.trim().toLowerCase();
		return normalized.length > 0 ? normalized : undefined;
	},
	z.enum(["auto", "http", "https"]).default("auto"),
);

const optionalWikiStorageBackend = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}, z.enum(["local", "azure-blob"]).optional());

const optionalScanExecutionMode = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}, z.enum(["host", "docker"]).optional());

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default(APP_CONFIG_DEFAULTS.nodeEnv),
	HOST: optionalTrimmedString,
	PORT: z.coerce.number().int().positive().max(65535).optional(),
	DATABASE_URL: optionalTrimmedString,
	CONTENT_ROOT: optionalTrimmedString,
	WIKI_STORAGE_BACKEND: optionalWikiStorageBackend,
	AZURE_STORAGE_CONNECTION_STRING: optionalTrimmedString,
	WIKI_BLOB_CONTAINER: optionalTrimmedString,
	WIKI_BLOB_PREFIX: optionalTrimmedString,
	EXA_API_KEY: optionalTrimmedString,
	BRAVE_SEARCH_API_KEY: optionalTrimmedString,
	OPENAI_API_KEY: optionalTrimmedString,
	OPENAI_BASE_URL: optionalUrl,
	CODEX_SDK_TIMEOUT_MS: optionalPositiveInteger,
	AZURE_OPENAI_ENDPOINT: optionalUrl,
	AZURE_OPENAI_API_KEY: optionalTrimmedString,
	AZURE_OPENAI_DEPLOYMENT: optionalTrimmedString,
	AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT: optionalTrimmedString,
	LLM_PROVIDER_ALLOWED_HOSTS: optionalTrimmedString,
	LLM_SETTINGS_ENCRYPTION_KEY: optionalTrimmedString,
	LLM_SETTINGS_PREVIOUS_ENCRYPTION_KEYS: optionalTrimmedString,
	DAST_AUTH_ENCRYPTION_KEY: optionalTrimmedString,
	DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS: optionalTrimmedString,
	APP_URL: optionalUrl,
	CORS_ORIGINS: optionalTrimmedString,
	AUTH_COOKIE_SECURE: optionalBoolean,
	AUTH_COOKIE_SAME_SITE: optionalCookieSameSite,
	JWT_ACCESS_EXPIRES_IN: optionalJwtDuration,
	JWT_REFRESH_EXPIRES_IN: optionalJwtDuration,
	SECURITY_HEADERS_MODE: optionalSecurityHeadersMode,
	TRUST_PROXY: optionalBoolean,
	TRUSTED_PROXY_CIDRS: optionalTrimmedString,
	CSP_MODE: z.enum(["report-only", "enforce"]).optional(),
	SCAN_EXECUTION_MODE: optionalScanExecutionMode,
	ALLOW_HOST_SCANNER_EXECUTION: optionalBoolean,
	SCAN_DOCKER_IMAGE: optionalTrimmedString,
	VULN_WORKBENCH_DOCKER_MEMORY: optionalTrimmedString,
	VULN_WORKBENCH_DOCKER_CPUS: z.coerce.number().positive().optional(),
	VULN_WORKBENCH_DOCKER_PIDS_LIMIT: optionalPositiveInteger,
	VULN_WORKBENCH_SCANNER_STDOUT_LIMIT_BYTES: optionalPositiveInteger,
	VULN_WORKBENCH_SCANNER_STDERR_LIMIT_BYTES: optionalPositiveInteger,
	VULN_WORKBENCH_WEB_PROCESS_CONCURRENCY: optionalPositiveInteger,
	VULN_WORKBENCH_WEB_SCAN_QUEUE_LIMIT: optionalPositiveInteger,
	VULN_WORKBENCH_WEB_SCAN_STEP_TIMEOUT_MAX_SEC: optionalPositiveInteger,
	VULN_WORKBENCH_WEB_SCAN_WALL_CLOCK_TIMEOUT_SEC: optionalPositiveInteger,
	STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS: optionalTrimmedString,
	STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY: z
		.enum(["registered_only", "create_within_allowed_roots"])
		.default("registered_only"),
	NIGHTWORKERS_INTEGRATION_ENABLED: optionalBoolean,
	NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS: optionalBoolean,
	NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES: optionalTrimmedString,
	NIGHTWORKERS_INTEGRATION_PREVIEW_TTL_SECONDS: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_IDEMPOTENCY_TTL_HOURS: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_MAX_CONCURRENT_SCANS: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_MAX_FINDING_PAGE_SIZE: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_MAX_EVENT_PAGE_SIZE: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_MAX_REPORT_BYTES: optionalPositiveInteger,
	NIGHTWORKERS_INTEGRATION_MAX_REQUEST_BYTES: optionalPositiveInteger,
	NIGHTWORKERS_REPORT_RUNNER_CONCURRENCY: optionalPositiveInteger,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED: optionalBoolean,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED:
		optionalBoolean,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS: optionalTrimmedString,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES:
		optionalPositiveInteger,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED: optionalBoolean,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_TTL_SECONDS:
		optionalPositiveInteger,
	NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_MAX_REQUEST_BYTES:
		optionalPositiveInteger,
	JWT_SECRET: z.preprocess((value) => {
		if (typeof value !== "string") return value;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}, z.string().min(32).optional()),
});

export type AppEnv = {
	nodeEnv: "development" | "test" | "production";
	host: string;
	port: number;
	databaseUrl: string;
	contentRoot: string;
	wikiStorageBackend: "local" | "azure-blob";
	azureStorageConnectionString?: string;
	wikiBlobContainer: string;
	wikiBlobPrefix: string;
	wikiBlobPullIntervalMs: number;
	webSearchProviderMode: "exa" | "brave" | "auto";
	exaApiKey?: string;
	exaSearchBaseUrl: string;
	braveSearchApiKey?: string;
	openAiApiKey?: string;
	openAiCredentialSource: "openai" | "azure" | "none";
	openAiBaseUrl?: string;
	openAiApiVersion?: string;
	openAiAgenticSearchModel: string;
	openAiAgenticSearchDebug: boolean;
	openAiAgenticSearchMaxToolCalls: number;
	openAiAgenticSearchMaxFetchCalls: number;
	openAiAgenticSearchMaxContextChars: number;
	codexSdkTimeoutMs: number;
	azureOpenAiEndpoint?: string;
	azureOpenAiApiKey?: string;
	azureOpenAiDeployment: string;
	azureOpenAiEmbeddingsDeployment: string;
	azureOpenAiApiVersion: string;
	llmProviderAllowedHosts?: string[];
	llmSettingsEncryptionKey?: string;
	llmSettingsPreviousEncryptionKeys?: string[];
	dastAuthEncryptionKey?: string;
	dastAuthPreviousEncryptionKeys?: string[];
	jwtSecret: string;
	jwtAccessExpiresIn: string;
	jwtRefreshExpiresIn: string;
	appUrl: string;
	corsOrigins: string[];
	trustProxy: boolean;
	trustedProxyCidrs?: string[];
	cspMode?: "report-only" | "enforce";
	secureCookie: boolean;
	cookieSameSite: "lax" | "strict" | "none";
	securityHeadersMode: "auto" | "http" | "https";
	scanExecutionMode?: "host" | "docker";
	allowHostScannerExecution?: boolean;
	scanDockerImage?: string;
	dockerMemory?: string;
	dockerCpus?: number;
	dockerPidsLimit?: number;
	scannerStdoutLimitBytes?: number;
	scannerStderrLimitBytes?: number;
	webProcessConcurrency: number;
	webScanQueueLimit: number;
	webScanStepTimeoutMaxSec: number;
	webScanWallClockTimeoutSec: number;
	staticIntelligenceAllowedProjectRoots?: string[];
	staticIntelligenceProjectCreationPolicy?:
		| "registered_only"
		| "create_within_allowed_roots";
	nightworkersIntegrationEnabled: boolean;
	nightworkersIntegrationAutoCreateProjects: boolean;
	nightworkersIntegrationAllowedProfiles: string[];
	nightworkersIntegrationPreviewTtlSeconds: number;
	nightworkersIntegrationIdempotencyTtlHours: number;
	nightworkersIntegrationMaxConcurrentScans: number;
	nightworkersIntegrationMaxFindingPageSize: number;
	nightworkersIntegrationMaxEventPageSize: number;
	nightworkersIntegrationMaxReportBytes: number;
	nightworkersIntegrationMaxRequestBytes: number;
	nightworkersReportRunnerConcurrency: number;
	nightworkersSecurityIntelligenceEnabled: boolean;
	nightworkersSecurityIntelligenceAuthorizationShadowEnabled: boolean;
	nightworkersSecurityIntelligenceAllowedProjectIds: string[];
	nightworkersSecurityIntelligenceMaxResponseBytes: number;
	nightworkersSecurityIntelligenceWorkspaceGrantEnabled?: boolean;
	nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds?: number;
	nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes?: number;
	curatedSastEnabled?: boolean;
	multiEcosystemOsvEnabled?: boolean;
	zapActiveEnabled?: boolean;
	threatModelEnabled?: boolean;
	businessLogicEnabled?: boolean;
	dastStandardV2Enabled?: boolean;
	dastStandardV2Default?: boolean;
};

export function readAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
	const parsed = EnvSchema.parse(env);
	if (
		parsed.NODE_ENV === "production" &&
		(!parsed.JWT_SECRET || parsed.JWT_SECRET === APP_CONFIG_DEFAULTS.jwtSecret)
	) {
		throw new Error(
			"Set a production JWT_SECRET before starting in production.",
		);
	}
	const appUrl = parsed.APP_URL ?? APP_CONFIG_DEFAULTS.appUrl;
	const appUrlIsHttps = appUrl.toLowerCase().startsWith("https://");
	const cookieSameSite =
		parsed.AUTH_COOKIE_SAME_SITE ??
		(APP_CONFIG_DEFAULTS.cookieSameSite as AppEnv["cookieSameSite"]);
	const defaultSecureCookie = parsed.APP_URL
		? appUrlIsHttps
		: parsed.NODE_ENV === "production" || appUrlIsHttps;
	const secureCookie = parsed.AUTH_COOKIE_SECURE ?? defaultSecureCookie;
	if (cookieSameSite === "none" && !secureCookie) {
		throw new Error(
			"AUTH_COOKIE_SAME_SITE=none requires secure cookies. Use HTTPS APP_URL or AUTH_COOKIE_SECURE=true.",
		);
	}
	const trustProxy = parsed.TRUST_PROXY ?? APP_CONFIG_DEFAULTS.trustProxy;
	const trustedProxyCidrs =
		parsed.TRUSTED_PROXY_CIDRS?.split(",")
			.map((value) => value.trim())
			.filter(Boolean) ?? [];
	if (
		parsed.NODE_ENV === "production" &&
		trustProxy &&
		trustedProxyCidrs.length === 0
	) {
		throw new Error(
			"TRUST_PROXY=true requires TRUSTED_PROXY_CIDRS in production.",
		);
	}

	const configuredCorsOrigins = parseCorsOrigins(parsed.CORS_ORIGINS);
	const corsOrigins = configuredCorsOrigins ?? [
		...APP_CONFIG_DEFAULTS.corsOrigins,
	];
	const appOrigin = new URL(appUrl).origin;
	if (!corsOrigins.includes(appOrigin)) {
		corsOrigins.push(appOrigin);
	}
	const openAiCredentialSource = parsed.OPENAI_API_KEY
		? "openai"
		: parsed.AZURE_OPENAI_API_KEY
			? "azure"
			: "none";
	const openAiApiKey = parsed.OPENAI_API_KEY || parsed.AZURE_OPENAI_API_KEY;
	const configuredOpenAiBaseUrl = normalizeOpenAiBaseUrl(
		parsed.OPENAI_BASE_URL,
	);
	const azureCompatibleBaseUrl = toAzureCompatibleBaseUrl(
		parsed.AZURE_OPENAI_ENDPOINT,
	);
	const openAiBaseUrl = parsed.OPENAI_API_KEY
		? configuredOpenAiBaseUrl
		: (azureCompatibleBaseUrl ?? configuredOpenAiBaseUrl);
	const openAiApiVersion = APP_CONFIG_DEFAULTS.openAiApiVersion;
	const openAiAgenticSearchModel =
		parsed.AZURE_OPENAI_DEPLOYMENT || APP_CONFIG_DEFAULTS.azureOpenAiDeployment;
	const databaseUrl = normalizeSqliteDatabaseUrl(
		parsed.DATABASE_URL ?? APP_CONFIG_DEFAULTS.databaseUrl,
	);
	return {
		nodeEnv: parsed.NODE_ENV,
		host: parsed.HOST ?? APP_CONFIG_DEFAULTS.host,
		port: parsed.PORT ?? APP_CONFIG_DEFAULTS.port,
		databaseUrl,
		contentRoot: path.resolve(
			process.cwd(),
			parsed.CONTENT_ROOT ?? APP_CONFIG_DEFAULTS.contentRoot,
		),
		wikiStorageBackend:
			parsed.WIKI_STORAGE_BACKEND ??
			(APP_CONFIG_DEFAULTS.wikiStorageBackend as "local" | "azure-blob"),
		azureStorageConnectionString: parsed.AZURE_STORAGE_CONNECTION_STRING,
		wikiBlobContainer:
			parsed.WIKI_BLOB_CONTAINER ?? APP_CONFIG_DEFAULTS.wikiBlobContainer,
		wikiBlobPrefix:
			parsed.WIKI_BLOB_PREFIX ?? APP_CONFIG_DEFAULTS.wikiBlobPrefix,
		wikiBlobPullIntervalMs: APP_CONFIG_DEFAULTS.wikiBlobPullIntervalMs,
		webSearchProviderMode: APP_CONFIG_DEFAULTS.webSearchProviderMode,
		exaApiKey: parsed.EXA_API_KEY,
		exaSearchBaseUrl: APP_CONFIG_DEFAULTS.exaSearchBaseUrl.replace(/\/+$/, ""),
		braveSearchApiKey: parsed.BRAVE_SEARCH_API_KEY,
		openAiApiKey,
		openAiCredentialSource,
		openAiBaseUrl,
		openAiApiVersion,
		openAiAgenticSearchModel,
		openAiAgenticSearchDebug: AGENTIC_SEARCH_DEFAULTS.debug,
		openAiAgenticSearchMaxToolCalls: AGENTIC_SEARCH_DEFAULTS.maxToolCalls,
		openAiAgenticSearchMaxFetchCalls: AGENTIC_SEARCH_DEFAULTS.maxFetchCalls,
		openAiAgenticSearchMaxContextChars: AGENTIC_SEARCH_DEFAULTS.maxContextChars,
		codexSdkTimeoutMs:
			parsed.CODEX_SDK_TIMEOUT_MS ??
			RUNTIME_SETTINGS_DEFAULTS.codexSdkTimeoutMs,
		azureOpenAiEndpoint: parsed.AZURE_OPENAI_ENDPOINT,
		azureOpenAiApiKey: parsed.AZURE_OPENAI_API_KEY,
		azureOpenAiDeployment:
			parsed.AZURE_OPENAI_DEPLOYMENT ??
			APP_CONFIG_DEFAULTS.azureOpenAiDeployment,
		azureOpenAiEmbeddingsDeployment:
			parsed.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT ??
			APP_CONFIG_DEFAULTS.azureOpenAiEmbeddingsDeployment,
		azureOpenAiApiVersion: APP_CONFIG_DEFAULTS.azureOpenAiApiVersion,
		llmProviderAllowedHosts:
			parsed.LLM_PROVIDER_ALLOWED_HOSTS?.split(",")
				.map((host) => host.trim().toLowerCase())
				.filter(Boolean) ?? [],
		llmSettingsEncryptionKey: parsed.LLM_SETTINGS_ENCRYPTION_KEY,
		llmSettingsPreviousEncryptionKeys:
			parsed.LLM_SETTINGS_PREVIOUS_ENCRYPTION_KEYS?.split(",")
				.map((key) => key.trim())
				.filter(Boolean) ?? [],
		dastAuthEncryptionKey: parsed.DAST_AUTH_ENCRYPTION_KEY,
		dastAuthPreviousEncryptionKeys:
			parsed.DAST_AUTH_PREVIOUS_ENCRYPTION_KEYS?.split(",")
				.map((key) => key.trim())
				.filter(Boolean) ?? [],
		jwtSecret: parsed.JWT_SECRET ?? APP_CONFIG_DEFAULTS.jwtSecret,
		jwtAccessExpiresIn:
			parsed.JWT_ACCESS_EXPIRES_IN ?? APP_CONFIG_DEFAULTS.jwtAccessExpiresIn,
		jwtRefreshExpiresIn:
			parsed.JWT_REFRESH_EXPIRES_IN ?? APP_CONFIG_DEFAULTS.jwtRefreshExpiresIn,
		appUrl,
		corsOrigins,
		trustProxy,
		trustedProxyCidrs,
		cspMode:
			parsed.CSP_MODE ??
			(parsed.NODE_ENV === "production" ? "enforce" : "report-only"),
		secureCookie,
		cookieSameSite,
		securityHeadersMode: parsed.SECURITY_HEADERS_MODE,
		scanExecutionMode: parsed.SCAN_EXECUTION_MODE,
		allowHostScannerExecution:
			parsed.ALLOW_HOST_SCANNER_EXECUTION ?? parsed.NODE_ENV !== "production",
		scanDockerImage: parsed.SCAN_DOCKER_IMAGE,
		dockerMemory:
			parsed.VULN_WORKBENCH_DOCKER_MEMORY ??
			RUNTIME_SETTINGS_DEFAULTS.dockerMemory,
		dockerCpus:
			parsed.VULN_WORKBENCH_DOCKER_CPUS ?? RUNTIME_SETTINGS_DEFAULTS.dockerCpus,
		dockerPidsLimit:
			parsed.VULN_WORKBENCH_DOCKER_PIDS_LIMIT ??
			RUNTIME_SETTINGS_DEFAULTS.dockerPidsLimit,
		scannerStdoutLimitBytes:
			parsed.VULN_WORKBENCH_SCANNER_STDOUT_LIMIT_BYTES ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStdoutLimitBytes,
		scannerStderrLimitBytes:
			parsed.VULN_WORKBENCH_SCANNER_STDERR_LIMIT_BYTES ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStderrLimitBytes,
		webProcessConcurrency:
			parsed.VULN_WORKBENCH_WEB_PROCESS_CONCURRENCY ??
			RUNTIME_SETTINGS_DEFAULTS.webProcessConcurrency,
		webScanQueueLimit:
			parsed.VULN_WORKBENCH_WEB_SCAN_QUEUE_LIMIT ??
			RUNTIME_SETTINGS_DEFAULTS.webScanQueueLimit,
		webScanStepTimeoutMaxSec:
			parsed.VULN_WORKBENCH_WEB_SCAN_STEP_TIMEOUT_MAX_SEC ??
			RUNTIME_SETTINGS_DEFAULTS.webScanStepTimeoutMaxSec,
		webScanWallClockTimeoutSec:
			parsed.VULN_WORKBENCH_WEB_SCAN_WALL_CLOCK_TIMEOUT_SEC ??
			RUNTIME_SETTINGS_DEFAULTS.webScanWallClockTimeoutSec,
		staticIntelligenceAllowedProjectRoots: parseAllowedProjectRoots(
			parsed.STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS,
		),
		staticIntelligenceProjectCreationPolicy:
			parsed.STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY,
		nightworkersIntegrationEnabled:
			parsed.NIGHTWORKERS_INTEGRATION_ENABLED ?? false,
		nightworkersIntegrationAutoCreateProjects:
			parsed.NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS ?? false,
		nightworkersIntegrationAllowedProfiles: [
			...new Set(
				(
					parsed.NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES ??
					"source-baseline,diff-source-baseline,diff-basic-security,basic-security,detailed-security,dependency-manifest,artifact"
				)
					.split(",")
					.map((profile) => profile.trim())
					.filter(Boolean),
			),
		],
		nightworkersIntegrationPreviewTtlSeconds:
			parsed.NIGHTWORKERS_INTEGRATION_PREVIEW_TTL_SECONDS ?? 300,
		nightworkersIntegrationIdempotencyTtlHours:
			parsed.NIGHTWORKERS_INTEGRATION_IDEMPOTENCY_TTL_HOURS ?? 168,
		nightworkersIntegrationMaxConcurrentScans:
			parsed.NIGHTWORKERS_INTEGRATION_MAX_CONCURRENT_SCANS ?? 2,
		nightworkersIntegrationMaxFindingPageSize:
			parsed.NIGHTWORKERS_INTEGRATION_MAX_FINDING_PAGE_SIZE ?? 100,
		nightworkersIntegrationMaxEventPageSize:
			parsed.NIGHTWORKERS_INTEGRATION_MAX_EVENT_PAGE_SIZE ?? 200,
		nightworkersIntegrationMaxReportBytes:
			parsed.NIGHTWORKERS_INTEGRATION_MAX_REPORT_BYTES ?? 5 * 1024 * 1024,
		nightworkersIntegrationMaxRequestBytes:
			parsed.NIGHTWORKERS_INTEGRATION_MAX_REQUEST_BYTES ?? 64 * 1024,
		nightworkersReportRunnerConcurrency:
			parsed.NIGHTWORKERS_REPORT_RUNNER_CONCURRENCY ?? 2,
		nightworkersSecurityIntelligenceEnabled:
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED ?? false,
		nightworkersSecurityIntelligenceAuthorizationShadowEnabled:
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED ??
			false,
		nightworkersSecurityIntelligenceAllowedProjectIds: parseUuidCsv(
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS,
		),
		nightworkersSecurityIntelligenceMaxResponseBytes:
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES ??
			2 * 1024 * 1024,
		nightworkersSecurityIntelligenceWorkspaceGrantEnabled:
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED ??
			false,
		nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds: Math.min(
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_TTL_SECONDS ??
				300,
			3_600,
		),
		nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes: Math.min(
			parsed.NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_MAX_REQUEST_BYTES ??
				16 * 1024,
			64 * 1024,
		),
		curatedSastEnabled: SECURITY_CAPABILITY_DEFAULTS.curatedSastEnabled,
		multiEcosystemOsvEnabled:
			SECURITY_CAPABILITY_DEFAULTS.multiEcosystemOsvEnabled,
		zapActiveEnabled: SECURITY_CAPABILITY_DEFAULTS.zapActiveEnabled,
		threatModelEnabled: SECURITY_CAPABILITY_DEFAULTS.threatModelEnabled,
		businessLogicEnabled: SECURITY_CAPABILITY_DEFAULTS.businessLogicEnabled,
		dastStandardV2Enabled: SECURITY_CAPABILITY_DEFAULTS.dastStandardV2Enabled,
		dastStandardV2Default: SECURITY_CAPABILITY_DEFAULTS.dastStandardV2Default,
	};
}
