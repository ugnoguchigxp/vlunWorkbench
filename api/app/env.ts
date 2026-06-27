import path from "node:path";
import { z } from "zod";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
import { AGENTIC_SEARCH_DEFAULTS } from "../modules/agentic-search/constants";

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
	APP_URL: optionalUrl,
	CORS_ORIGINS: optionalTrimmedString,
	AUTH_COOKIE_SECURE: optionalBoolean,
	AUTH_COOKIE_SAME_SITE: optionalCookieSameSite,
	JWT_ACCESS_EXPIRES_IN: optionalJwtDuration,
	JWT_REFRESH_EXPIRES_IN: optionalJwtDuration,
	SECURITY_HEADERS_MODE: optionalSecurityHeadersMode,
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
	jwtSecret: string;
	jwtAccessExpiresIn: string;
	jwtRefreshExpiresIn: string;
	appUrl: string;
	corsOrigins: string[];
	trustProxy: boolean;
	secureCookie: boolean;
	cookieSameSite: "lax" | "strict" | "none";
	securityHeadersMode: "auto" | "http" | "https";
};

function parseCorsOrigins(value?: string): string[] | undefined {
	const origins = value
		?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	return origins?.length ? origins : undefined;
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string | undefined {
	const trimmed = baseUrl?.trim();
	if (!trimmed) return undefined;
	const url = new URL(trimmed);
	const host = url.hostname.toLowerCase();
	const pathname = url.pathname.replace(/\/+$/, "");
	const isAzure = /(?:^|\.)azure\.com$/i.test(host);
	const isOpenAiPublic = host === "api.openai.com";

	if (/\/openai\/deployments\/[^/]+/i.test(pathname)) {
		return `${url.origin}/openai/v1`;
	}

	if (isAzure) {
		if (!pathname || pathname === "/" || /^\/openai$/i.test(pathname)) {
			return `${url.origin}/openai/v1`;
		}
		if (/^\/openai\/v1$/i.test(pathname)) {
			return `${url.origin}/openai/v1`;
		}
		return `${url.origin}${pathname}`;
	}

	if (isOpenAiPublic) {
		if (!pathname || pathname === "/") {
			return `${url.origin}/v1`;
		}
		if (/^\/v1$/i.test(pathname)) {
			return `${url.origin}/v1`;
		}
		return `${url.origin}${pathname}`;
	}

	if (!pathname || pathname === "/") {
		return url.origin;
	}

	return `${url.origin}${pathname}`;
}

function toAzureCompatibleBaseUrl(endpoint?: string): string | undefined {
	const normalized = normalizeOpenAiBaseUrl(endpoint);
	if (!normalized) return undefined;
	if (/\/openai\/v1$/i.test(normalized)) {
		return normalized;
	}
	const url = new URL(normalized);
	return `${url.origin}/openai/v1`;
}

function normalizeSqliteDatabaseUrl(databaseUrl: string): string {
	const trimmed = databaseUrl.trim();
	if (!trimmed) return APP_CONFIG_DEFAULTS.databaseUrl;
	if (/^postgres(?:ql)?:\/\//i.test(trimmed)) {
		throw new Error(
			"DATABASE_URL must point to SQLite, for example file:./data/vuln-workbench.sqlite.",
		);
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		if (!trimmed.startsWith("sqlite://")) {
			throw new Error(
				"DATABASE_URL only supports SQLite paths, file: URLs, sqlite:// URLs, or :memory:.",
			);
		}
	}
	return trimmed;
}

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
			parsed.CODEX_SDK_TIMEOUT_MS ?? APP_CONFIG_DEFAULTS.codexSdkTimeoutMs,
		azureOpenAiEndpoint: parsed.AZURE_OPENAI_ENDPOINT,
		azureOpenAiApiKey: parsed.AZURE_OPENAI_API_KEY,
		azureOpenAiDeployment:
			parsed.AZURE_OPENAI_DEPLOYMENT ??
			APP_CONFIG_DEFAULTS.azureOpenAiDeployment,
		azureOpenAiEmbeddingsDeployment:
			parsed.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT ??
			APP_CONFIG_DEFAULTS.azureOpenAiEmbeddingsDeployment,
		azureOpenAiApiVersion: APP_CONFIG_DEFAULTS.azureOpenAiApiVersion,
		jwtSecret: parsed.JWT_SECRET ?? APP_CONFIG_DEFAULTS.jwtSecret,
		jwtAccessExpiresIn:
			parsed.JWT_ACCESS_EXPIRES_IN ?? APP_CONFIG_DEFAULTS.jwtAccessExpiresIn,
		jwtRefreshExpiresIn:
			parsed.JWT_REFRESH_EXPIRES_IN ?? APP_CONFIG_DEFAULTS.jwtRefreshExpiresIn,
		appUrl,
		corsOrigins,
		trustProxy: APP_CONFIG_DEFAULTS.trustProxy,
		secureCookie,
		cookieSameSite,
		securityHeadersMode: parsed.SECURITY_HEADERS_MODE,
	};
}
