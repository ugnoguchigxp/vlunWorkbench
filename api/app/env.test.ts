import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
import { RUNTIME_SETTINGS_DEFAULTS } from "../config/runtime-settings";
import { readAppEnv } from "./env";

describe("readAppEnv", () => {
	it("uses minimal app defaults", () => {
		const env = readAppEnv({});
		expect(env.nodeEnv).toBe("development");
		expect(env.host).toBe(APP_CONFIG_DEFAULTS.host);
		expect(env.port).toBe(APP_CONFIG_DEFAULTS.port);
		expect(env.databaseUrl).toBe(APP_CONFIG_DEFAULTS.databaseUrl);
		expect(env.appUrl).toBe(APP_CONFIG_DEFAULTS.appUrl);
		expect(env.corsOrigins).toEqual(APP_CONFIG_DEFAULTS.corsOrigins);
		expect(env.cookieSameSite).toBe(APP_CONFIG_DEFAULTS.cookieSameSite);
		expect(env.codexSdkTimeoutMs).toBe(
			RUNTIME_SETTINGS_DEFAULTS.codexSdkTimeoutMs,
		);
		expect(env.webProcessConcurrency).toBe(
			RUNTIME_SETTINGS_DEFAULTS.webProcessConcurrency,
		);
		expect(env.webScanQueueLimit).toBe(
			RUNTIME_SETTINGS_DEFAULTS.webScanQueueLimit,
		);
		expect(env.webScanStepTimeoutMaxSec).toBe(
			RUNTIME_SETTINGS_DEFAULTS.webScanStepTimeoutMaxSec,
		);
		expect(env.webScanWallClockTimeoutSec).toBe(
			RUNTIME_SETTINGS_DEFAULTS.webScanWallClockTimeoutSec,
		);
		expect(env.scanExecutionPlanV2).toBe(false);
		expect(env.runtimeIsolation).toEqual(
			RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation,
		);
		expect(env.jwtAccessExpiresIn).toBe("1d");
		expect(env.jwtRefreshExpiresIn).toBe("7d");
		expect(env.scanExecutionMode).toBeUndefined();
		expect(env.allowHostScannerExecution).toBe(true);
		expect(env.staticIntelligenceAllowedProjectRoots).toEqual([]);
		expect(env.staticIntelligenceProjectCreationPolicy).toBe("registered_only");
		expect(env.nightworkersIntegrationEnabled).toBe(false);
		expect(env.nightworkersIntegrationAutoCreateProjects).toBe(false);
		expect(env.nightworkersIntegrationMaxConcurrentScans).toBe(2);
		expect(env.nightworkersIntegrationMaxFindingPageSize).toBe(100);
		expect(env.nightworkersIntegrationMaxEventPageSize).toBe(200);
		expect(env.nightworkersIntegrationMaxReportBytes).toBe(5 * 1024 * 1024);
		expect(env.nightworkersIntegrationMaxRequestBytes).toBe(64 * 1024);
		expect(env.nightworkersReportRunnerConcurrency).toBe(2);
		expect(env.nightworkersSecurityIntelligenceEnabled).toBe(false);
		expect(
			env.nightworkersSecurityIntelligenceAuthorizationShadowEnabled,
		).toBe(false);
		expect(env.nightworkersSecurityIntelligenceAllowedProjectIds).toEqual([]);
		expect(env.nightworkersSecurityIntelligenceMaxResponseBytes).toBe(
			2 * 1024 * 1024,
		);
		expect(env.nightworkersSecurityIntelligenceWorkspaceGrantEnabled).toBe(
			false,
		);
		expect(env.nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds).toBe(
			300,
		);
		expect(
			env.nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes,
		).toBe(16 * 1024);
		expect(env.curatedSastEnabled).toBe(false);
		expect(env.multiEcosystemOsvEnabled).toBe(false);
		expect(env.zapActiveEnabled).toBe(false);
		expect(env.dastStandardV2Enabled).toBe(true);
		expect(env.dastStandardV2Default).toBe(true);
		expect(env.threatModelEnabled).toBe(false);
		expect(env.businessLogicEnabled).toBe(false);
	});

	it("keeps legacy runtime isolation environment values as bootstrap defaults", () => {
		const digest = `sha256:${"a".repeat(64)}`;
		const env = readAppEnv({
			VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE: `owner@${digest}`,
			VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH: digest,
		});
		expect(env.runtimeIsolation).toMatchObject({
			namespaceOwnerImage: `owner@${digest}`,
			qualificationHash: digest,
			nodeImage: "",
		});
	});

	it("normalizes the outbound LLM provider host allowlist", () => {
		const env = readAppEnv({
			LLM_PROVIDER_ALLOWED_HOSTS: "LLM.EXAMPLE, azure.example ",
		});
		expect(env.llmProviderAllowedHosts).toEqual([
			"llm.example",
			"azure.example",
		]);
	});

	it("parses the explicit execution plan v2 writer flag", () => {
		expect(
			readAppEnv({ VULN_WORKBENCH_SCAN_EXECUTION_PLAN_V2: "true" })
				.scanExecutionPlanV2,
		).toBe(true);
	});

	it("accepts an explicit Static Intelligence project creation policy", () => {
		const env = readAppEnv({
			STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY:
				"create_within_allowed_roots",
		});
		expect(env.staticIntelligenceProjectCreationPolicy).toBe(
			"create_within_allowed_roots",
		);
	});

	it("parses bounded NightWorkers integration configuration", () => {
		const env = readAppEnv({
			NIGHTWORKERS_INTEGRATION_ENABLED: "true",
			NIGHTWORKERS_INTEGRATION_AUTO_CREATE_PROJECTS: "true",
			NIGHTWORKERS_INTEGRATION_ALLOWED_PROFILES:
				"source-baseline,diff-basic-security,source-baseline",
			NIGHTWORKERS_INTEGRATION_PREVIEW_TTL_SECONDS: "120",
			NIGHTWORKERS_INTEGRATION_IDEMPOTENCY_TTL_HOURS: "24",
			NIGHTWORKERS_INTEGRATION_MAX_CONCURRENT_SCANS: "4",
			NIGHTWORKERS_INTEGRATION_MAX_FINDING_PAGE_SIZE: "50",
			NIGHTWORKERS_INTEGRATION_MAX_EVENT_PAGE_SIZE: "75",
			NIGHTWORKERS_INTEGRATION_MAX_REPORT_BYTES: "1048576",
			NIGHTWORKERS_INTEGRATION_MAX_REQUEST_BYTES: "32768",
			NIGHTWORKERS_REPORT_RUNNER_CONCURRENCY: "3",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED: "true",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED:
				"true",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS:
				"11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222,11111111-1111-4111-8111-111111111111",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_MAX_RESPONSE_BYTES: "1048576",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED: "true",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_TTL_SECONDS:
				"180",
			NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_MAX_REQUEST_BYTES:
				"8192",
		});

		expect(env.nightworkersIntegrationEnabled).toBe(true);
		expect(env.nightworkersIntegrationAutoCreateProjects).toBe(true);
		expect(env.nightworkersIntegrationAllowedProfiles).toEqual([
			"source-baseline",
			"diff-basic-security",
		]);
		expect(env.nightworkersIntegrationPreviewTtlSeconds).toBe(120);
		expect(env.nightworkersIntegrationIdempotencyTtlHours).toBe(24);
		expect(env.nightworkersIntegrationMaxConcurrentScans).toBe(4);
		expect(env.nightworkersIntegrationMaxFindingPageSize).toBe(50);
		expect(env.nightworkersIntegrationMaxEventPageSize).toBe(75);
		expect(env.nightworkersIntegrationMaxReportBytes).toBe(1_048_576);
		expect(env.nightworkersIntegrationMaxRequestBytes).toBe(32_768);
		expect(env.nightworkersReportRunnerConcurrency).toBe(3);
		expect(env.nightworkersSecurityIntelligenceEnabled).toBe(true);
		expect(
			env.nightworkersSecurityIntelligenceAuthorizationShadowEnabled,
		).toBe(true);
		expect(env.nightworkersSecurityIntelligenceAllowedProjectIds).toEqual([
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		]);
		expect(env.nightworkersSecurityIntelligenceMaxResponseBytes).toBe(1_048_576);
		expect(env.nightworkersSecurityIntelligenceWorkspaceGrantEnabled).toBe(
			true,
		);
		expect(env.nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds).toBe(
			180,
		);
		expect(
			env.nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes,
		).toBe(8_192);
	});

	it("rejects invalid Security Intelligence project allowlist entries", () => {
		expect(() =>
			readAppEnv({
				NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS:
					"not-a-project-id",
			}),
		).toThrow();
	});

	it("normalizes and deduplicates Static Intelligence allowed roots", () => {
		const env = readAppEnv({
			STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS: "./workspace, /tmp/repos,./workspace",
		});
		expect(env.staticIntelligenceAllowedProjectRoots).toEqual([
			path.resolve("./workspace"),
			path.resolve("/tmp/repos"),
		]);
	});

	it("defaults production scanners to host-disabled and accepts Docker settings", () => {
		const env = readAppEnv({
			NODE_ENV: "production",
			JWT_SECRET: "x".repeat(32),
			SCAN_EXECUTION_MODE: "docker",
			SCAN_DOCKER_IMAGE: "scanner:test",
		});
		expect(env.scanExecutionMode).toBe("docker");
		expect(env.allowHostScannerExecution).toBe(false);
		expect(env.scanDockerImage).toBe("scanner:test");
		expect(env.zapActiveEnabled).toBe(false);
	});

	it("keeps capability rollout policy in source-controlled constants", () => {
		const env = readAppEnv({
			VULN_WORKBENCH_CURATED_SAST_ENABLED: "true",
			VULN_WORKBENCH_MULTI_ECOSYSTEM_OSV_ENABLED: "true",
			VULN_WORKBENCH_ZAP_ACTIVE_ENABLED: "true",
			VULN_WORKBENCH_THREAT_MODEL_ENABLED: "true",
			VULN_WORKBENCH_BUSINESS_LOGIC_ENABLED: "true",
			VULN_WORKBENCH_DAST_STANDARD_V2_ENABLED: "false",
			VULN_WORKBENCH_DAST_STANDARD_V2_DEFAULT: "false",
		});
		expect({
			curatedSastEnabled: env.curatedSastEnabled,
			multiEcosystemOsvEnabled: env.multiEcosystemOsvEnabled,
			zapActiveEnabled: env.zapActiveEnabled,
			threatModelEnabled: env.threatModelEnabled,
			businessLogicEnabled: env.businessLogicEnabled,
			dastStandardV2Enabled: env.dastStandardV2Enabled,
			dastStandardV2Default: env.dastStandardV2Default,
		}).toEqual({
			curatedSastEnabled: false,
			multiEcosystemOsvEnabled: false,
			zapActiveEnabled: false,
			threatModelEnabled: false,
			businessLogicEnabled: false,
			dastStandardV2Enabled: true,
			dastStandardV2Default: true,
		});
	});

	it("accepts database and auth runtime overrides", () => {
		const env = readAppEnv({
			DATABASE_URL: "file:./data/example.sqlite",
			JWT_SECRET: "x".repeat(32),
			JWT_ACCESS_EXPIRES_IN: "12h",
			JWT_REFRESH_EXPIRES_IN: "7d",
			APP_URL: "https://showcase.example.com",
			CORS_ORIGINS: "https://showcase.example.com,http://localhost:29831",
			AUTH_COOKIE_SECURE: "true",
			AUTH_COOKIE_SAME_SITE: "none",
			SECURITY_HEADERS_MODE: "https",
			CODEX_SDK_TIMEOUT_MS: "900000",
		});

		expect(env.databaseUrl).toBe("file:./data/example.sqlite");
		expect(env.jwtSecret).toBe("x".repeat(32));
		expect(env.jwtAccessExpiresIn).toBe("12h");
		expect(env.jwtRefreshExpiresIn).toBe("7d");
		expect(env.appUrl).toBe("https://showcase.example.com");
		expect(env.corsOrigins).toEqual([
			"https://showcase.example.com",
			"http://localhost:29831",
		]);
		expect(env.secureCookie).toBe(true);
		expect(env.cookieSameSite).toBe("none");
		expect(env.securityHeadersMode).toBe("https");
		expect(env.codexSdkTimeoutMs).toBe(900_000);
	});

	it("accepts Web process and scan deadline overrides", () => {
		const env = readAppEnv({
			VULN_WORKBENCH_WEB_PROCESS_CONCURRENCY: "4",
			VULN_WORKBENCH_WEB_SCAN_QUEUE_LIMIT: "24",
			VULN_WORKBENCH_WEB_SCAN_STEP_TIMEOUT_MAX_SEC: "1800",
			VULN_WORKBENCH_WEB_SCAN_WALL_CLOCK_TIMEOUT_SEC: "7200",
		});

		expect(env.webProcessConcurrency).toBe(4);
		expect(env.webScanQueueLimit).toBe(24);
		expect(env.webScanStepTimeoutMaxSec).toBe(1_800);
		expect(env.webScanWallClockTimeoutSec).toBe(7_200);
	});

	it("rejects SameSite none without secure cookies", () => {
		expect(() =>
			readAppEnv({
				APP_URL: "http://showcase.example.com",
				AUTH_COOKIE_SECURE: "false",
				AUTH_COOKIE_SAME_SITE: "none",
			}),
		).toThrow(/requires secure cookies/);
	});

	it("handles invalid boolean values by letting zod fail validation", () => {
		expect(() =>
			readAppEnv({
				AUTH_COOKIE_SECURE: "invalid-boolean-string",
			}),
		).toThrow();
	});

	it("automatically includes APP_URL origin in CORS_ORIGINS", () => {
		const env = readAppEnv({
			APP_URL: "https://my-app.com",
			CORS_ORIGINS: "https://other-origin.com",
		});
		expect(env.corsOrigins).toContain("https://my-app.com");
		expect(env.corsOrigins).toContain("https://other-origin.com");
	});
});
