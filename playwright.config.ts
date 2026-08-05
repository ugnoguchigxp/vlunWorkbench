import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	fullyParallel: false,
	retries: 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://127.0.0.1:5174",
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "bun scripts/e2e-server.ts",
		url: "http://127.0.0.1:5174",
		reuseExistingServer: false,
		timeout: 60_000,
	},
});
