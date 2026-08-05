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
	});

	it("accepts database and auth runtime overrides", () => {
		const env = readAppEnv({
			HOST: "0.0.0.0",
			PORT: "5174",
			DATABASE_URL: "tmp/test.sqlite",
			JWT_SECRET: "x".repeat(32),
			APP_URL: "https://showcase.example.com",
			CORS_ORIGINS: "https://showcase.example.com,http://localhost:5173",
			AUTH_COOKIE_SECURE: "true",
			AUTH_COOKIE_SAME_SITE: "none",
			SECURITY_HEADERS_MODE: "https",
		});

		expect(env.host).toBe("0.0.0.0");
		expect(env.port).toBe(5174);
		expect(env.databaseUrl).toBe("tmp/test.sqlite");
		expect(env.jwtSecret).toBe("x".repeat(32));
		expect(env.appUrl).toBe("https://showcase.example.com");
		expect(env.corsOrigins).toEqual([
			"https://showcase.example.com",
			"http://localhost:5173",
		]);
		expect(env.secureCookie).toBe(true);
		expect(env.cookieSameSite).toBe("none");
		expect(env.securityHeadersMode).toBe("https");
	});

	it("falls back to the SQLite default when a dev shell provides a connection URL", () => {
		const env = readAppEnv({
			DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/app",
		});

		expect(env.databaseUrl).toBe(APP_CONFIG_DEFAULTS.databaseUrl);
	});

	it("rejects database connection URLs in production", () => {
		expect(() =>
			readAppEnv({
				NODE_ENV: "production",
				JWT_SECRET: "x".repeat(32),
				DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/app",
			}),
		).toThrow(/SQLite database file path/);
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

	it("normalizes blank optional values", () => {
		const env = readAppEnv({
			HOST: "   ",
			PORT: "   ",
			APP_URL: "   ",
			AUTH_COOKIE_SECURE: "   ",
			AUTH_COOKIE_SAME_SITE: "   ",
			SECURITY_HEADERS_MODE: "   ",
			JWT_SECRET: "   ",
		});

		expect(env.host).toBe(APP_CONFIG_DEFAULTS.host);
		expect(env.port).toBe(APP_CONFIG_DEFAULTS.port);
		expect(env.appUrl).toBe(APP_CONFIG_DEFAULTS.appUrl);
		expect(env.securityHeadersMode).toBe("auto");
	});

	it("accepts primitive values from programmatic callers", () => {
		const env = readAppEnv({
			PORT: 5175,
			AUTH_COOKIE_SECURE: true,
		} as unknown as NodeJS.ProcessEnv);

		expect(env.port).toBe(5175);
		expect(env.secureCookie).toBe(true);
	});

	it("requires a non-default JWT secret in production", () => {
		expect(() => readAppEnv({ NODE_ENV: "production" })).toThrow(
			/production JWT_SECRET/,
		);
		expect(() =>
			readAppEnv({
				NODE_ENV: "production",
				JWT_SECRET: APP_CONFIG_DEFAULTS.jwtSecret,
			}),
		).toThrow(/production JWT_SECRET/);

		expect(
			readAppEnv({ NODE_ENV: "production", JWT_SECRET: "x".repeat(32) })
				.nodeEnv,
		).toBe("production");
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
