import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "./api";

const getRequestPath = (input: RequestInfo | URL): string => {
	if (input instanceof Request) return new URL(input.url).pathname;
	return new URL(input.toString(), "http://localhost").pathname;
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("auth api", () => {
	it("treats /auth/me 401 as a logged-out session without refreshing", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
			return new Response(JSON.stringify({ message: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchMe()).resolves.toBeNull();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls.map(([input]) => getRequestPath(input))).toEqual([
			"/api/auth/me",
		]);
	});
});
