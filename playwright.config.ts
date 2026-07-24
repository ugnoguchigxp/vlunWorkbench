import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 32_983;
const baseURL = `http://127.0.0.1:${port}`;
const e2eRoot = path.resolve(".tmp/e2e");

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: false,
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 8_000 },
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command:
			"bun run tests/e2e/setup-fixture.ts && bun run build && exec bun run start",
		url: `${baseURL}/api/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...process.env,
			NODE_ENV: "production",
			HOST: "127.0.0.1",
			PORT: String(port),
			APP_URL: baseURL,
			CORS_ORIGINS: baseURL,
			DATABASE_URL: path.join(e2eRoot, `vuln-workbench-${process.pid}.sqlite`),
			SQLITE_WRITER_SOCKET: path.join(e2eRoot, `writer-${process.pid}.sock`),
			CONTENT_ROOT: path.join(e2eRoot, "content"),
			PROJECT_ALLOWED_ROOTS: path.join(e2eRoot, "projects"),
			JWT_SECRET: "e2e-only-jwt-secret-that-is-at-least-32-characters",
			LLM_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
			SEED_ADMIN_PASSWORD: "E2eAdminPassword!42",
			AUTH_COOKIE_SECURE: "false",
			SECURITY_HEADERS_MODE: "http",
			CSP_MODE: "enforce",
			TRUST_PROXY: "false",
			ALLOW_HOST_SCANNER_EXECUTION: "false",
		},
	},
});
