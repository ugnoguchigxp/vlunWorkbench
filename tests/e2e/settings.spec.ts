import { expect, test } from "./test";

const admin = {
	email: "admin-e2e@example.com",
	password: "E2eAdminPassword!42",
};

test("settings restores an admin category from the URL and exposes one panel", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByLabel("Email").fill(admin.email);
	await page.getByLabel("Password").fill(admin.password);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
	await page.goto("/settings?section=ai-models");
	await expect(page.getByRole("heading", { name: "AI・モデル" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "タスクルーティング" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: /System Context/ })).toHaveCount(0);
	await page.getByLabel("設定を検索").fill("Docker");
	await expect(
		page.locator(".settings-search-results").getByRole("link", {
			name: "スキャン実行",
		}),
	).toBeVisible();
});
