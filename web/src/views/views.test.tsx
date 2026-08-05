import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render-with-providers";
import { HomeView } from "./home-view";
import { LoginView } from "./login-view";
import { ProtectedView } from "./protected-view";

const mocks = vi.hoisted(() => ({
	auth: {
		authUser: null as null | {
			email: string;
			displayName: string;
			role: string;
		},
		authLoading: false,
		busy: false,
		loginWithPassword: vi.fn(),
	},
	profile: {
		data: undefined as undefined | { email: string; role: string },
		error: null as null | Error,
	},
	search: { redirect: "/protected" as string | undefined },
}));

vi.mock("../auth-context", () => ({
	useAuth: () => mocks.auth,
}));

vi.mock("../api", () => ({
	useProtectedProfileQuery: vi.fn(() => mocks.profile),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useSearch: () => mocks.search,
}));

beforeEach(() => {
	mocks.auth.authUser = null;
	mocks.auth.authLoading = false;
	mocks.auth.busy = false;
	mocks.profile.data = undefined;
	mocks.profile.error = null;
});

describe("Web views", () => {
	it("renders the home view", () => {
		renderWithProviders(<HomeView />);
		expect(
			screen.getByRole("heading", { name: "Welcome to Hono Standard" }),
		).toBeVisible();
	});

	it("renders every login state", () => {
		mocks.auth.authLoading = true;
		const { rerender } = renderWithProviders(<LoginView />);
		expect(screen.getByText("Loading session...")).toBeVisible();

		mocks.auth.authLoading = false;
		mocks.auth.authUser = {
			email: "user@example.com",
			displayName: "Test User",
			role: "member",
		};
		rerender(<LoginView />);
		expect(screen.getByRole("heading", { name: "Signed in" })).toBeVisible();
		expect(screen.getByText("Test User (member)")).toBeVisible();

		mocks.auth.authUser = null;
		rerender(<LoginView />);
		expect(screen.getByLabelText("Email")).toBeVisible();
		expect(screen.getByLabelText("Password")).toBeVisible();
	});

	it("renders protected loading and anonymous states", () => {
		mocks.auth.authLoading = true;
		const { rerender } = renderWithProviders(<ProtectedView />);
		expect(screen.getByText("Checking session...")).toBeVisible();

		mocks.auth.authLoading = false;
		rerender(<ProtectedView />);
		expect(
			screen.getByRole("heading", { name: "Login required" }),
		).toBeVisible();
	});

	it("renders protected loading, error, and success profile states", () => {
		mocks.auth.authUser = {
			email: "user@example.com",
			displayName: "Test User",
			role: "member",
		};
		const { rerender } = renderWithProviders(<ProtectedView />);
		expect(screen.getByText("Server profile is loading.")).toBeVisible();

		mocks.profile.error = new Error("Unavailable");
		rerender(<ProtectedView />);
		expect(screen.getByText("Server profile request failed.")).toBeVisible();

		mocks.profile.error = null;
		mocks.profile.data = { email: "user@example.com", role: "member" };
		rerender(<ProtectedView />);
		expect(
			screen.getByText("Server confirmed user@example.com as member."),
		).toBeVisible();
	});
});
