import { defineConfig } from "vitest/config";
import { nodeVitestFiles } from "./scripts/test-files";

export default defineConfig({
	test: {
		include: [
			"web/**/*.test.{ts,tsx}",
			"shared/**/*.test.{ts,tsx}",
			...nodeVitestFiles,
		],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: [
				"web/src/agentic-markdown.ts",
				"web/src/domains/projects/*.ts",
				"web/src/domains/scans/*.ts",
				"web/src/domains/scans/coverage/*.ts",
				"web/src/domains/scans/findings/*.ts",
				"web/src/domains/scans/reporting/*.ts",
				"web/src/domains/scans/handoff/*.ts",
				"web/src/domains/scans/workspace/*.ts",
				"shared/report-sections.ts",
			],
			exclude: [
				"**/*.test.{ts,tsx}",
				"**/*.tsx",
				"**/*-controller.ts",
				// These modules were extracted from the already-excluded React controller.
				// Their browser orchestration is protected by Playwright, not unit coverage.
				"web/src/domains/scans/scans-controller-view-model.ts",
				"web/src/domains/scans/scans-finding-actions.ts",
				"web/src/domains/scans/findings/scans-finding-actions.ts",
				"web/src/domains/scans/scans-launch-actions.ts",
				"web/src/domains/scans/workspace/scans-workspace-actions.ts",
				"web/src/domains/scans/reporting/scans-reporting-actions.ts",
				"web/src/domains/scans/handoff/scans-handoff-actions.ts",
				"web/src/domains/scans/use-automated-diagnostic-state.ts",
				"web/src/domains/scans/use-finding-load-effects.ts",
				"web/src/domains/scans/use-scan-target-effects.ts",
				"web/src/domains/scans/use-scans-effects.ts",
				"web/src/domains/scans/findings/use-finding-load-effects.ts",
				"web/src/domains/scans/findings/use-scan-findings-derived.ts",
				"web/src/domains/scans/findings/use-scan-findings-effects.ts",
				"web/src/domains/scans/findings/use-scan-findings-state.ts",
				"web/src/domains/scans/handoff/use-scan-diagnostics-effects.ts",
				"web/src/domains/scans/handoff/use-scan-diagnostics-state.ts",
				"web/src/domains/scans/reporting/use-scan-reports-effects.ts",
				"web/src/domains/scans/reporting/use-scan-reports-state.ts",
				"web/src/domains/scans/workspace/use-scan-launch-effects.ts",
				"web/src/domains/scans/workspace/use-scan-launch-state.ts",
				// React context/view helpers are classified as unmeasured and exercised
				// through browser flows, not the selected pure-model unit threshold.
				"web/src/domains/scans/scans-context.tsx",
				"web/src/domains/scans/scans-utils.tsx",
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
