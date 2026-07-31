export const APP_CONFIG_DEFAULTS = {
	nodeEnv: "development",
	host: "127.0.0.1",
	port: 29831,
	databaseUrl: "file:./data/vuln-workbench.sqlite",
	contentRoot: "./wiki-knowledge",
	wikiStorageBackend: "local",
	wikiBlobContainer: "wiki-knowledge",
	wikiBlobPrefix: "",
	wikiBlobPullIntervalMs: 30_000,
	webSearchProviderMode: "auto",
	exaSearchBaseUrl: "https://api.exa.ai",
	azureOpenAiApiVersion: "2024-06-01",
	azureOpenAiDeployment: "gpt-4o-mini",
	azureOpenAiEmbeddingsDeployment: "text-embedding-3-small",
	openAiApiVersion: undefined as string | undefined,
	jwtSecret: "vuln-workbench-dev-jwt-secret-change-this-for-production",
	jwtAccessExpiresIn: "1d",
	jwtRefreshExpiresIn: "7d",
	appUrl: "http://localhost:29831",
	corsOrigins: ["http://localhost:29831"],
	trustProxy: false,
	cookieSameSite: "lax",
} as const;

/**
 * Product capability defaults are intentionally source-controlled. They are
 * not deployment secrets and are changed only as part of a tested release.
 */
export const SECURITY_CAPABILITY_DEFAULTS = {
	curatedSastEnabled: false,
	multiEcosystemOsvEnabled: false,
	zapActiveEnabled: false,
	threatModelEnabled: false,
	businessLogicEnabled: false,
	dastStandardV2Enabled: true,
	dastStandardV2Default: true,
} as const;
