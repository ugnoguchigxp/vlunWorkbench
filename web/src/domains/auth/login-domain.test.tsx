import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render-with-providers";
import { LoginDomainSection } from "./login-domain";

describe("LoginDomainSection", () => {
	it("does not render while inactive", () => {
		const { container } = renderWithProviders(
			<LoginDomainSection active={false} busy={false} onLogin={vi.fn()} />,
		);

		expect(container).toBeEmptyDOMElement();
	});

	it("submits trimmed credentials and clears the password after success", async () => {
		const onLogin = vi.fn().mockResolvedValue(true);
		const { user } = renderWithProviders(
			<LoginDomainSection
				active
				busy={false}
				redirectTo="/protected"
				onLogin={onLogin}
			/>,
		);

		await user.type(screen.getByLabelText("Email"), "  user@example.com  ");
		await user.type(screen.getByLabelText("Password"), "password123456");
		await user.click(screen.getByRole("button", { name: /ログイン/ }));

		await waitFor(() =>
			expect(onLogin).toHaveBeenCalledWith({
				email: "user@example.com",
				password: "password123456",
				redirectTo: "/protected",
			}),
		);
		expect(screen.getByLabelText("Password")).toHaveValue("");
	});

	it("keeps form values after failure and disables submission while busy", async () => {
		const onLogin = vi.fn().mockResolvedValue(false);
		const { rerender, user } = renderWithProviders(
			<LoginDomainSection active busy={false} onLogin={onLogin} />,
		);

		await user.type(screen.getByLabelText("Email"), "user@example.com");
		await user.type(screen.getByLabelText("Password"), "secret");
		await user.click(screen.getByRole("button", { name: /ログイン/ }));

		await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
		expect(screen.getByLabelText("Email")).toHaveValue("user@example.com");
		expect(screen.getByLabelText("Password")).toHaveValue("secret");

		rerender(<LoginDomainSection active busy onLogin={onLogin} />);
		expect(screen.getByRole("button", { name: /ログイン/ })).toBeDisabled();
	});
});
