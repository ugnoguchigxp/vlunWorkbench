import path from "node:path";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";

export function parseAllowedProjectRoots(value?: string): string[] {
	if (!value) return [];
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	].map((item) => path.resolve(item));
}

export function parseCorsOrigins(value?: string): string[] | undefined {
	const origins = value
		?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	return origins?.length ? origins : undefined;
}

export function normalizeOpenAiBaseUrl(baseUrl?: string): string | undefined {
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

export function toAzureCompatibleBaseUrl(
	endpoint?: string,
): string | undefined {
	const normalized = normalizeOpenAiBaseUrl(endpoint);
	if (!normalized) return undefined;
	if (/\/openai\/v1$/i.test(normalized)) {
		return normalized;
	}
	const url = new URL(normalized);
	return `${url.origin}/openai/v1`;
}

export function normalizeSqliteDatabaseUrl(databaseUrl: string): string {
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
