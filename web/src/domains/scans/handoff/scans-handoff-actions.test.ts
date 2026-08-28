import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanReview } from "../../../api";
import * as api from "../../../api";
import type { ScansActionScope } from "../workspace/scans-action-scope";
import { buildScanHandoffActions } from "./scans-handoff-actions";

vi.mock("../../../api", async () => {
	const actual = await vi.importActual<typeof import("../../../api")>(
		"../../../api",
	);
	return {
		...actual,
		fetchScanReviews: vi.fn(),
		triggerScanImprovementRequest: vi.fn(),
	};
});

const now = "2026-08-25T10:00:00.000Z";
const runningReview: ScanReview = {
	id: "improvement-review-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	provider: "configured",
	model: "test-model",
	status: "running",
	summary: null,
	riskOverview: null,
	priorityNotes: [],
	coverageNotes: [],
	falsePositiveHotspots: [],
	recommendedNextActions: [],
	findingTriageHints: [],
	confidenceNotes: [],
	inputBundle: { generationKind: "improvement_request" },
	errorMessage: null,
	createdAt: now,
	startedAt: now,
	completedAt: null,
	updatedAt: now,
};

function createScope() {
	const setImprovementRequestLoading = vi.fn();
	const setScanReviews = vi.fn();
	const setErrorText = vi.fn();
	const scope = {
		scanReviewFindingFilter: "all",
		selectedScanRunId: runningReview.scanRunId,
		setAttackSurfaceItems: vi.fn(),
		setAutomatedDiagnosticLoading: vi.fn(),
		setAutomatedDiagnostics: vi.fn(),
		setDiagnosticLoading: vi.fn(),
		setDiagnosticReports: vi.fn(),
		setErrorText,
		setImprovementRequestLoading,
		setReports: vi.fn(),
		setScanDetailTab: vi.fn(),
		setScanReviewLoading: vi.fn(),
		setScanReviews,
		setSecurityCheckResults: vi.fn(),
		setSelectedReport: vi.fn(),
	} as unknown as ScansActionScope;
	return {
		scope,
		setErrorText,
		setImprovementRequestLoading,
		setScanReviews,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("improvement request action", () => {
	it("uses the POST response without starting a second review polling loop", async () => {
		vi.mocked(api.triggerScanImprovementRequest).mockResolvedValue({
			review: runningReview,
			result: {
				ok: true,
				reviewId: runningReview.id,
				status: "running",
			},
		});
		const {
			scope,
			setErrorText,
			setImprovementRequestLoading,
			setScanReviews,
		} = createScope();

		await buildScanHandoffActions(scope).handleGenerateImprovementRequest();

		expect(api.triggerScanImprovementRequest).toHaveBeenCalledOnce();
		expect(api.fetchScanReviews).not.toHaveBeenCalled();
		expect(setImprovementRequestLoading.mock.calls).toEqual([[true], [false]]);
		expect(setErrorText).toHaveBeenCalledWith(null);

		const update = setScanReviews.mock.calls[0]?.[0] as (
			current: ScanReview[],
		) => ScanReview[];
		const olderReview = { ...runningReview, id: "older-review" };
		expect(update([olderReview, runningReview])).toEqual([
			runningReview,
			olderReview,
		]);
	});
});
