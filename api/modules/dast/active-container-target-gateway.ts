import crypto from "node:crypto";
import http from "node:http";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { authHeadersFor } from "./auth-material";
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
	const maxConcurrency = Math.min(options.maxConcurrency ?? 2, 2);
	const maxQueryBytes = Math.min(options.maxQueryBytes ?? 8_192, 8_192);
	const maxRequestBodyBytes = Math.min(
		options.maxRequestBodyBytes ?? 64_000,
		64_000,
	);
	const maxResponseBodyBytes = Math.min(
		options.maxResponseBodyBytes ?? 1024 * 1024,
		1024 * 1024,
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
	};
	let reservedRequests = 0;
	let concurrentRequests = 0;
	let lastForwardedAt = 0;
	let rateQueue = Promise.resolve();
	let closed = false;
	const controllers = new Set<AbortController>();

	const server = http.createServer(async (request, response) => {
		const startedAt = Date.now();
		let evidence: ActiveGatewayEvidence | null = null;
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
				if (
					Number(upstream.headers.get("content-length") ?? 0) >
					maxResponseBodyBytes
				) {
					metrics.oversizeBlockedRequests++;
					evidence.errorCode = "response_too_large";
					return send(response, 502);
				}
				const responseBody =
					method === "HEAD"
						? Buffer.alloc(0)
						: Buffer.from(await upstream.arrayBuffer());
				if (responseBody.byteLength > maxResponseBodyBytes) {
					metrics.oversizeBlockedRequests++;
					evidence.errorCode = "response_too_large";
					return send(response, 502);
				}
				const responseHeaders = safeResponseHeaders(
					upstream.headers,
					upstreamOrigin,
					request.headers.host ?? "gateway",
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
			if (evidence)
				evidence.errorCode =
					error instanceof Error && error.message === "request_body_too_large"
						? "request_body_too_large"
						: "gateway_error";
			if (error instanceof Error && error.message === "request_body_too_large")
				metrics.oversizeBlockedRequests++;
			if (!response.headersSent) send(response, 502);
			else response.end();
		} finally {
			if (evidence) {
				evidence.durationMs = Date.now() - startedAt;
				await options.onEvidence?.(evidence);
				concurrentRequests--;
			}
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, options.bindAddress ?? "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("active_gateway_bind_failed");
	const hostOrigin = `http://127.0.0.1:${address.port}`;
	const containerOrigin = `http://${options.containerHost ?? "host.docker.internal"}:${address.port}`;
	return {
		hostOrigin,
		containerOrigin,
		metrics: () => ({ ...metrics }),
		stop: async () => {
			if (closed) return;
			closed = true;
			for (const controller of controllers) controller.abort();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

function requestHeaders(
	request: http.IncomingMessage,
	upstreamOrigin: string,
): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (
			HOP_BY_HOP_HEADERS.has(name.toLowerCase()) ||
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
	gatewayHost: string,
	metrics: { redirectBlockedResponses: number },
): Record<string, string> {
	const headers = new Headers(input);
	for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
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
				`http://${gatewayHost}${redirect.pathname}${redirect.search}`,
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
