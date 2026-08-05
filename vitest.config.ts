import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "node",
					environment: "node",
					include: [
						"api/**/*.test.ts",
						"web/**/*.test.ts",
						"shared/**/*.test.ts",
						"scripts/**/*.test.ts",
					],
				},
			},
			{
				test: {
					name: "web",
					environment: "jsdom",
					include: ["web/**/*.test.tsx"],
					setupFiles: ["web/test/setup.ts"],
				},
			},
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["api/**/*.ts", "shared/**/*.ts", "web/src/**/*.{ts,tsx}"],
			exclude: [
				// Driver adapters and CLI entrypoints are variant-specific and covered by smoke/contract checks.
				"api/db/migrate.ts",
				"api/db/migrate-sqlite.ts",
				"api/db/schema.ts",
				"api/db/index.ts",
				"api/db/sqlite.ts",
				"api/app/server.ts",
				"api/cli/migrate.ts",
				"api/cli/auth-create-admin.ts",
				// Browser and route composition entrypoints are declarative wiring covered by Playwright smoke tests.
				"web/src/main.tsx",
				"web/src/App.tsx",
				"web/src/router.tsx",
				"web/src/routes/**/*.tsx",
			],
			thresholds: {
				lines: 95,
				functions: 95,
				branches: 95,
				statements: 95,
			},
		},
	},
});
