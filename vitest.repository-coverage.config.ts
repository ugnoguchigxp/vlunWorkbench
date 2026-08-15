import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["web/**/*.test.ts", "shared/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["lcov"],
			include: ["web/src/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"],
			exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
		},
	},
});
