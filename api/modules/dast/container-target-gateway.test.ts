import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
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
		const external = await fetch(`${gateway.hostOrigin}/external`, { redirect: "manual" });
		expect(external.status).toBe(302);
		expect(external.headers.get("location")).toBeNull();
		expect(gateway.metrics().redirectBlockedResponses).toBe(1);
		await gateway.stop();
		await gateway.stop();
	});
});
