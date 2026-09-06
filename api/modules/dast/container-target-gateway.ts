import { execFile } from "node:child_process";
import http from "node:http";
import os from "node:os";
import { promisify } from "node:util";
import { closeHttpServerBounded } from "./http-server-cleanup";
import {
	HOP_BY_HOP_HEADERS,
	isQualifiedGraphqlRequest,
	matchingExactOperation,
	normalizeRequestLimits,
	readBoundedRequestBody,
	requestWithinLimits,
	validatedUpstreamHeaders,
} from "./container-target-gateway-request-policy";
import { isPathAllowed, normalizeDastOrigin } from "./target-validator";

const execFileAsync = promisify(execFile);
const NETWORK_PROBE_TIMEOUT_MS = 10_000;
const NETWORK_PROBE_MAX_BUFFER_BYTES = 64 * 1024;
const SECRET_HEADERS = new Set([
	"authorization",
	"cookie",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token",
]);
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type ContainerTargetGatewayOptions = {
	upstreamOrigin: string;
	allowedPaths: string[];
	excludedPaths: string[];
	maxRequests: number;
	rateLimitPerSec: number;
	dockerBin?: string;
	containerAccess?: boolean;
	maxResponseBytes?: number;
	maxTotalResponseBytes?: number;
	exactOperations?: ReadonlyArray<{
		method: "GET" | "HEAD" | "OPTIONS" | "POST";
		pathTemplate: string;
	}>;
	graphqlQueryOnly?: {
		pathTemplate: string;
		maxRequestBytes: number;
	};
	upstreamRequestHeaders?: Readonly<Record<string, string>>;
	requestLimits?: {
		maxPathBytes: number;
		maxPathSegmentBytes: number;
		maxQueryParameters: number;
		maxQueryValueBytes: number;
		maxQueryBytes: number;
		maxRequestHeaderBytes: number;
	};
};

export type PreparedContainerTargetGateway = {
	hostOrigin: string;
	containerOrigin: string;
	metrics: () => {
		forwardedRequests: number;
		budgetBlockedRequests: number;
		methodBlockedRequests: number;
		graphqlBlockedRequests?: number;
		pathBlockedRequests: number;
		requestLimitBlockedRequests?: number;
		redirectBlockedResponses: number;
		responseBytesRead: number;
		responseBodyTruncatedResponses: number;
		operationMetrics?: Record<
			string,
			{ attempted: number; forwarded: number; blocked: number }
		>;
	};
	stop: () => Promise<void>;
};

type Metrics = ReturnType<PreparedContainerTargetGateway["metrics"]>;

function securityHeaders(): Record<string, string> {
	return {
		"Cache-Control": "no-store",
		"Content-Security-Policy": "default-src 'none'",
		"X-Content-Type-Options": "nosniff",
	};
}

function sendText(res: http.ServerResponse, status: number, body = ""): void {
	res.writeHead(status, {
		...securityHeaders(),
		"Content-Length": String(Buffer.byteLength(body)),
	});
	res.end(body);
}

function isSafeLoopbackOrigin(origin: string): string {
	const normalized = normalizeDastOrigin(origin);
	const hostname = new URL(normalized).hostname.toLowerCase();
	if (
		hostname !== "localhost" &&
		hostname !== "::1" &&
		hostname !== "127.0.0.1" &&
		!/^127\.\d+\.\d+\.\d+$/.test(hostname)
	) {
		throw new Error(
			"target_unreachable_from_container: upstream is not loopback",
		);
	}
	return normalized;
}

async function linuxBridgeAddress(dockerBin: string): Promise<string> {
	try {
		const result = await execFileAsync(
			dockerBin,
			[
				"network",
				"inspect",
				"bridge",
				"--format",
				"{{(index .IPAM.Config 0).Gateway}}",
			],
			{
				encoding: "utf8",
				maxBuffer: NETWORK_PROBE_MAX_BUFFER_BYTES,
				timeout: NETWORK_PROBE_TIMEOUT_MS,
				killSignal: "SIGKILL",
			},
		);
		const address = result.stdout.trim();
		if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address;
	} catch {
		// Try the host route below before failing closed.
	}
	try {
		const result = await execFileAsync(
			"ip",
			["-4", "addr", "show", "docker0"],
			{
				encoding: "utf8",
				maxBuffer: NETWORK_PROBE_MAX_BUFFER_BYTES,
				timeout: NETWORK_PROBE_TIMEOUT_MS,
				killSignal: "SIGKILL",
			},
		);
		const match = result.stdout.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//);
		if (match?.[1]) return match[1];
	} catch {
		// No safe bridge address was found.
	}
	throw new Error(
		"target_unreachable_from_container: Docker bridge address unavailable",
	);
}

async function selectBindAddress(
	options: ContainerTargetGatewayOptions,
): Promise<string> {
	if (options.containerAccess === false) return "127.0.0.1";
	if (os.platform() !== "linux") return "127.0.0.1";
	return await linuxBridgeAddress(
		options.dockerBin ?? process.env.VULN_WORKBENCH_DOCKER_BIN ?? "docker",
	);
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function prepareContainerTargetGateway(
	options: ContainerTargetGatewayOptions,
): Promise<PreparedContainerTargetGateway> {
	const upstreamOrigin = isSafeLoopbackOrigin(options.upstreamOrigin);
	const upstreamRequestHeaders = validatedUpstreamHeaders(
		options.upstreamRequestHeaders,
	);
	if (
		!Number.isInteger(options.maxRequests) ||
		options.maxRequests < 1 ||
		options.maxRequests > 1000
	) {
		throw new Error("maxRequests must be between 1 and 1000");
	}
	if (
		!Number.isFinite(options.rateLimitPerSec) ||
		options.rateLimitPerSec <= 0 ||
		options.rateLimitPerSec > 100
	) {
		throw new Error("rateLimitPerSec must be between 0 and 100");
	}
	const requestLimits = normalizeRequestLimits(options.requestLimits);
	const bindAddress = await selectBindAddress(options);
	const metrics: Metrics = {
		forwardedRequests: 0,
		budgetBlockedRequests: 0,
		methodBlockedRequests: 0,
		graphqlBlockedRequests: 0,
		pathBlockedRequests: 0,
		requestLimitBlockedRequests: 0,
		redirectBlockedResponses: 0,
		responseBytesRead: 0,
		responseBodyTruncatedResponses: 0,
		operationMetrics: Object.fromEntries(
			(options.exactOperations ?? []).map((operation) => [
				`${operation.method} ${operation.pathTemplate}`,
				{ attempted: 0, forwarded: 0, blocked: 0 },
			]),
		),
	};
	const maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
	const maxTotalResponseBytes =
		options.maxTotalResponseBytes ?? 64 * 1024 * 1024;
	if (
		!Number.isInteger(maxResponseBytes) ||
		maxResponseBytes < 1 ||
		maxResponseBytes > 1024 * 1024
	) {
		throw new Error("maxResponseBytes must be between 1 and 1048576");
	}
	if (
		!Number.isInteger(maxTotalResponseBytes) ||
		maxTotalResponseBytes < maxResponseBytes ||
		maxTotalResponseBytes > 64 * 1024 * 1024
	) {
		throw new Error(
			"maxTotalResponseBytes must be between maxResponseBytes and 67108864",
		);
	}
	const activeControllers = new Set<AbortController>();
	let lastForwardedAt = 0;
	let reservedRequests = 0;
	let rateQueue = Promise.resolve();
	let closed = false;
	let gatewayPort = 0;

	const server = http.createServer(async (req, res) => {
		if (closed) return sendText(res, 503);
		const method = (req.method ?? "GET").toUpperCase();
		const requestTarget = req.url ?? "/";
		const matchedOperation = options.exactOperations
			? matchingExactOperation(requestTarget, method, options.exactOperations)
			: null;
		const operationMetric = matchedOperation
			? metrics.operationMetrics?.[
					`${matchedOperation.method} ${matchedOperation.pathTemplate}`
				]
			: null;
		if (operationMetric) operationMetric.attempted += 1;
		const isGraphqlPost =
			method === "POST" &&
			options.graphqlQueryOnly !== undefined &&
			matchedOperation?.pathTemplate === options.graphqlQueryOnly?.pathTemplate;
		if (!READ_ONLY_METHODS.has(method) && !isGraphqlPost) {
			metrics.methodBlockedRequests++;
			if (operationMetric) operationMetric.blocked += 1;
			return sendText(res, 405);
		}
		if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) {
			return sendText(res, 400);
		}
		if (
			!requestWithinLimits(
				req,
				requestTarget,
				requestLimits,
				upstreamRequestHeaders,
			)
		) {
			metrics.requestLimitBlockedRequests =
				(metrics.requestLimitBlockedRequests ?? 0) + 1;
			if (operationMetric) operationMetric.blocked += 1;
			return sendText(res, 400);
		}
		if (
			req.headers["x-http-method-override"] !== undefined ||
			req.headers["x-method-override"] !== undefined ||
			req.headers["x-http-method"] !== undefined
		) {
			metrics.methodBlockedRequests++;
			if (operationMetric) operationMetric.blocked += 1;
			return sendText(res, 405);
		}
		if (options.exactOperations && !matchedOperation) {
			metrics.pathBlockedRequests++;
			return sendText(res, 404);
		}
		const incoming = new URL(requestTarget, "http://gateway.invalid");
		if (
			!isPathAllowed({
				path: incoming.pathname,
				allowedPaths: options.allowedPaths,
				excludedPaths: options.excludedPaths,
			})
		) {
			metrics.pathBlockedRequests++;
			return sendText(res, 404);
		}
		let requestBody: string | undefined;
		if (isGraphqlPost) {
			const body = await readBoundedRequestBody(
				req,
				options.graphqlQueryOnly?.maxRequestBytes ?? 0,
			);
			if (
				!body ||
				!isQualifiedGraphqlRequest(body, req.headers["content-type"])
			) {
				metrics.graphqlBlockedRequests =
					(metrics.graphqlBlockedRequests ?? 0) + 1;
				if (operationMetric) operationMetric.blocked += 1;
				return sendText(res, 400);
			}
			requestBody = new TextDecoder().decode(body);
		}
		if (reservedRequests >= options.maxRequests) {
			metrics.budgetBlockedRequests++;
			if (operationMetric) operationMetric.blocked += 1;
			res.writeHead(204, {
				...securityHeaders(),
				"X-Vuln-Workbench-Gateway": "budget-blocked",
			});
			return res.end();
		}
		reservedRequests++;
		const rateSlot = rateQueue.then(async () => {
			const intervalMs = 1000 / options.rateLimitPerSec;
			const delay = Math.max(0, intervalMs - (Date.now() - lastForwardedAt));
			if (delay > 0) await wait(delay);
			lastForwardedAt = Date.now();
		});
		rateQueue = rateSlot.catch(() => undefined);
		await rateSlot;
		if (closed) {
			reservedRequests--;
			return sendText(res, 503);
		}
		metrics.forwardedRequests++;
		if (operationMetric) operationMetric.forwarded += 1;
		const upstreamUrl = new URL(
			incoming.pathname + incoming.search,
			upstreamOrigin,
		);
		const headers = new Headers();
		const connectionHeaders = new Set(
			(req.headers.connection ?? "")
				.split(",")
				.map((name) => name.trim().toLowerCase())
				.filter(Boolean),
		);
		for (const [name, value] of Object.entries(req.headers)) {
			const normalizedName = name.toLowerCase();
			if (
				SECRET_HEADERS.has(normalizedName) ||
				HOP_BY_HOP_HEADERS.has(normalizedName) ||
				connectionHeaders.has(normalizedName) ||
				normalizedName === "host" ||
				normalizedName === "content-length"
			)
				continue;
			if (Array.isArray(value)) headers.set(name, value.join(", "));
			else if (value !== undefined) headers.set(name, value);
		}
		for (const [name, value] of Object.entries(upstreamRequestHeaders))
			headers.set(name, value);
		headers.set("host", new URL(upstreamOrigin).host);
		const controller = new AbortController();
		activeControllers.add(controller);
		const upstreamTimeout = setTimeout(() => controller.abort(), 10_000);
		try {
			const response = await fetch(upstreamUrl, {
				method,
				headers,
				body: requestBody,
				redirect: "manual",
				signal: controller.signal,
			});
			const responseHeaders = new Headers(response.headers);
			const location = responseHeaders.get("location");
			if (location) {
				const locationUrl = new URL(location, upstreamOrigin);
				if (locationUrl.origin === upstreamOrigin) {
					const gatewayOrigin = gatewayOriginForRequest(
						req.headers.host,
						gatewayPort,
						bindAddress,
					);
					locationUrl.protocol = new URL(gatewayOrigin).protocol;
					locationUrl.hostname = new URL(gatewayOrigin).hostname;
					locationUrl.port = new URL(gatewayOrigin).port;
					responseHeaders.set("location", locationUrl.toString());
				} else {
					responseHeaders.delete("location");
					metrics.redirectBlockedResponses++;
				}
			}
			const responseConnectionHeaders = new Set(
				(responseHeaders.get("connection") ?? "")
					.split(",")
					.map((name) => name.trim().toLowerCase())
					.filter(Boolean),
			);
			for (const name of [...responseHeaders.keys()]) {
				const normalizedName = name.toLowerCase();
				if (
					normalizedName === "content-length" ||
					HOP_BY_HOP_HEADERS.has(normalizedName) ||
					responseConnectionHeaders.has(normalizedName)
				) {
					responseHeaders.delete(name);
				}
			}
			const bounded =
				method === "HEAD"
					? { body: null, truncated: false }
					: await readBoundedResponseBody(
							response,
							maxResponseBytes,
							maxTotalResponseBytes,
							metrics,
						);
			if (bounded.truncated) {
				metrics.responseBodyTruncatedResponses++;
				responseHeaders.set("X-Vuln-Workbench-Gateway-Body", "truncated");
			}
			res.writeHead(response.status, Object.fromEntries(responseHeaders));
			res.end(bounded.body);
		} catch {
			if (!res.headersSent) sendText(res, 502);
			else res.end();
		} finally {
			clearTimeout(upstreamTimeout);
			activeControllers.delete(controller);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, bindAddress, () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeHttpServerBounded(server, "target_gateway_bind_cleanup_failed");
		throw new Error("target_unreachable_from_container: gateway bind failed");
	}
	gatewayPort = address.port;
	const hostOrigin = `http://${bindAddress}:${address.port}`;
	const containerOrigin = `http://host.docker.internal:${address.port}`;
	let stopPromise: Promise<void> | null = null;
	return {
		hostOrigin,
		containerOrigin,
		metrics: () => ({ ...metrics }),
		stop: async () => {
			if (!stopPromise) {
				closed = true;
				for (const controller of activeControllers) controller.abort();
				stopPromise = closeHttpServerBounded(
					server,
					"target_gateway_cleanup_failed",
				);
			}
			await stopPromise;
		},
	};
}

function gatewayOriginForRequest(
	hostHeader: string | undefined,
	port: number,
	bindAddress: string,
): string {
	const fallback = `http://${bindAddress}:${port}`;
	if (!hostHeader || port <= 0) return fallback;
	try {
		const parsed = new URL(`http://${hostHeader}`);
		const allowedHosts = new Set([
			"127.0.0.1",
			"localhost",
			"host.docker.internal",
			bindAddress.toLowerCase(),
		]);
		if (
			!allowedHosts.has(parsed.hostname.toLowerCase()) ||
			parsed.port !== String(port)
		) {
			return fallback;
		}
		return parsed.origin;
	} catch {
		return fallback;
	}
}

async function readBoundedResponseBody(
	response: Response,
	maxResponseBytes: number,
	maxTotalResponseBytes: number,
	metrics: Metrics,
): Promise<{ body: Buffer; truncated: boolean }> {
	if (!response.body) return { body: Buffer.alloc(0), truncated: false };
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let responseBytes = 0;
	let truncated = false;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			const remainingResponse = maxResponseBytes - responseBytes;
			const remainingTotal = maxTotalResponseBytes - metrics.responseBytesRead;
			const allowed = Math.min(remainingResponse, remainingTotal);
			if (allowed <= 0) {
				truncated = true;
				break;
			}
			const chunk =
				next.value.byteLength > allowed
					? next.value.slice(0, allowed)
					: next.value;
			chunks.push(Buffer.from(chunk));
			responseBytes += chunk.byteLength;
			metrics.responseBytesRead += chunk.byteLength;
			if (chunk.byteLength < next.value.byteLength) {
				truncated = true;
				break;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return { body: Buffer.concat(chunks), truncated };
}
