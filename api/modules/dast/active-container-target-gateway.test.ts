import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import {
	prepareActiveContainerTargetGateway,
	type PreparedActiveContainerTargetGateway,
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
		).toBe(502);
		expect(forwarded).toBe(0);
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
