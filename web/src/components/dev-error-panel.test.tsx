import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevErrorPanel } from "./dev-error-panel";

afterEach(() => {
	window.history.replaceState({}, "", "/");
	vi.restoreAllMocks();
});

describe("DevErrorPanel", () => {
	it("shows application diagnostics, copies both formats, and retries", async () => {
		window.history.replaceState({}, "", "/showcase?page=2");
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const reset = vi.fn();
		const error = new Error("Render exploded");
		error.stack = [
			"Error: Render exploded",
			"    at Showcase (http://localhost:3000/web/src/views/showcase-view.tsx?x=1:42:7)",
			"    at Showcase (http://localhost:3000/web/src/views/showcase-view.tsx?x=1:42:7)",
			"    at apiHandler (/api/routes/example.ts:12:2)",
		].join("\n");

		render(
			<DevErrorPanel
				error={error}
				info={{ componentStack: "\n    at ShowcaseView\n    at App" }}
				reset={reset}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Render exploded" }),
		).toBeVisible();
		expect(
			screen.getByRole("heading", { name: "Suspect app frames" }),
		).toBeVisible();
		expect(screen.getByText("web/src/routes/showcase-route.tsx")).toBeVisible();
		expect(screen.getByText("Full React component stack")).toBeVisible();

		fireEvent.click(screen.getByRole("button", { name: "Copy AI context" }));
		await waitFor(() =>
			expect(screen.getByText("AI context copied")).toBeVisible(),
		);
		expect(writeText.mock.calls[0]?.[0]).toContain("## Suspect app frames");

		fireEvent.click(
			screen.getByRole("button", { name: "Copy full error details" }),
		);
		await waitFor(() =>
			expect(screen.getByText("Full stack copied")).toBeVisible(),
		);
		expect(writeText.mock.calls[1]?.[0]).toContain("Stack trace:");

		fireEvent.click(screen.getByRole("button", { name: "Retry render" }));
		expect(reset).toHaveBeenCalledOnce();
	});

	it("uses top frames and login route hints for non-app errors", () => {
		window.history.replaceState({}, "", "/login");
		const error = new Error("Dependency failed");
		error.stack = [
			"Error: Dependency failed",
			"    at external (http://localhost:3000/node_modules/pkg/index.js:4:2)",
			"    at caller (http://localhost:3000/vendor.js:8:1)",
		].join("\n");

		render(<DevErrorPanel error={error} info={undefined} reset={vi.fn()} />);

		expect(
			screen.getByRole("heading", { name: "Top stack frames" }),
		).toBeVisible();
		expect(screen.getByText("web/src/routes/login-route.tsx")).toBeVisible();
		expect(
			screen.queryByText("Full React component stack"),
		).not.toBeInTheDocument();
	});

	it("supports string thrown values and the legacy clipboard fallback", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: undefined,
		});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});

		render(
			<DevErrorPanel
				error={"string failure" as unknown as Error}
				info={undefined}
				reset={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Copy AI context" }));

		await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
		expect(screen.getByText("AI context copied")).toBeVisible();
		expect(document.querySelector("textarea")).not.toBeInTheDocument();
	});

	it("reports clipboard failures and formats non-Error objects", async () => {
		window.history.replaceState({}, "", "/protected");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
		});

		render(
			<DevErrorPanel
				error={{ reason: "bad value" } as unknown as Error}
				info={undefined}
				reset={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Copy AI context" }));

		await waitFor(() => expect(screen.getByText("Copy failed")).toBeVisible());
		expect(screen.getByText("A non-Error value was thrown.")).toBeVisible();
		expect(screen.getByText("web/src/routes/root-route.tsx")).toBeVisible();
	});

	it("falls back when Error fields and serialized thrown values are empty", () => {
		const emptyError = new Error("");
		Object.defineProperties(emptyError, {
			name: { value: "", configurable: true },
			stack: { value: "", configurable: true },
		});
		const first = render(
			<DevErrorPanel error={emptyError} info={undefined} reset={vi.fn()} />,
		);
		expect(
			screen.getByRole("heading", { name: "Unknown error" }),
		).toBeVisible();
		expect(screen.getByText("Error", { selector: "strong" })).toBeVisible();
		first.unmount();

		render(
			<DevErrorPanel
				error={undefined as unknown as Error}
				info={undefined}
				reset={vi.fn()}
			/>,
		);
		expect(
			screen.getByText("undefined", { selector: "pre" }),
		).toBeInTheDocument();
	});
});
