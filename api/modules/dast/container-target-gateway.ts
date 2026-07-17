import { execFile } from "node:child_process";
import http from "node:http";
import os from "node:os";
import { promisify } from "node:util";
import { isPathAllowed, normalizeDastOrigin } from "./target-validator";

const execFileAsync = promisify(execFile);
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
};

export type PreparedContainerTargetGateway = {
	hostOrigin: string;
	containerOrigin: string;
	metrics: () => {
		forwardedRequests: number;
		budgetBlockedRequests: number;
		methodBlockedRequests: number;
		pathBlockedRequests: number;
		redirectBlockedResponses: number;
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
		const result = await execFileAsync(dockerBin, [
			"network",
			"inspect",
			"bridge",
			"--format",
			"{{(index .IPAM.Config 0).Gateway}}",
		]);
		const address = result.stdout.trim();
		if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address;
	} catch {
		// Try the host route below before failing closed.
	}
	try {
		const result = await execFileAsync("ip", ["-4", "addr", "show", "docker0"]);
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
	if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
		throw new Error("maxRequests must be a positive integer");
	}
	if (
		!Number.isFinite(options.rateLimitPerSec) ||
		options.rateLimitPerSec <= 0
	) {
		throw new Error("rateLimitPerSec must be positive");
	}
	const bindAddress = await selectBindAddress(options);
	const metrics: Metrics = {
		forwardedRequests: 0,
		budgetBlockedRequests: 0,
		methodBlockedRequests: 0,
		pathBlockedRequests: 0,
		redirectBlockedResponses: 0,
	};
	const activeControllers = new Set<AbortController>();
	let lastForwardedAt = 0;
	let reservedRequests = 0;
	let rateQueue = Promise.resolve();
	let closed = false;

	const server = http.createServer(async (req, res) => {
		if (closed) return sendText(res, 503);
		const method = (req.method ?? "GET").toUpperCase();
		if (!READ_ONLY_METHODS.has(method)) {
			metrics.methodBlockedRequests++;
			return sendText(res, 405);
		}
		const incoming = new URL(
			req.url ?? "/",
			`http://${req.headers.host ?? "gateway"}`,
		);
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
		if (reservedRequests >= options.maxRequests) {
			metrics.budgetBlockedRequests++;
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
		const upstreamUrl = new URL(
			incoming.pathname + incoming.search,
			upstreamOrigin,
		);
		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers)) {
			if (
				SECRET_HEADERS.has(name.toLowerCase()) ||
				name.toLowerCase() === "host"
			)
				continue;
			if (Array.isArray(value)) headers.set(name, value.join(", "));
			else if (value !== undefined) headers.set(name, value);
		}
		headers.set("host", new URL(upstreamOrigin).host);
		const controller = new AbortController();
		activeControllers.add(controller);
		const upstreamTimeout = setTimeout(() => controller.abort(), 10_000);
		try {
			const response = await fetch(upstreamUrl, {
				method,
				headers,
				redirect: "manual",
				signal: controller.signal,
			});
			const responseHeaders = new Headers(response.headers);
			const location = responseHeaders.get("location");
			if (location) {
				const locationUrl = new URL(location, upstreamOrigin);
				if (locationUrl.origin === upstreamOrigin) {
					const gatewayOrigin = `http://${req.headers.host}`;
					locationUrl.protocol = new URL(gatewayOrigin).protocol;
					locationUrl.hostname = new URL(gatewayOrigin).hostname;
					locationUrl.port = new URL(gatewayOrigin).port;
					responseHeaders.set("location", locationUrl.toString());
				} else {
					responseHeaders.delete("location");
					metrics.redirectBlockedResponses++;
				}
			}
			for (const [name] of responseHeaders) {
				if (
					name.toLowerCase() === "content-length" ||
					name.toLowerCase() === "transfer-encoding"
				)
					responseHeaders.delete(name);
			}
			const body =
				method === "HEAD" ? null : Buffer.from(await response.arrayBuffer());
			res.writeHead(response.status, Object.fromEntries(responseHeaders));
			res.end(body);
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
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw new Error("target_unreachable_from_container: gateway bind failed");
	}
	const hostOrigin = `http://127.0.0.1:${address.port}`;
	const containerHost =
		bindAddress === "127.0.0.1" ? "host.docker.internal" : bindAddress;
	const containerOrigin = `http://${containerHost}:${address.port}`;
	return {
		hostOrigin,
		containerOrigin,
		metrics: () => ({ ...metrics }),
		stop: async () => {
			if (closed) return;
			closed = true;
			for (const controller of activeControllers) controller.abort();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
