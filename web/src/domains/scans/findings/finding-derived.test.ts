import { describe, expect, it } from "vitest";
import type { Finding, FindingGroup, ScanRun } from "../../../api";
import {
	buildDisplayedFindings,
	buildEvidenceQualityByFindingId,
	buildFindingWorkStates,
	buildRemediationPlansByFindingId,
	buildVerificationByFindingId,
	selectBaselineScanRun,
} from "./finding-derived";

const now = "2026-08-21T00:00:00.000Z";

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "finding-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		sourceTool: "semgrep",
		ruleId: "rule-1",
		title: "Unsafe HTML",
		description: "Unsanitized HTML is rendered.",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: { path: "web/src/app.tsx", startLine: 12 },
		fingerprint: "fingerprint-1",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function scanRun(overrides: Partial<ScanRun> = {}): ScanRun {
	return {
		id: "scan-1",
		projectId: "project-1",
		profile: "baseline",
		status: "completed",
		startedAt: now,
		completedAt: now,
		createdByUserId: null,
		summary: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("buildVerificationByFindingId", () => {
	it("records verification only for the selected finding after data is loaded", () => {
		const empty = buildVerificationByFindingId({
			selectedVerificationDataLoaded: false,
			selectedFindingId: "finding-1",
			reproductionRuns: [{ id: "repro-1" } as never],
			dynamicRuns: [],
		});
		expect(empty.size).toBe(0);

		const loaded = buildVerificationByFindingId({
			selectedVerificationDataLoaded: true,
			selectedFindingId: "finding-1",
			reproductionRuns: [{ id: "repro-1" } as never],
			dynamicRuns: [],
		});
		expect(loaded.get("finding-1")?.reproductionRuns).toHaveLength(1);
	});
});

describe("buildFindingWorkStates", () => {
	it("derives a work state for every finding", () => {
		const findings = [finding(), finding({ id: "finding-2", title: "Other" })];
		const states = buildFindingWorkStates(findings, new Map());
		expect(states.size).toBe(2);
		expect(states.get("finding-1")).toBeDefined();
	});
});

describe("buildDisplayedFindings", () => {
	it("filters grouped findings to the selected group", () => {
		const findings = [
			finding(),
			finding({ id: "finding-2", title: "Other" }),
		];
		const scanGroups: FindingGroup[] = [
			{
				id: "group-1",
				groupKey: "xss",
				title: "XSS",
				description: "Grouped XSS findings",
				severity: "high",
				representativeFindingId: "finding-2",
				findingIds: ["finding-2"],
				sourceTools: ["semgrep"],
				primaryLocation: {},
				matchConfidence: "exact",
				reasonCodes: [],
				metadata: { strategy: "fingerprint", algorithmVersion: "1" },
			},
		];
		expect(
			buildDisplayedFindings({
				findings,
				findingsViewMode: "grouped",
				selectedGroupId: "group-1",
				scanGroups,
				findingWorkStatesById: new Map(),
			}).map((item) => item.id),
		).toEqual(["finding-2"]);
	});

	it("keeps all findings when grouped view has no selected group", () => {
		const findings = [finding(), finding({ id: "finding-2", title: "Other" })];
		expect(
			buildDisplayedFindings({
				findings,
				findingsViewMode: "grouped",
				selectedGroupId: "",
				scanGroups: [],
				findingWorkStatesById: new Map(),
			}).map((item) => item.id),
		).toEqual(["finding-1", "finding-2"]);
	});

	it("sorts the list view by work state then severity", () => {
		const findings = [
			finding({
				id: "low",
				title: "Low",
				severity: "low",
				updatedAt: "2026-08-21T01:00:00.000Z",
			}),
			finding({
				id: "high",
				title: "High",
				severity: "high",
				updatedAt: "2026-08-21T01:00:00.000Z",
			}),
		];
		const findingWorkStatesById = new Map([
			["low", "needs_review" as const],
			["high", "ready_for_report" as const],
		]);
		expect(
			buildDisplayedFindings({
				findings,
				findingsViewMode: "list",
				selectedGroupId: "",
				scanGroups: [],
				findingWorkStatesById,
			}).map((item) => item.id),
		).toEqual(["low", "high"]);
	});

	it("breaks list ties by recency then title", () => {
		const findings = [
			finding({
				id: "older-b",
				title: "B",
				severity: "high",
				updatedAt: "2026-08-21T01:00:00.000Z",
			}),
			finding({
				id: "newer",
				title: "A",
				severity: "high",
				updatedAt: "2026-08-21T02:00:00.000Z",
			}),
			finding({
				id: "older-a",
				title: "A",
				severity: "high",
				updatedAt: "2026-08-21T01:00:00.000Z",
			}),
			finding({
				id: "unknown",
				title: "Z",
				severity: "mystery" as Finding["severity"],
				updatedAt: "2026-08-21T03:00:00.000Z",
			}),
		];
		const findingWorkStatesById = new Map([
			["older-b", "needs_review" as const],
			["newer", "needs_review" as const],
			["older-a", "needs_review" as const],
			["unknown", "needs_review" as const],
		]);
		expect(
			buildDisplayedFindings({
				findings,
				findingsViewMode: "list",
				selectedGroupId: "",
				scanGroups: [],
				findingWorkStatesById,
			}).map((item) => item.id),
		).toEqual(["newer", "older-a", "older-b", "unknown"]);
	});
});

describe("selectBaselineScanRun", () => {
	it("returns the latest earlier run with the same profile", () => {
		const selected = scanRun({
			id: "scan-3",
			createdAt: "2026-08-21T12:00:00.000Z",
		});
		const runs = [
			scanRun({ id: "scan-1", createdAt: "2026-08-21T08:00:00.000Z" }),
			scanRun({ id: "scan-2", createdAt: "2026-08-21T10:00:00.000Z" }),
			selected,
			scanRun({
				id: "scan-other",
				profile: "deep",
				createdAt: "2026-08-21T11:00:00.000Z",
			}),
		];
		expect(selectBaselineScanRun(runs, selected)?.id).toBe("scan-2");
		expect(selectBaselineScanRun(runs, null)).toBeNull();
	});
});

describe("quality and remediation maps", () => {
	it("builds per-finding maps and uses selected details when present", () => {
		const selected = finding();
		const details = {
			finding: selected,
			evidence: [],
			latestReview: null,
			latestDecision: null,
		};
		const findings = [selected, finding({ id: "finding-2", title: "Other" })];
		const quality = buildEvidenceQualityByFindingId({
			findings,
			selectedFindingId: selected.id,
			selectedFindingDetails: details,
			verificationByFindingId: new Map(),
			diagnosticReports: [],
		});
		const plans = buildRemediationPlansByFindingId({
			findings,
			selectedFindingId: selected.id,
			selectedFindingDetails: details,
			verificationByFindingId: new Map(),
		});
		expect(quality.size).toBe(2);
		expect(plans.size).toBe(2);
		expect(quality.get(selected.id)).toBeDefined();
		expect(plans.get("finding-2")).toBeDefined();
	});
});
