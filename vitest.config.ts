import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["web/**/*.test.ts", "shared/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: [
				"web/src/agentic-markdown.ts",
				"web/src/domains/projects/*.ts",
				"web/src/domains/scans/*.ts",
				"shared/report-sections.ts",
			],
			exclude: [
				"**/*.test.ts",
				"**/*-controller.ts",
				// These modules were extracted from the already-excluded React controller.
				// Their browser orchestration is protected by Playwright, not unit coverage.
				"web/src/domains/scans/scans-controller-view-model.ts",
				"web/src/domains/scans/scans-finding-actions.ts",
				"web/src/domains/scans/scans-launch-actions.ts",
				"web/src/domains/scans/use-automated-diagnostic-state.ts",
				"web/src/domains/scans/use-finding-load-effects.ts",
				"web/src/domains/scans/use-scan-target-effects.ts",
				"web/src/domains/scans/use-scans-effects.ts",
				// Project Intelligence orchestration is covered by the dedicated Playwright flow.
				"web/src/domains/projects/use-intelligence-structure-data.ts",
			],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
});
