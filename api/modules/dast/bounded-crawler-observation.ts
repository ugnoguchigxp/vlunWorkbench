import type { DastHttpResponseObservation, ValidatedDastTarget } from "./types";
import type { DastRouteSeed } from "./route-inventory";
import { isPathAllowed } from "./target-validator";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export async function readBoundedBody(
	response: Response,
	maxBytes: number,
	maxDurationMs: number,
): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
	if (!response.body || maxBytes === 0) {
		return { text: "", bytesRead: 0, truncated: maxBytes === 0 };
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	let truncated = false;
	const deadline = Date.now() + maxDurationMs;
	try {
		while (true) {
			const remainingDuration = deadline - Date.now();
			if (remainingDuration <= 0) {
				truncated = true;
				break;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const next = await Promise.race([
				reader.read(),
				new Promise<{ timedOut: true }>((resolve) => {
					timer = setTimeout(
						() => resolve({ timedOut: true }),
						remainingDuration,
					);
				}),
			]);
			if (timer) clearTimeout(timer);
			if ("timedOut" in next) {
				truncated = true;
				break;
			}
			if (next.done) break;
			const remaining = maxBytes - bytesRead;
			if (remaining <= 0) {
				truncated = true;
				break;
			}
			const chunk =
				next.value.byteLength > remaining
					? next.value.slice(0, remaining)
					: next.value;
			chunks.push(chunk);
			bytesRead += chunk.byteLength;
			if (chunk.byteLength < next.value.byteLength) {
				truncated = true;
				break;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	const bytes = new Uint8Array(bytesRead);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
		bytesRead,
		truncated,
	};
}

export function analyzeBody(params: {
	path: string;
	contentType: string | null;
	body: string;
}): DastHttpResponseObservation["bodySignals"] {
	const body = params.body.slice(0, MAX_RESPONSE_BYTES);
	const htmlDocument =
		params.contentType?.toLowerCase().includes("text/html") === true ||
		/^\s*<!doctype html|^\s*<html[\s>]/i.test(body);
	const envFile =
		/(?:^|\n)[A-Z][A-Z0-9_]{2,}\s*=\s*[^\n]+/m.test(body) &&
		/(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|DATABASE_URL|PRIVATE_KEY)/i.test(
			body,
		);
	const debugDisclosure =
		/(?:debug\s*(?:mode|toolbar)|stack trace|traceback \(most recent call last\)|whoops! there was an error)/i.test(
			body,
		);
	const openApiDocument =
		/"(?:openapi|swagger)"\s*:\s*"[^"]+"|"paths"\s*:\s*\{/i.test(body);
	const directoryListing = /<title>\s*index of\b|<h1>\s*index of\b/i.test(body);
	const frameworkError =
		/(?:referenceerror|typeerror|syntaxerror|at\s+\S+\s+\([^)]+:\d+:\d+\)|exception in thread)/i.test(
			body,
		);
	const commonProbe = ["/.env", "/debug"].includes(params.path);
	return {
		htmlDocument,
		envFile,
		debugDisclosure,
		openApiDocument,
		directoryListing,
		frameworkError,
		spaFallback:
			commonProbe &&
			htmlDocument &&
			!(envFile || debugDisclosure || frameworkError),
	};
}

export function discoverHtmlRoutes(
	body: string,
	contentType: string | null,
	baseUrl: string,
): DastRouteSeed[] {
	if (
		!contentType?.toLowerCase().includes("text/html") &&
		!/^\s*<!doctype html|^\s*<html[\s>]/i.test(body)
	) {
		return [];
	}
	const output: DastRouteSeed[] = [];
	for (const match of body.matchAll(
		/<(?:a|link)\b[^>]*\bhref\s*=\s*["']([^"'<>]+)["'][^>]*>/gi,
	)) {
		const href = match[1];
		if (/^(?:mailto:|tel:|javascript:|data:|ws:|wss:)/i.test(href)) continue;
		try {
			output.push({
				path: new URL(href, baseUrl).toString(),
				source: "html_link",
			});
		} catch {
			// Invalid links are ignored and never reach the request queue.
		}
	}
	for (const match of body.matchAll(/<form\b([^>]*)>/gi)) {
		const attrs = match[1];
		const action = attrs.match(/\baction\s*=\s*["']([^"'<>]+)["']/i)?.[1];
		const method =
			attrs.match(/\bmethod\s*=\s*["']([^"'<>]+)["']/i)?.[1] ?? "GET";
		if (!action || method.toUpperCase() !== "GET") continue;
		try {
			output.push({
				path: new URL(action, baseUrl).toString(),
				source: "html_form",
			});
		} catch {
			// Invalid form actions are ignored.
		}
	}
	return output;
}

export function scopedRouteFromUrl(
	value: string,
	baseUrl: string,
	target: ValidatedDastTarget,
): { path: string } | null {
	try {
		const parsed = new URL(value, baseUrl);
		if (
			parsed.origin !== target.normalizedOrigin &&
			parsed.origin !== target.runnerOrigin
		) {
			return null;
		}
		if (
			!isPathAllowed({
				path: parsed.pathname,
				allowedPaths: target.allowedPaths,
				excludedPaths: target.excludedPaths,
			})
		) {
			return null;
		}
		return { path: `${parsed.pathname}${parsed.search}` };
	} catch {
		return null;
	}
}

export function selectedHeaders(headers: Headers): Record<string, string> {
	const keep = new Set([
		"content-security-policy",
		"x-frame-options",
		"x-content-type-options",
		"strict-transport-security",
		"referrer-policy",
		"permissions-policy",
		"cache-control",
		"access-control-allow-origin",
		"access-control-allow-credentials",
		"access-control-allow-methods",
		"access-control-allow-headers",
		"set-cookie",
		"content-type",
		"location",
		"server",
	]);
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		if (!keep.has(key.toLowerCase())) return;
		result[key.toLowerCase()] =
			key.toLowerCase() === "set-cookie" ? "[redacted-cookie-value]" : value;
	});
	return result;
}

export function redactSetCookies(
	headers: Headers,
): DastHttpResponseObservation["setCookies"] {
	const values =
		(headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
	return values
		.flatMap((value) => value.split(/,(?=[^;,]+=)/))
		.map((value) => {
			const parts = value.split(";").map((part) => part.trim());
			const name = parts[0]?.split("=")[0]?.trim() || "unknown";
			const attributes = parts.slice(1).map((part) => part.split("=")[0]);
			const lower = attributes.map((attribute) => attribute.toLowerCase());
			return {
				name,
				attributes,
				secure: lower.includes("secure"),
				httpOnly: lower.includes("httponly"),
				sameSite: lower.includes("samesite"),
			};
		})
		.filter((cookie) => cookie.name.length > 0);
}

export function emptyBodySignals(): DastHttpResponseObservation["bodySignals"] {
	return {
		htmlDocument: false,
		envFile: false,
		debugDisclosure: false,
		openApiDocument: false,
		directoryListing: false,
		frameworkError: false,
		spaFallback: false,
	};
}

export async function delayForRateLimit(
	rateLimitPerSec: number,
): Promise<void> {
	if (rateLimitPerSec <= 0) return;
	await new Promise((resolve) =>
		setTimeout(resolve, Math.ceil(1000 / rateLimitPerSec)),
	);
}

export function readPositiveInt(value: unknown): number | null {
	return Number.isSafeInteger(value) && (value as number) > 0
		? (value as number)
		: null;
}

export function readNonNegativeInt(value: unknown): number | null {
	return Number.isSafeInteger(value) && (value as number) >= 0
		? (value as number)
		: null;
}
