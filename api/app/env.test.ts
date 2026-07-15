import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
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
		expect(env.codexSdkTimeoutMs).toBe(APP_CONFIG_DEFAULTS.codexSdkTimeoutMs);
		expect(env.jwtAccessExpiresIn).toBe("1d");
		expect(env.jwtRefreshExpiresIn).toBe("7d");
		expect(env.scanExecutionMode).toBeUndefined();
		expect(env.allowHostScannerExecution).toBe(true);
		expect(env.staticIntelligenceAllowedProjectRoots).toEqual([]);
		expect(env.staticIntelligenceProjectCreationPolicy).toBe("registered_only");
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
