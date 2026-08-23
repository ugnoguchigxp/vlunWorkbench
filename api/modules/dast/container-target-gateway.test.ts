import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
import { prepareContainerTargetGateway } from "./container-target-gateway";

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<number> {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("server did not bind");
	return address.port;
}

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("container target gateway", () => {
	it("forwards safe methods, rewrites Host, strips secrets, and enforces budget", async () => {
		const seen: Array<{ method: string; host: string | undefined; authorization: string | undefined }> = [];
		const upstream = http.createServer((req, res) => {
			seen.push({ method: req.method ?? "", host: req.headers.host, authorization: req.headers.authorization });
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("ok");
		});
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({ upstreamOrigin: `http://127.0.0.1:${port}`, allowedPaths: ["/api"], excludedPaths: ["/api/private"], maxRequests: 1, rateLimitPerSec: 100 });
		const response = await fetch(`${gateway.hostOrigin}/api/ok`, { headers: { authorization: "Bearer secret", cookie: "session=secret" } });
		expect(response.status).toBe(200);
		expect(seen[0]).toMatchObject({ method: "GET", host: `127.0.0.1:${port}`, authorization: undefined });
		const blocked = await fetch(`${gateway.hostOrigin}/api/second`);
		expect(blocked.status).toBe(204);
		expect(blocked.headers.get("x-vuln-workbench-gateway")).toBe("budget-blocked");
		expect(gateway.metrics()).toMatchObject({ forwardedRequests: 1, budgetBlockedRequests: 1 });
		recordScannerE2EFailureObservation("FI-09", {
			profileOutcome: "incomplete",
			reasonCodes: ["aggregate_request_budget_exceeded"],
			scannerProcessCount: 1,
			toolRunCount: 1,
			requestCount: gateway.metrics().forwardedRequests,
		});
		await gateway.stop();
	});

	it("does not forward POST or excluded paths", async () => {
		let requests = 0;
		const upstream = http.createServer((_req, res) => { requests++; res.end("ok"); });
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({ upstreamOrigin: `http://127.0.0.1:${port}`, allowedPaths: ["/"], excludedPaths: ["/private"], maxRequests: 10, rateLimitPerSec: 100 });
		expect((await fetch(`${gateway.hostOrigin}/private`)).status).toBe(404);
		expect((await fetch(`${gateway.hostOrigin}/`, { method: "POST" })).status).toBe(405);
		expect(requests).toBe(0);
		await gateway.stop();
	});

	it("enforces segment-exact operation policies and rejects encoded bypasses", async () => {
		const upstream = http.createServer((_req, res) => res.end("ok"));
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({
			upstreamOrigin: `http://127.0.0.1:${port}`,
			allowedPaths: ["/"],
			excludedPaths: [],
			maxRequests: 10,
			rateLimitPerSec: 100,
			exactOperations: [{ method: "GET", pathTemplate: "/api/users/{id}" }],
		});
		expect((await fetch(`${gateway.hostOrigin}/api/users/one`)).status).toBe(200);
		expect((await fetch(`${gateway.hostOrigin}/api/users`)).status).toBe(404);
		expect((await fetch(`${gateway.hostOrigin}/api/users/one/extra`)).status).toBe(404);
		expect((await fetch(`${gateway.hostOrigin}/api/users%2fone`)).status).toBe(404);
		expect((await fetch(`${gateway.hostOrigin}/api/users/one`, { headers: { "x-http-method-override": "POST" } })).status).toBe(405);
		expect(gateway.metrics().operationMetrics?.["GET /api/users/{id}"]).toEqual({
			attempted: 2,
			forwarded: 1,
			blocked: 1,
		});
		await gateway.stop();
	});

	it("rewrites same-origin redirects and blocks external redirects", async () => {
		const upstream = http.createServer((req, res) => {
			if (req.url === "/same") {
				res.writeHead(302, { Location: "/next" });
				return res.end();
			}
			res.writeHead(302, { Location: "http://127.0.0.1:9/external" });
			res.end();
		});
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({
			upstreamOrigin: `http://127.0.0.1:${port}`,
			allowedPaths: ["/"],
			excludedPaths: [],
			maxRequests: 10,
			rateLimitPerSec: 100,
		});
		const same = await fetch(`${gateway.hostOrigin}/same`, { redirect: "manual" });
		expect(same.status).toBe(302);
		expect(same.headers.get("location")).toBe(`${gateway.hostOrigin}/next`);
		const spoofedHost = await fetch(`${gateway.hostOrigin}/same`, {
			headers: { host: "evil.example" },
			redirect: "manual",
		});
		expect(spoofedHost.headers.get("location")).toBe(
			`${gateway.hostOrigin}/next`,
		);
		const external = await fetch(`${gateway.hostOrigin}/external`, { redirect: "manual" });
		expect(external.status).toBe(302);
		expect(external.headers.get("location")).toBeNull();
		expect(gateway.metrics().redirectBlockedResponses).toBe(1);
		await gateway.stop();
		await gateway.stop();
	});

	it("bounds scanner response bodies and reports truncation", async () => {
		const upstream = http.createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("0123456789abcdef");
		});
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({
			upstreamOrigin: `http://127.0.0.1:${port}`,
			allowedPaths: ["/"],
			excludedPaths: [],
			maxRequests: 10,
			rateLimitPerSec: 100,
			maxResponseBytes: 8,
			maxTotalResponseBytes: 16,
			containerAccess: false,
		});

		const response = await fetch(`${gateway.hostOrigin}/`);
		expect(await response.text()).toBe("01234567");
		expect(response.headers.get("x-vuln-workbench-gateway-body")).toBe(
			"truncated",
		);
		expect(gateway.metrics()).toMatchObject({
			responseBytesRead: 8,
			responseBodyTruncatedResponses: 1,
		});
		await gateway.stop();
	});

	it("strips connection-declared response headers", async () => {
		const upstream = http.createServer((_req, res) => {
			res.writeHead(200, {
				Connection: "X-Upstream-Hop",
				"X-Upstream-Hop": "must-not-forward",
			});
			res.end("ok");
		});
		const port = await listen(upstream);
		const gateway = await prepareContainerTargetGateway({
			upstreamOrigin: `http://127.0.0.1:${port}`,
			allowedPaths: ["/"],
			excludedPaths: [],
			maxRequests: 1,
			rateLimitPerSec: 100,
			containerAccess: false,
		});

		const response = await fetch(`${gateway.hostOrigin}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-upstream-hop")).toBeNull();
		await gateway.stop();
	});
});
