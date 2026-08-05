import { expect, test } from "@playwright/test";

test("public screens render", async ({ page }) => {
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Welcome to Hono Standard" }),
	).toBeVisible();

	await page.goto("/login");
	await expect(page.getByRole("heading", { name: "Hono Standard" })).toBeVisible();
	await expect(page.getByLabel("Email")).toBeVisible();
	await expect(page.getByLabel("Password")).toBeVisible();

	await page.goto("/showcase?page=1&pageSize=10");
	await expect(page.getByRole("heading", { name: "Component Showcase" })).toBeVisible();
});

test("login unlocks the protected route and logout clears the session", async ({
	page,
}) => {
	await page.goto("/protected");
	await expect(page.getByRole("heading", { name: "Login required" })).toBeVisible();

	await page.getByRole("main").getByRole("link", { name: "Login" }).click();
	await expect(page).toHaveURL(/\/login\?redirect=%2Fprotected/);

	await page.getByLabel("Email").fill("admin@example.com");
	await page.getByLabel("Password").fill("password123456");
	await page.getByRole("button", { name: /ログイン/ }).click();

	await expect(page).toHaveURL(/\/protected$/);
	await expect(page.getByRole("heading", { name: "Protected route" })).toBeVisible();
	await expect(page.getByText("Server confirmed admin@example.com as admin.")).toBeVisible();

	await page.getByRole("button", { name: "Logout" }).click();
	await expect(page.getByRole("heading", { name: "Login required" })).toBeVisible();
});
