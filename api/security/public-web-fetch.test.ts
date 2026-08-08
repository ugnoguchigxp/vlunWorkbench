import { describe, expect, it, vi } from "vitest";
import { fetchPublicWebResource } from "./public-web-fetch";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("public web fetch", () => {
	it("rejects private DNS destinations", async () => {
		await expect(
			fetchPublicWebResource("http://metadata.google.internal/latest", {
				lookup: async () => [{ address: "169.254.169.254", family: 4 }],
				fetchImpl: vi.fn() as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_ADDRESS_NOT_ALLOWED" });
	});

	it("revalidates cross-origin redirects and strips credentials", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://redirect.example/page" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok"));
		const response = await fetchPublicWebResource("https://source.example", {
			lookup: publicLookup,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			headers: { authorization: "Bearer secret", cookie: "secret=yes" },
		});
		expect(await response.text()).toBe("ok");
		const secondInit = fetchImpl.mock.calls[1]?.[1] as RequestInit;
		expect(new Headers(secondInit.headers).has("authorization")).toBe(false);
		expect(new Headers(secondInit.headers).has("cookie")).toBe(false);
	});

	it("rejects oversized responses before buffering the body", async () => {
		await expect(
			fetchPublicWebResource("https://example.com", {
				lookup: publicLookup,
				fetchImpl: vi.fn().mockResolvedValue(
					new Response("x", {
						headers: { "content-length": String(16 * 1024 * 1024 + 1) },
					}),
				) as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "OUTBOUND_RESPONSE_TOO_LARGE" });
	});
});
