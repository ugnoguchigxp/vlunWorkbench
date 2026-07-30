import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import {
	type PreparedActiveContainerTargetGateway,
	prepareActiveContainerTargetGateway,
} from "./active-container-target-gateway";

let gateway: PreparedActiveContainerTargetGateway | null = null;
let upstream: http.Server | null = null;

afterEach(async () => {
	await gateway?.stop();
	gateway = null;
	if (upstream)
		await new Promise<void>((resolve) => upstream?.close(() => resolve()));
	upstream = null;
});

describe("active container target gateway", () => {
	test("enforces method, path, budget, auth injection, and evidence redaction", async () => {
		const seenAuth: string[] = [];
		upstream = http.createServer(async (request, response) => {
			seenAuth.push(request.headers.authorization ?? "");
			response.writeHead(200, { "content-type": "application/json" });
			response.end('{"ok":true}');
		});
		await listen(upstream);
		const evidence: unknown[] = [];
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["GET", "POST"],
			allowedPaths: ["/api"],
			maxRequests: 1,
			rateLimitPerSec: 100,
			authSecret: { kind: "bearer_token", token: "credential-canary" },
			onEvidence: (item) => {
				evidence.push(item);
			},
		});
		expect(
			(
				await fetch(`${gateway.hostOrigin}/api/items`, {
					method: "POST",
					body: '{"name":"test"}',
				})
			).status,
		).toBe(200);
		expect((await fetch(`${gateway.hostOrigin}/outside`)).status).toBe(404);
		expect((await fetch(`${gateway.hostOrigin}/api/items`)).status).toBe(429);
		expect(seenAuth).toEqual(["Bearer credential-canary"]);
		expect(JSON.stringify(evidence)).not.toContain("credential-canary");
		expect(gateway.metrics()).toMatchObject({
			forwardedRequests: 1,
			pathBlockedRequests: 1,
			budgetBlockedRequests: 1,
		});
	});

	test("rejects secret headers and oversized bodies before forwarding", async () => {
		let forwarded = 0;
		upstream = http.createServer((_request, response) => {
			forwarded++;
			response.end("ok");
		});
		await listen(upstream);
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["POST"],
			allowedPaths: ["/"],
			maxRequests: 10,
			rateLimitPerSec: 2,
			maxRequestBodyBytes: 4,
		});
		expect(
			(
				await fetch(gateway.hostOrigin, {
					method: "POST",
					headers: { Authorization: "Bearer must-not-pass" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await fetch(gateway.hostOrigin, {
					method: "POST",
					body: "oversized",
				})
			).status,
		).toBe(413);
		expect(
			(
				await fetch(gateway.hostOrigin, {
					method: "POST",
					body: "oversized-again",
				})
			).status,
		).toBe(413);
		expect(
			(
				await fetch(gateway.hostOrigin, {
					method: "POST",
					body: "okay",
				})
			).status,
		).toBe(200);
		expect(gateway.metrics().concurrencyBlockedRequests).toBe(0);
		expect(forwarded).toBe(1);
	});

	test("bounds chunked upstream responses without retaining them in memory", async () => {
		upstream = http.createServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/plain" });
			response.write("1234");
			response.end("5678");
		});
		await listen(upstream);
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["GET"],
			allowedPaths: ["/"],
			maxRequests: 2,
			rateLimitPerSec: 2,
			maxResponseBodyBytes: 4,
		});
		expect((await fetch(gateway.hostOrigin)).status).toBe(502);
		expect(gateway.metrics()).toMatchObject({
			forwardedRequests: 0,
			oversizeBlockedRequests: 1,
		});
	});

	test("does not leak concurrency when evidence persistence fails", async () => {
		upstream = http.createServer((_request, response) => response.end("ok"));
		await listen(upstream);
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["GET"],
			allowedPaths: ["/"],
			maxRequests: 2,
			rateLimitPerSec: 2,
			maxConcurrency: 1,
			onEvidence: async () => {
				throw new Error("database unavailable");
			},
		});
		expect((await fetch(gateway.hostOrigin)).status).toBe(200);
		expect((await fetch(gateway.hostOrigin)).status).toBe(200);
		await gateway.stop();
		expect(gateway.metrics()).toMatchObject({
			forwardedRequests: 2,
			concurrencyBlockedRequests: 0,
			evidencePersistenceFailures: 2,
		});
		gateway = null;
	});

	test("rewrites same-origin redirects without trusting the inbound Host header", async () => {
		upstream = http.createServer((request, response) => {
			response.writeHead(302, {
				location:
					request.url === "/external"
						? "https://outside.example/path"
						: "/next?from=upstream",
			});
			response.end();
		});
		await listen(upstream);
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["GET"],
			allowedPaths: ["/"],
			maxRequests: 2,
			rateLimitPerSec: 2,
		});
		const sameOrigin = await fetch(gateway.hostOrigin, {
			headers: { host: "attacker.example" },
			redirect: "manual",
		});
		expect(sameOrigin.headers.get("location")).toBe("/next?from=upstream");
		const external = await fetch(`${gateway.hostOrigin}/external`, {
			redirect: "manual",
		});
		expect(external.headers.get("location")).toBeNull();
		expect(gateway.metrics().redirectBlockedResponses).toBe(1);
	});

	test("strips fixed and connection-declared hop-by-hop response headers", async () => {
		let forwardedHopHeader: string | undefined;
		upstream = http.createServer((request, response) => {
			forwardedHopHeader = request.headers["x-internal-hop"] as
				| string
				| undefined;
			response.writeHead(200, {
				connection: "x-internal-hop",
				"keep-alive": "timeout=60",
				"proxy-authenticate": "Basic realm=internal",
				"x-internal-hop": "must-not-pass",
			});
			response.end("ok");
		});
		await listen(upstream);
		gateway = await prepareActiveContainerTargetGateway({
			upstreamOrigin: serverOrigin(upstream),
			allowedMethods: ["GET"],
			allowedPaths: ["/"],
			maxRequests: 1,
			rateLimitPerSec: 2,
		});
		const result = await rawGet(gateway.hostOrigin, {
			connection: "x-internal-hop",
			"x-internal-hop": "must-not-forward",
		});
		expect(result.statusCode).toBe(200);
		expect(forwardedHopHeader).toBeUndefined();
		expect(result.headers["keep-alive"]).toBeUndefined();
		expect(result.headers["proxy-authenticate"]).toBeUndefined();
		expect(result.headers["x-internal-hop"]).toBeUndefined();
	});

	test("rejects non-positive resource bounds", async () => {
		upstream = http.createServer((_request, response) => response.end("ok"));
		await listen(upstream);
		await expect(
			prepareActiveContainerTargetGateway({
				upstreamOrigin: serverOrigin(upstream),
				allowedMethods: ["GET"],
				allowedPaths: ["/"],
				maxRequests: 1,
				rateLimitPerSec: 1,
				maxConcurrency: 0,
			}),
		).rejects.toThrow("active_gateway_concurrency_invalid");
	});
});

async function listen(server: http.Server): Promise<void> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function serverOrigin(server: http.Server): string {
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("not listening");
	return `http://127.0.0.1:${address.port}`;
}

async function rawGet(
	url: string,
	headers: Record<string, string>,
): Promise<{
	statusCode: number | undefined;
	headers: http.IncomingHttpHeaders;
}> {
	return await new Promise((resolve, reject) => {
		const request = http.get(url, { headers }, (response) => {
			response.resume();
			response.once("end", () =>
				resolve({
					statusCode: response.statusCode,
					headers: response.headers,
				}),
			);
		});
		request.once("error", reject);
	});
}
