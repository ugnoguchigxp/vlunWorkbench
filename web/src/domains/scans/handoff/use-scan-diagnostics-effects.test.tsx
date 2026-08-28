/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanReview, ScanRun } from "../../../api";
import * as scansApi from "../../../api";
import {
	IMPROVEMENT_REQUEST_POLL_INTERVAL_MS,
	IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS,
	useScanDiagnosticsEffects,
} from "./use-scan-diagnostics-effects";

vi.mock("../../../api", () => ({
	fetchAutomatedScanDiagnostics: vi.fn(),
	fetchScanAttackSurface: vi.fn(),
	fetchScanDiagnosticReports: vi.fn(),
	fetchScanReports: vi.fn(),
	fetchScanReviews: vi.fn(),
	fetchScanSecurityChecks: vi.fn(),
}));

const now = "2026-08-25T10:00:00.000Z";
const scanRun: ScanRun = {
	id: "scan-1",
	projectId: "project-1",
	profile: "source-assurance",
	status: "completed",
	startedAt: now,
	completedAt: now,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: now,
	updatedAt: now,
};
const runningReview: ScanReview = {
	id: "improvement-review-1",
	scanRunId: scanRun.id,
	projectId: scanRun.projectId,
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
const completedReview: ScanReview = {
	...runningReview,
	status: "completed",
	completedAt: now,
};

type DiagnosticsScope = Parameters<typeof useScanDiagnosticsEffects>[0];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createScope(overrides: Partial<DiagnosticsScope> = {}) {
	return {
		active: true,
		attackSurfaceItems: [],
		automatedDiagnosticLoading: false,
		automatedDiagnostics: [],
		diagnosticLoading: false,
		diagnosticReports: [],
		improvementRequestLoading: false,
		scanReviewFindingFilter: "all",
		scanReviewLoading: false,
		scanReviews: [runningReview],
		scanRuns: [scanRun],
		securityCheckResults: [],
		selectedScanRunId: scanRun.id,
		setAttackSurfaceItems: vi.fn(),
		setAutomatedDiagnosticLoading: vi.fn(),
		setAutomatedDiagnostics: vi.fn(),
		setDiagnosticLoading: vi.fn(),
		setDiagnosticReports: vi.fn(),
		setErrorText: vi.fn(),
		setImprovementRequestLoading: vi.fn(),
		setReports: vi.fn(),
		setScanReviewFindingFilter: vi.fn(),
		setScanReviewLoading: vi.fn(),
		setScanReviews: vi.fn(),
		setSecurityCheckResults: vi.fn(),
		setSelectedReport: vi.fn(),
		...overrides,
	} satisfies DiagnosticsScope;
}

function Harness({ scope }: { scope: DiagnosticsScope }) {
	useScanDiagnosticsEffects(scope);
	return null;
}

async function render(scope: DiagnosticsScope): Promise<Root> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(<Harness scope={scope} />);
		await Promise.resolve();
		await Promise.resolve();
	});
	return root;
}

async function unmount(root: Root) {
	await act(async () => root.unmount());
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(now));
	vi.mocked(scansApi.fetchAutomatedScanDiagnostics).mockResolvedValue([]);
	vi.mocked(scansApi.fetchScanAttackSurface).mockResolvedValue({ items: [] });
	vi.mocked(scansApi.fetchScanDiagnosticReports).mockResolvedValue({
		reports: [],
	});
	vi.mocked(scansApi.fetchScanReports).mockResolvedValue([]);
	vi.mocked(scansApi.fetchScanReviews).mockResolvedValue([runningReview]);
	vi.mocked(scansApi.fetchScanSecurityChecks).mockResolvedValue({
		results: [],
	});
});

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("improvement request polling", () => {
	it("uses a fixed thirty-second interval with a thirty-minute deadline", () => {
		expect(IMPROVEMENT_REQUEST_POLL_INTERVAL_MS).toBe(30_000);
		expect(IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS).toBe(30 * 60_000);
	});

	it("stops after the watched review reaches a terminal state", async () => {
		vi.mocked(scansApi.fetchScanReviews)
			.mockResolvedValueOnce([runningReview])
			.mockResolvedValueOnce([completedReview]);
		const scope = createScope();
		const root = await render(scope);

		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(IMPROVEMENT_REQUEST_POLL_INTERVAL_MS);
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);
		expect(scope.setScanReviews).toHaveBeenLastCalledWith([completedReview]);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);

		await unmount(root);
	});

	it("pauses while the document is hidden and refreshes when visible", async () => {
		let visibilityState: DocumentVisibilityState = "visible";
		const visibilitySpy = vi
			.spyOn(document, "visibilityState", "get")
			.mockImplementation(() => visibilityState);
		const root = await render(createScope());

		visibilityState = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(1);

		visibilityState = "visible";
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
			await Promise.resolve();
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);

		visibilitySpy.mockRestore();
		await unmount(root);
	});

	it("never overlaps a pending review request", async () => {
		const pending = deferred<ScanReview[]>();
		vi.mocked(scansApi.fetchScanReviews)
			.mockResolvedValueOnce([runningReview])
			.mockReturnValueOnce(pending.promise);
		const root = await render(createScope());

		await act(async () => {
			vi.advanceTimersByTime(IMPROVEMENT_REQUEST_POLL_INTERVAL_MS);
			await Promise.resolve();
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);

		await act(async () => {
			pending.resolve([completedReview]);
			await Promise.resolve();
		});
		await unmount(root);
	});

	it("stops permanently at the polling deadline", async () => {
		const scope = createScope();
		const root = await render(scope);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(
				IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS + 30_000,
			);
		});
		expect(scope.setErrorText).toHaveBeenCalledWith(
			"改修依頼指示書の状態確認を30分で停止しました。画面を再読み込みして生成状態を確認してください。",
		);
		const requestCountAtDeadline = vi.mocked(scansApi.fetchScanReviews).mock
			.calls.length;
		expect(requestCountAtDeadline).toBeLessThanOrEqual(61);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(5 * 60_000);
		});
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(
			requestCountAtDeadline,
		);

		await unmount(root);
	});

	it("aborts an in-flight request and does not update after unmount", async () => {
		const pending = deferred<ScanReview[]>();
		vi.mocked(scansApi.fetchScanReviews)
			.mockResolvedValueOnce([runningReview])
			.mockReturnValueOnce(pending.promise);
		const scope = createScope();
		const root = await render(scope);

		await act(async () => {
			vi.advanceTimersByTime(IMPROVEMENT_REQUEST_POLL_INTERVAL_MS);
			await Promise.resolve();
		});
		const signal = vi.mocked(scansApi.fetchScanReviews).mock.calls[1]?.[1];
		expect(signal?.aborted).toBe(false);
		const updateCountBeforeUnmount = vi.mocked(scope.setScanReviews).mock.calls
			.length;

		await unmount(root);
		expect(signal?.aborted).toBe(true);
		await act(async () => {
			pending.resolve([completedReview]);
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(scope.setScanReviews).toHaveBeenCalledTimes(
			updateCountBeforeUnmount,
		);
		expect(scansApi.fetchScanReviews).toHaveBeenCalledTimes(2);
	});
});
