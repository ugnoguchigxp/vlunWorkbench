import { z } from "zod";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
import { isDatabaseConnectionUrl } from "../db/path";

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

const optionalPort = z.preprocess((value) => {
	if (typeof value === "number") return value;
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? Number(trimmed) : undefined;
}, z.number().int().min(1).max(65535).optional());

const optionalCookieSameSite = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}, z.enum(["lax", "strict", "none"]).optional());

const optionalSecurityHeadersMode = z.preprocess(
	(value) => {
		if (typeof value !== "string") return value;
		const normalized = value.trim().toLowerCase();
		return normalized.length > 0 ? normalized : undefined;
	},
	z.enum(["auto", "http", "https"]).default("auto"),
);

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default(APP_CONFIG_DEFAULTS.nodeEnv),
	HOST: optionalTrimmedString,
	PORT: optionalPort,
	DATABASE_URL: optionalTrimmedString,
	APP_URL: optionalUrl,
	CORS_ORIGINS: optionalTrimmedString,
	AUTH_COOKIE_SECURE: optionalBoolean,
	AUTH_COOKIE_SAME_SITE: optionalCookieSameSite,
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

function resolveDatabaseUrl(
	databaseUrl: string,
	nodeEnv: AppEnv["nodeEnv"],
): string {
	if (!isDatabaseConnectionUrl(databaseUrl)) return databaseUrl;
	if (nodeEnv === "production") {
		throw new Error("DATABASE_URL must be a SQLite database file path.");
	}
	return APP_CONFIG_DEFAULTS.databaseUrl;
}

export function readAppEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
	const parsed = EnvSchema.parse(env);
	const databaseUrl = resolveDatabaseUrl(
		parsed.DATABASE_URL ?? APP_CONFIG_DEFAULTS.databaseUrl,
		parsed.NODE_ENV,
	);

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

	return {
		nodeEnv: parsed.NODE_ENV,
		host: parsed.HOST ?? APP_CONFIG_DEFAULTS.host,
		port: parsed.PORT ?? APP_CONFIG_DEFAULTS.port,
		databaseUrl,
		jwtSecret: parsed.JWT_SECRET ?? APP_CONFIG_DEFAULTS.jwtSecret,
		jwtAccessExpiresIn: APP_CONFIG_DEFAULTS.jwtAccessExpiresIn,
		jwtRefreshExpiresIn: APP_CONFIG_DEFAULTS.jwtRefreshExpiresIn,
		appUrl,
		corsOrigins,
		trustProxy: APP_CONFIG_DEFAULTS.trustProxy,
		secureCookie,
		cookieSameSite,
		securityHeadersMode: parsed.SECURITY_HEADERS_MODE,
	};
}
