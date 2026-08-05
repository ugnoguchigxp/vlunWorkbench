import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchMe,
	fetchProtectedProfile,
	login,
	logout,
	UNAUTHORIZED_EVENT_NAME,
} from "./api";

const user = {
	id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
	email: "test@example.com",
	displayName: "Test User",
	role: "member",
};

const getRequestPath = (input: RequestInfo | URL): string => {
	if (input instanceof Request) return new URL(input.url).pathname;
	return new URL(input.toString(), "http://localhost").pathname;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("web API client", () => {
	it("sends login credentials and returns the authenticated user", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ user }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			login({
				email: user.email,
				password: "password123456",
				redirectTo: "/protected",
			}),
		).resolves.toEqual({ user });

		const [input, init] = fetchMock.mock.calls[0]!;
		expect(getRequestPath(input)).toBe("/api/auth/login");
		expect(init?.method).toBe("POST");
		expect(JSON.parse(init?.body as string)).toEqual({
			email: user.email,
			password: "password123456",
		});
	});

	it("logs out and accepts an empty success payload", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				Response.json({ success: true }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(logout()).resolves.toBeUndefined();
		expect(getRequestPath(fetchMock.mock.calls[0]![0])).toBe(
			"/api/auth/logout",
		);
	});

	it("returns the current user from a successful session response", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user })));

		await expect(fetchMe()).resolves.toEqual(user);
	});

	it("returns a protected profile", async () => {
		const profile = { email: user.email, role: user.role };
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ profile })));

		await expect(fetchProtectedProfile()).resolves.toEqual(profile);
	});

	it("uses an API error message when a JSON request fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ message: "Invalid credentials" }, { status: 400 }),
			),
		);

		await expect(
			login({ email: user.email, password: "invalid-password" }),
		).rejects.toThrow("Invalid credentials");
	});

	it("falls back to the HTTP status when an error is not JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("unavailable", { status: 503 })),
		);

		await expect(logout()).rejects.toThrow("Request failed: 503");
	});

	it("falls back to the HTTP status when JSON has no message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({}, { status: 418 })),
		);

		await expect(logout()).rejects.toThrow("Request failed: 418");
	});

	it("does not dispatch unauthorized events outside a browser", async () => {
		vi.stubGlobal("window", undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) =>
				getRequestPath(input) === "/api/auth/refresh"
					? new Response(null, { status: 401 })
					: Response.json({ message: "Unauthorized" }, { status: 401 }),
			),
		);

		await expect(fetchProtectedProfile()).rejects.toThrow("Unauthorized");
	});

	it("refreshes once and retries a protected request", async () => {
		const profile = { email: user.email, role: user.role };
		let protectedRequests = 0;
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const path = getRequestPath(input);
			if (path === "/api/auth/refresh") {
				return new Response(null, { status: 204 });
			}
			protectedRequests += 1;
			return protectedRequests === 1
				? Response.json({ message: "Unauthorized" }, { status: 401 })
				: Response.json({ profile });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchProtectedProfile()).resolves.toEqual(profile);
		expect(fetchMock.mock.calls.map(([input]) => getRequestPath(input))).toEqual([
			"/api/protected/profile",
			"/api/auth/refresh",
			"/api/protected/profile",
		]);
	});

	it("notifies the browser once when refresh cannot restore a session", async () => {
		const dispatchEvent = vi.fn();
		vi.stubGlobal("window", {
			location: { origin: "https://example.test" },
			dispatchEvent,
		});
		vi.spyOn(Date, "now").mockReturnValue(10_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const path = getRequestPath(input);
				return path === "/api/auth/refresh"
					? new Response(null, { status: 401 })
					: Response.json({ message: "Unauthorized" }, { status: 401 });
			}),
		);

		await expect(fetchProtectedProfile()).rejects.toThrow("Unauthorized");
		await expect(fetchProtectedProfile()).rejects.toThrow("Unauthorized");
		expect(dispatchEvent).toHaveBeenCalledTimes(1);
		expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
			type: UNAUTHORIZED_EVENT_NAME,
		});
	});
});
