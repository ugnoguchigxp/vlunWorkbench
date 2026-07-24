import { describe, expect, it, vi } from "vitest";
import {
	bufferOutboundResponse,
	fetchWithOutboundPolicy,
	validateOutboundUrl,
	validateOutboundUrlSyntax,
} from "./outbound-url-policy";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("outbound URL policy", () => {
	it("allows only the official OpenAI host", async () => {
		await expect(
			validateOutboundUrl("https://api.openai.com/v1", {
				kind: "openai",
				nodeEnv: "production",
				lookup: publicLookup,
			}),
		).resolves.toBeInstanceOf(URL);
		expect(() =>
			validateOutboundUrlSyntax("https://attacker.example/v1", {
				kind: "openai",
				nodeEnv: "production",
			}),
		).toThrow(/api\.openai\.com/);
	});

	it("requires compatible and Azure hosts to be explicitly allowed", () => {
		expect(() =>
			validateOutboundUrlSyntax("https://llm.example/v1", {
				kind: "openai-compatible",
				nodeEnv: "production",
				allowedHosts: [],
			}),
		).toThrow(/LLM_PROVIDER_ALLOWED_HOSTS/);
		expect(
			validateOutboundUrlSyntax("https://llm.example/v1", {
				kind: "openai-compatible",
				nodeEnv: "production",
				allowedHosts: ["llm.example"],
			}).hostname,
		).toBe("llm.example");
	});

	it("rejects URL credentials, fragments, insecure remote URLs, and private DNS", async () => {
		for (const value of [
			"https://user:pass@api.openai.com/v1",
			"https://api.openai.com/v1#secret",
			"http://api.openai.com/v1",
		]) {
			expect(() =>
				validateOutboundUrlSyntax(value, {
					kind: "openai",
					nodeEnv: "production",
				}),
			).toThrow();
		}
		for (const address of [
			"127.0.0.1",
			"10.0.0.1",
			"169.254.169.254",
			"192.168.1.2",
			"::1",
			"fc00::1",
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"64:ff9b::7f00:1",
		]) {
			await expect(
				validateOutboundUrl("https://api.openai.com/v1", {
					kind: "openai",
					nodeEnv: "production",
					lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
				}),
			).rejects.toMatchObject({ code: "OUTBOUND_ADDRESS_NOT_ALLOWED" });
		}
	});

	it("allows local providers only on loopback", async () => {
		await expect(
			validateOutboundUrl("http://localhost:11434/v1", {
				kind: "local",
				nodeEnv: "development",
				lookup: async () => [
					{ address: "127.0.0.1", family: 4 },
					{ address: "::1", family: 6 },
				],
			}),
		).resolves.toBeInstanceOf(URL);
		expect(() =>
			validateOutboundUrlSyntax("http://192.168.1.2:11434/v1", {
				kind: "local",
				nodeEnv: "development",
			}),
		).toThrow(/loopback/);
	});

	it("revalidates redirect destinations", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://attacker.example/steal" },
				}),
			);
		await expect(
			fetchWithOutboundPolicy({
				url: "https://api.openai.com/v1/models",
				init: { method: "GET" },
				policy: {
					kind: "openai",
					nodeEnv: "production",
					lookup: publicLookup,
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_HOST_NOT_ALLOWED" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("does not forward credentials across different allowlisted hosts", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(
			new Response(null, {
				status: 307,
				headers: { location: "https://other.example/v1/models" },
			}),
		);
		await expect(
			fetchWithOutboundPolicy({
				url: "https://provider.example/v1/models",
				init: {
					method: "GET",
					headers: { authorization: "Bearer sensitive" },
				},
				policy: {
					kind: "openai-compatible",
					nodeEnv: "production",
					allowedHosts: ["provider.example", "other.example"],
					lookup: publicLookup,
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_HOST_NOT_ALLOWED" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("does not forward credentials across ports on the same host", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(
			new Response(null, {
				status: 307,
				headers: { location: "https://provider.example:8443/v1/models" },
			}),
		);
		await expect(
			fetchWithOutboundPolicy({
				url: "https://provider.example/v1/models",
				init: {
					method: "GET",
					headers: { authorization: "Bearer sensitive" },
				},
				policy: {
					kind: "openai-compatible",
					nodeEnv: "production",
					allowedHosts: ["provider.example"],
					lookup: publicLookup,
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_HOST_NOT_ALLOWED" });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("caps streamed provider responses", async () => {
		const oversized = new Response("x", {
			headers: { "content-length": String(16 * 1024 * 1024 + 1) },
		});
		await expect(
			fetchWithOutboundPolicy({
				url: "https://api.openai.com/v1/models",
				init: { method: "GET" },
				policy: {
					kind: "openai",
					nodeEnv: "production",
					lookup: publicLookup,
				},
				fetchImpl: vi.fn().mockResolvedValue(oversized) as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_RESPONSE_TOO_LARGE" });
	});

	it("buffers bounded and bodyless responses", async () => {
		const buffered = await bufferOutboundResponse(new Response("bounded"));
		expect(await buffered.text()).toBe("bounded");
		const bodyless = await bufferOutboundResponse(
			new Response(null, { status: 204 }),
		);
		expect(bodyless.status).toBe(204);
		expect(await bodyless.text()).toBe("");
	});

	it("rejects DNS failures and excessive redirects", async () => {
		await expect(
			validateOutboundUrl("https://api.openai.com/v1", {
				kind: "openai",
				nodeEnv: "production",
				lookup: async () => {
					throw new Error("DNS unavailable");
				},
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_DNS_FAILED" });
		await expect(
			validateOutboundUrl("https://api.openai.com/v1", {
				kind: "openai",
				nodeEnv: "production",
				lookup: async () => [],
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_DNS_FAILED" });

		const redirect = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "/next" },
			}),
		);
		await expect(
			fetchWithOutboundPolicy({
				url: "https://api.openai.com/start",
				init: { method: "POST", body: "{}" },
				policy: {
					kind: "openai",
					nodeEnv: "production",
					lookup: publicLookup,
				},
				fetchImpl: redirect as unknown as typeof fetch,
				maxRedirects: 1,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_REDIRECT_LIMIT" });
		expect(redirect).toHaveBeenCalledTimes(2);
	});

	it("converts 303 redirects to GET on the same host", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 303, headers: { location: "/result" } }),
			)
			.mockResolvedValueOnce(new Response("ok"));
		const response = await fetchWithOutboundPolicy({
			url: "https://api.openai.com/start",
			init: { method: "POST", body: "request" },
			policy: {
				kind: "openai",
				nodeEnv: "production",
				lookup: publicLookup,
			},
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(await response.text()).toBe("ok");
		expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
			method: "GET",
			body: undefined,
		});
	});

	it("pins the production transport to a validated address", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				}),
		});
		try {
			const response = await fetchWithOutboundPolicy({
				url: `http://127.0.0.1:${server.port}/health`,
				init: { method: "GET" },
				policy: {
					kind: "local",
					nodeEnv: "test",
					lookup: async () => [{ address: "127.0.0.1", family: 4 }],
				},
			});
			expect(await response.json()).toEqual({ ok: true });
		} finally {
			server.stop(true);
		}
	});
});
