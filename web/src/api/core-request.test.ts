import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson, requestVoid } from "./core-request";

describe("core API request helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("refreshes an expired session once and retries the original request", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 401 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);

		await expect(requestJson<{ ok: boolean }>("/api/projects")).resolves.toEqual(
			{ ok: true },
		);
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"/api/projects",
			"/api/auth/refresh",
			"/api/projects",
		]);
	});

	it("keeps void requests body-aware and reports structured errors", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: "invalid request" }), {
					status: 400,
					headers: { "content-type": "application/json" },
				}),
			);

		await requestVoid("/api/auth/logout", {
			method: "POST",
			body: { reason: "test" },
		});
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "POST",
			credentials: "include",
			body: JSON.stringify({ reason: "test" }),
		});
		await expect(requestJson("/api/projects")).rejects.toThrow(
			"invalid request",
		);
	});
});
