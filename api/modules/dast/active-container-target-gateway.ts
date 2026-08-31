import crypto from "node:crypto";
import http from "node:http";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { authHeadersFor } from "./auth-material";
import {
	awaitCleanupBounded,
	closeHttpServerBounded,
} from "./http-server-cleanup";
import { isPathAllowed, normalizeDastOrigin } from "./target-validator";

const SECRET_HEADERS = new Set([
	"authorization",
	"cookie",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token",
]);
const HOP_BY_HOP_HEADERS = new Set([
	"host",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"upgrade",
	"te",
	"trailer",
]);

export type ActiveGatewayEvidence = {
	method: string;
	path: string;
	statusCode: number | null;
	durationMs: number;
	requestSha256: string;
	errorCode: string | null;
};

export type ActiveContainerTargetGatewayOptions = {
	upstreamOrigin: string;
	allowedMethods: string[];
	allowedPaths: string[];
	excludedPaths?: string[];
	maxRequests: number;
	rateLimitPerSec: number;
	maxConcurrency?: number;
	maxQueryBytes?: number;
	maxRequestBodyBytes?: number;
	maxResponseBodyBytes?: number;
	authSecret?: DastAuthSecretPayload;
	bindAddress?: string;
	containerHost?: string;
	onEvidence?: (evidence: ActiveGatewayEvidence) => void | Promise<void>;
};

export type PreparedActiveContainerTargetGateway = {
	hostOrigin: string;
	containerOrigin: string;
	metrics: () => {
		forwardedRequests: number;
		budgetBlockedRequests: number;
		concurrencyBlockedRequests: number;
		methodBlockedRequests: number;
		pathBlockedRequests: number;
		secretHeaderBlockedRequests: number;
		oversizeBlockedRequests: number;
		redirectBlockedResponses: number;
		evidencePersistenceFailures: number;
	};
	stop: () => Promise<void>;
};

export async function prepareActiveContainerTargetGateway(
	options: ActiveContainerTargetGatewayOptions,
): Promise<PreparedActiveContainerTargetGateway> {
	const upstreamOrigin = normalizeDastOrigin(options.upstreamOrigin);
	const allowedMethods = new Set(
		options.allowedMethods.map((method) => method.toUpperCase()),
	);
	if (allowedMethods.size === 0)
		throw new Error("active_gateway_methods_empty");
	if (
		!Number.isInteger(options.maxRequests) ||
		options.maxRequests < 1 ||
		options.maxRequests > 2_000
	)
		throw new Error("active_gateway_budget_invalid");
	const rateLimitPerSec = Math.min(options.rateLimitPerSec, 2);
	if (!Number.isFinite(rateLimitPerSec) || rateLimitPerSec <= 0)
		throw new Error("active_gateway_rate_invalid");
	const maxConcurrency = boundedPositiveInteger(
		options.maxConcurrency ?? 2,
		2,
		"active_gateway_concurrency_invalid",
	);
	const maxQueryBytes = boundedPositiveInteger(
		options.maxQueryBytes ?? 8_192,
		8_192,
		"active_gateway_query_limit_invalid",
	);
	const maxRequestBodyBytes = boundedPositiveInteger(
		options.maxRequestBodyBytes ?? 64_000,
		64_000,
		"active_gateway_request_body_limit_invalid",
	);
	const maxResponseBodyBytes = boundedPositiveInteger(
		options.maxResponseBodyBytes ?? 1024 * 1024,
		1024 * 1024,
		"active_gateway_response_body_limit_invalid",
	);
	const metrics = {
		forwardedRequests: 0,
		budgetBlockedRequests: 0,
		concurrencyBlockedRequests: 0,
		methodBlockedRequests: 0,
		pathBlockedRequests: 0,
		secretHeaderBlockedRequests: 0,
		oversizeBlockedRequests: 0,
		redirectBlockedResponses: 0,
		evidencePersistenceFailures: 0,
	};
	let reservedRequests = 0;
	let concurrentRequests = 0;
	let lastForwardedAt = 0;
	let rateQueue = Promise.resolve();
	let closed = false;
	const controllers = new Set<AbortController>();
	const evidenceTasks = new Set<Promise<void>>();

	const server = http.createServer(async (request, response) => {
		const startedAt = Date.now();
		let evidence: ActiveGatewayEvidence | null = null;
		let concurrencyAcquired = false;
		try {
			if (closed) return send(response, 503);
			const method = (request.method ?? "GET").toUpperCase();
			if (!allowedMethods.has(method)) {
				metrics.methodBlockedRequests++;
				return send(response, 405);
			}
			const incoming = new URL(
				request.url ?? "/",
				`http://${request.headers.host ?? "gateway"}`,
			);
			if (
				Buffer.byteLength(incoming.search) > maxQueryBytes ||
				Buffer.byteLength(incoming.pathname) > 2_048
			) {
				metrics.oversizeBlockedRequests++;
				return send(response, 413);
			}
			if (
				!isPathAllowed({
					path: incoming.pathname,
					allowedPaths: options.allowedPaths,
					excludedPaths: options.excludedPaths ?? [],
				})
			) {
				metrics.pathBlockedRequests++;
				return send(response, 404);
			}
			if (
				Object.keys(request.headers).some((name) =>
					SECRET_HEADERS.has(name.toLowerCase()),
				)
			) {
				metrics.secretHeaderBlockedRequests++;
				return send(response, 400);
			}
			if (reservedRequests >= options.maxRequests) {
				metrics.budgetBlockedRequests++;
				return send(response, 429);
			}
			if (concurrentRequests >= maxConcurrency) {
				metrics.concurrencyBlockedRequests++;
				return send(response, 429);
			}
			reservedRequests++;
			concurrentRequests++;
			concurrencyAcquired = true;
			const body = await readRequestBody(request, maxRequestBodyBytes);
			const requestSha256 = hashRequest(method, incoming, body);
			evidence = {
				method,
				path: incoming.pathname,
				statusCode: null,
				durationMs: 0,
				requestSha256,
				errorCode: null,
			};
			const rateSlot = rateQueue.then(async () => {
				const intervalMs = 1000 / rateLimitPerSec;
				const delay = Math.max(0, intervalMs - (Date.now() - lastForwardedAt));
				if (delay > 0)
					await new Promise((resolve) => setTimeout(resolve, delay));
				lastForwardedAt = Date.now();
			});
			rateQueue = rateSlot.catch(() => undefined);
			await rateSlot;
			const upstreamUrl = new URL(
				incoming.pathname + incoming.search,
				upstreamOrigin,
			);
			const headers = requestHeaders(request, upstreamOrigin);
			for (const [name, value] of Object.entries(
				authHeadersFor(options.authSecret),
			))
				headers.set(name, value);
			const controller = new AbortController();
			controllers.add(controller);
			const timeout = setTimeout(() => controller.abort(), 20_000);
			try {
				const upstream = await fetch(upstreamUrl, {
					method,
					headers,
					body: ["GET", "HEAD"].includes(method)
						? undefined
						: new Uint8Array(body),
					redirect: "manual",
					signal: controller.signal,
				});
				const responseBody =
					method === "HEAD"
						? Buffer.alloc(0)
						: await readResponseBody(upstream, maxResponseBodyBytes);
				const responseHeaders = safeResponseHeaders(
					upstream.headers,
					upstreamOrigin,
					metrics,
				);
				evidence.statusCode = upstream.status;
				metrics.forwardedRequests++;
				response.writeHead(upstream.status, responseHeaders);
				response.end(responseBody);
			} finally {
				clearTimeout(timeout);
				controllers.delete(controller);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "gateway_error";
			if (evidence)
				evidence.errorCode =
					errorMessage === "response_body_too_large"
						? "response_too_large"
						: errorMessage === "request_body_too_large"
							? "request_body_too_large"
							: "gateway_error";
			if (
				errorMessage === "request_body_too_large" ||
				errorMessage === "response_body_too_large"
			)
				metrics.oversizeBlockedRequests++;
			if (!response.headersSent)
				send(response, errorMessage === "request_body_too_large" ? 413 : 502);
			else response.end();
		} finally {
			const completedEvidence = evidence;
			if (completedEvidence) {
				completedEvidence.durationMs = Date.now() - startedAt;
				const task = Promise.resolve()
					.then(() => options.onEvidence?.(completedEvidence))
					.then(() => undefined)
					.catch(() => {
						metrics.evidencePersistenceFailures++;
					});
				evidenceTasks.add(task);
				await task.finally(() => evidenceTasks.delete(task));
			}
			if (concurrencyAcquired) concurrentRequests--;
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, options.bindAddress ?? "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeHttpServerBounded(server, "active_gateway_bind_cleanup_failed");
		throw new Error("active_gateway_bind_failed");
	}
	const hostOrigin = `http://127.0.0.1:${address.port}`;
	const containerOrigin = `http://${options.containerHost ?? "host.docker.internal"}:${address.port}`;
	let stopPromise: Promise<void> | null = null;
	return {
		hostOrigin,
		containerOrigin,
		metrics: () => ({ ...metrics }),
		stop: async () => {
			if (!stopPromise) {
				closed = true;
				for (const controller of controllers) controller.abort();
				stopPromise = (async () => {
					await closeHttpServerBounded(server, "active_gateway_cleanup_failed");
					await awaitCleanupBounded(
						Promise.allSettled([...evidenceTasks]),
						"active_gateway_evidence_cleanup_failed",
					);
				})();
			}
			await stopPromise;
		},
	};
}

function boundedPositiveInteger(
	value: number,
	maximum: number,
	errorCode: string,
): number {
	if (!Number.isInteger(value) || value < 1) throw new Error(errorCode);
	return Math.min(value, maximum);
}

function requestHeaders(
	request: http.IncomingMessage,
	upstreamOrigin: string,
): Headers {
	const headers = new Headers();
	const connectionHeaders = headerTokens(request.headers.connection);
	for (const [name, value] of Object.entries(request.headers)) {
		if (
			HOP_BY_HOP_HEADERS.has(name.toLowerCase()) ||
			connectionHeaders.has(name.toLowerCase()) ||
			SECRET_HEADERS.has(name.toLowerCase())
		)
			continue;
		if (Array.isArray(value)) headers.set(name, value.join(", "));
		else if (value !== undefined) headers.set(name, value);
	}
	headers.set("host", new URL(upstreamOrigin).host);
	return headers;
}

function safeResponseHeaders(
	input: Headers,
	upstreamOrigin: string,
	metrics: { redirectBlockedResponses: number },
): Record<string, string> {
	const headers = new Headers(input);
	const connectionHeaders = headerTokens(headers.get("connection"));
	for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
	for (const name of connectionHeaders) headers.delete(name);
	headers.delete("set-cookie");
	const location = headers.get("location");
	if (location) {
		const redirect = new URL(location, upstreamOrigin);
		if (redirect.origin !== upstreamOrigin) {
			headers.delete("location");
			metrics.redirectBlockedResponses++;
		} else {
			headers.set(
				"location",
				`${redirect.pathname}${redirect.search}${redirect.hash}`,
			);
		}
	}
	return Object.fromEntries(headers);
}

async function readRequestBody(
	request: http.IncomingMessage,
	maxBytes: number,
): Promise<Buffer> {
	const declaredLength = Number(request.headers["content-length"] ?? 0);
	if (
		!Number.isFinite(declaredLength) ||
		declaredLength < 0 ||
		declaredLength > maxBytes
	)
		throw new Error("request_body_too_large");
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > maxBytes) throw new Error("request_body_too_large");
		chunks.push(bytes);
	}
	return Buffer.concat(chunks);
}

async function readResponseBody(
	response: Response,
	maxBytes: number,
): Promise<Buffer> {
	const declaredLength = Number(response.headers.get("content-length") ?? 0);
	if (
		!Number.isFinite(declaredLength) ||
		declaredLength < 0 ||
		declaredLength > maxBytes
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error("response_body_too_large");
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("response_body_too_large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

function headerTokens(
	value: string | string[] | undefined | null,
): Set<string> {
	const values = Array.isArray(value) ? value : [value ?? ""];
	return new Set(
		values
			.flatMap((item) => item.split(","))
			.map((item) => item.trim().toLowerCase())
			.filter((item) => /^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(item)),
	);
}

function hashRequest(method: string, url: URL, body: Buffer): string {
	const hash = crypto.createHash("sha256");
	hash.update(method);
	hash.update("\0");
	hash.update(url.pathname);
	hash.update("\0");
	hash.update(url.search);
	hash.update("\0");
	hash.update(body);
	return hash.digest("hex");
}

function send(response: http.ServerResponse, status: number): void {
	if (response.headersSent) return;
	response.writeHead(status, {
		"Cache-Control": "no-store",
		"Content-Length": "0",
		"X-Content-Type-Options": "nosniff",
	});
	response.end();
}
