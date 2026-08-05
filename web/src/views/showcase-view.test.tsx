import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowcaseSettingsProvider } from "../showcase-settings-context";
import { renderWithProviders } from "../../test/render-with-providers";
import { ShowcaseView } from "./showcase-view";

const routerMocks = vi.hoisted(() => ({
	search: {
		page: 2,
		pageSize: 10,
		sortBy: undefined as "component" | "category" | "status" | undefined,
		sortDir: undefined as "asc" | "desc" | undefined,
	},
	navigate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => routerMocks.navigate,
	useSearch: () => routerMocks.search,
}));

const showcase = () => (
	<ShowcaseSettingsProvider>
		<ShowcaseView />
	</ShowcaseSettingsProvider>
);

beforeEach(() => {
	window.localStorage.clear();
	routerMocks.search.page = 2;
	routerMocks.search.pageSize = 10;
	routerMocks.search.sortBy = undefined;
	routerMocks.search.sortDir = undefined;
	routerMocks.navigate.mockClear();
	Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
	Object.defineProperty(window, "scrollY", { configurable: true, value: 34 });
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		writable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "scrollTo", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	vi.useRealTimers();
	window.localStorage.clear();
});

describe("ShowcaseView", () => {
	it("renders the inventory and exercises appearance and form controls", async () => {
		const { user } = renderWithProviders(showcase());

		expect(
			screen.getByRole("heading", { name: "Component Showcase" }),
		).toBeVisible();
		expect(screen.getAllByText("35 components").length).toBeGreaterThan(0);

		await user.selectOptions(screen.getByLabelText("Theme Color"), "indigo");
		for (const name of [
			"Emerald",
			"Rose",
			"Amber",
			"Tokyo Night",
			"Campfire",
			"Terminal",
		]) {
			await user.click(screen.getByRole("button", { name }));
		}
		for (const name of ["Compact", "Comfortable", "Spacious"]) {
			await user.click(screen.getByRole("button", { name }));
		}
		for (const name of ["Sharp", "Soft", "Round"]) {
			await user.click(screen.getByRole("button", { name }));
		}
		for (const name of ["Small", "Medium", "Large"]) {
			await user.click(screen.getByRole("button", { name }));
		}
		await user.click(screen.getByRole("button", { name: "Reset" }));

		await user.click(screen.getByRole("button", { name: "Simulate Progress" }));
		expect(screen.getByText("43%")).toBeVisible();
		await user.selectOptions(screen.getByLabelText("Framework"), "Astro");
		expect(screen.getByLabelText("Framework")).toHaveValue("Astro");
		await user.click(screen.getByRole("checkbox", { name: "Checkbox" }));
		await user.click(screen.getByRole("checkbox", { name: "Switch" }));
		await user.click(screen.getByRole("radio", { name: "Starter" }));
		await user.click(screen.getByRole("radio", { name: "Enterprise" }));
	}, 10_000);

	it("exercises disclosure, overlay, and local navigation interactions", async () => {
		const { user } = renderWithProviders(showcase());

		await user.click(screen.getByRole("tab", { name: "Password" }));
		expect(
			screen.getByRole("heading", { name: "Password Security" }),
		).toBeVisible();
		await user.click(screen.getByRole("tab", { name: "Settings" }));
		expect(
			screen.getByRole("heading", { name: "Global Settings" }),
		).toBeVisible();
		await user.click(screen.getByRole("tab", { name: "Account" }));

		await user.click(screen.getByRole("button", { name: "Design Tokens" }));
		expect(
			screen.queryByText("Color, radius, spacing, and typography primitives."),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Layout" }));
		expect(
			screen.getByText(
				"Cards, panels, sections, and dense application surfaces.",
			),
		).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Forms" }));
		expect(
			screen.getByText("Fields, selection controls, and validation states."),
		).toBeVisible();

		await user.click(screen.getByRole("button", { name: "Menu" }));
		expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Menu" }));

		const viewSwitcher = screen.getByRole("group", { name: "View switcher" });
		const viewButtons = within(viewSwitcher).getAllByRole("button");
		await user.click(viewButtons[1]);
		expect(viewButtons[1]).toHaveAttribute("aria-pressed", "true");
		await user.click(viewButtons[0]);

		const pagination = screen.getByRole("navigation", { name: "Pagination" });
		await user.click(within(pagination).getByRole("button", { name: "1" }));

		await user.click(screen.getByRole("button", { name: "Status" }));
		expect(screen.getByText("All checks are passing.")).toBeVisible();
		await user.click(screen.getByRole("button", { name: "Status" }));

		await user.click(screen.getByRole("button", { name: "Open Dialog" }));
		let dialog = screen.getByRole("dialog");
		await user.click(
			within(dialog).getByRole("button", { name: "Close dialog" }),
		);
		await user.click(screen.getByRole("button", { name: "Open Dialog" }));
		dialog = screen.getByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Open Dialog" }));
		dialog = screen.getByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "Deploy" }));

		await user.click(screen.getByRole("button", { name: "Open Panel" }));
		const drawer = screen.getByRole("complementary", {
			name: "Settings panel",
		});
		await user.click(
			within(drawer).getByRole("button", { name: "Close panel" }),
		);
	});

	it("updates table search, sorting, page size, and pagination", async () => {
		const { rerender, user } = renderWithProviders(showcase());
		const tablePagination = () =>
			screen.getByRole("navigation", { name: "Table pagination" });

		await user.selectOptions(screen.getByLabelText("Rows"), "20");
		await user.click(
			within(tablePagination()).getByRole("button", { name: "Previous" }),
		);
		await user.click(
			within(tablePagination()).getByRole("button", { name: "3" }),
		);
		await user.click(
			within(tablePagination()).getByRole("button", { name: "Next" }),
		);

		await user.click(screen.getByRole("button", { name: "Sort by Component" }));
		routerMocks.search.sortBy = "component";
		routerMocks.search.sortDir = "asc";
		rerender(showcase());
		await user.click(screen.getByRole("button", { name: "Sort by Component" }));
		routerMocks.search.sortDir = "desc";
		rerender(showcase());
		await user.click(screen.getByRole("button", { name: "Sort by Component" }));

		await waitFor(() => expect(routerMocks.navigate).toHaveBeenCalled());
		expect(window.scrollTo).toHaveBeenCalledWith(12, 34);
	}, 10_000);

	it("shows copied feedback and restores it after the timer", () => {
		let timeoutCallback: (() => void) | undefined;
		vi.spyOn(window, "setTimeout").mockImplementation((callback) => {
			timeoutCallback = callback as () => void;
			return {} as ReturnType<typeof setTimeout>;
		});
		renderWithProviders(showcase());

		fireEvent.click(screen.getByRole("button", { name: "Copy Report" }));
		expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
		act(() => timeoutCallback?.());
		expect(screen.getByRole("button", { name: "Copy Report" })).toBeVisible();
	});
});
