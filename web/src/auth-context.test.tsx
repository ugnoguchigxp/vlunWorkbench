import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authMeQueryKey, UNAUTHORIZED_EVENT_NAME } from "./api";
import { AuthProvider, useAuth } from "./auth-context";
import { renderWithProviders } from "../test/render-with-providers";

const routerMocks = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => routerMocks.navigate,
}));

function AuthProbe() {
	const auth = useAuth();
	return (
		<div>
			<span data-testid="user">{auth.authUser?.email ?? "anonymous"}</span>
			<span data-testid="loading">{String(auth.authLoading)}</span>
			<span data-testid="busy">{String(auth.busy)}</span>
			<span data-testid="error">{auth.errorText ?? "none"}</span>
			<button
				type="button"
				onClick={() =>
					void auth.loginWithPassword({
						email: "user@example.com",
						password: "password123456",
						redirectTo: "/protected",
					})
				}
			>
				Login
			</button>
			<button
				type="button"
				onClick={() =>
					void auth.loginWithPassword({
						email: "user@example.com",
						password: "password123456",
					})
				}
			>
				Login home
			</button>
			<button
				type="button"
				onClick={() => void auth.loginWithPassword({ email: "", password: "" })}
			>
				Empty login
			</button>
			<button type="button" onClick={() => void auth.logoutCurrentUser()}>
				Logout
			</button>
		</div>
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	routerMocks.navigate.mockClear();
});

describe("AuthProvider", () => {
	it("requires useAuth consumers to be inside the provider", () => {
		expect(() => renderWithProviders(<AuthProbe />)).toThrow(
			"AuthContext is missing.",
		);
	});

	it("runs the real login mutation, updates cache, navigates, and logs out", async () => {
		const user = {
			id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
			email: "user@example.com",
			displayName: "Test User",
			role: "member",
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ user }))
			.mockResolvedValueOnce(Response.json({ user }))
			.mockResolvedValueOnce(Response.json({ success: true }));
		vi.stubGlobal("fetch", fetchMock);
		const { queryClient, user: interaction } = renderWithProviders(
			<AuthProvider sessionCheckEnabled={false}>
				<AuthProbe />
			</AuthProvider>,
		);

		expect(screen.getByTestId("loading")).toHaveTextContent("false");
		await interaction.click(
			screen.getByRole("button", { name: "Empty login" }),
		);
		expect(fetchMock).not.toHaveBeenCalled();

		await interaction.click(screen.getByRole("button", { name: "Login" }));
		await waitFor(() =>
			expect(queryClient.getQueryData(authMeQueryKey)).toEqual(user),
		);
		expect(routerMocks.navigate).toHaveBeenCalledWith({ to: "/protected" });
		await interaction.click(screen.getByRole("button", { name: "Login home" }));
		await waitFor(() =>
			expect(routerMocks.navigate).toHaveBeenCalledWith({ to: "/" }),
		);

		await interaction.click(screen.getByRole("button", { name: "Logout" }));
		await waitFor(() =>
			expect(queryClient.getQueryData(authMeQueryKey)).toBeNull(),
		);
		expect(screen.getByTestId("error")).toHaveTextContent("none");
	});

	it("exposes pending state and reports mutation failures", async () => {
		let rejectRequest: ((reason?: unknown) => void) | undefined;
		const request = new Promise<Response>((_resolve, reject) => {
			rejectRequest = reject;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(() => request),
		);
		const { user } = renderWithProviders(
			<AuthProvider sessionCheckEnabled={false}>
				<AuthProbe />
			</AuthProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Login" }));
		await waitFor(() =>
			expect(screen.getByTestId("busy")).toHaveTextContent("true"),
		);

		act(() => rejectRequest?.(new Error("Login unavailable")));
		await waitFor(() =>
			expect(screen.getByTestId("error")).toHaveTextContent(
				"Login unavailable",
			),
		);
		expect(screen.getByTestId("busy")).toHaveTextContent("false");
	});

	it("uses the home redirect and fallback mutation error text", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue("offline"));
		const { user } = renderWithProviders(
			<AuthProvider sessionCheckEnabled={false}>
				<AuthProbe />
			</AuthProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Login home" }));
		await waitFor(() =>
			expect(screen.getByTestId("error")).toHaveTextContent("Login failed."),
		);
		expect(routerMocks.navigate).not.toHaveBeenCalled();
	});

	it("loads the current session and reacts to unauthorized notifications", async () => {
		const user = {
			id: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
			email: "session@example.com",
			displayName: "Session User",
			role: "member",
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user })));
		const { queryClient } = renderWithProviders(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);

		expect(screen.getByTestId("loading")).toHaveTextContent("true");
		await waitFor(() =>
			expect(screen.getByTestId("user")).toHaveTextContent(
				"session@example.com",
			),
		);

		act(() => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT_NAME)));
		expect(queryClient.getQueryData(authMeQueryKey)).toBeNull();
		expect(screen.getByTestId("error")).toHaveTextContent("Session expired.");
	});

	it("shows a non-authentication session error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: "Service unavailable" }), {
					status: 503,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);
		renderWithProviders(
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>,
		);

		await waitFor(() =>
			expect(screen.getByTestId("error")).toHaveTextContent(
				"Service unavailable",
			),
		);
	});
});
