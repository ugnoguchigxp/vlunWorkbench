/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, ScanEvent, ScanRun, ScanRunSummary } from "../../../api";
import * as scansApi from "../../../api";
import {
	latestFindingResultEventSeq,
	latestSummaryResultEventSeq,
	TERMINAL_RESULT_RETRY_DELAY_MS,
	useSelectedScanResultRefresh,
} from "./use-selected-scan-result-refresh";

vi.mock("../../../api", () => ({
	fetchScan: vi.fn(),
	fetchScanEvents: vi.fn(),
	fetchScanFindings: vi.fn(),
	fetchScanReports: vi.fn(),
	fetchScanReviews: vi.fn(),
	fetchScanSummary: vi.fn(),
	fetchScans: vi.fn(),
}));

const now = "2026-08-21T10:00:00.000Z";
const scanRun: ScanRun = {
	id: "scan-1",
	projectId: "project-1",
	profile: "baseline",
	status: "running",
	startedAt: now,
	completedAt: null,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: now,
	updatedAt: now,
};
const collectionEvent: ScanEvent = {
	id: "event-4",
	scanRunId: scanRun.id,
	seq: 4,
	level: "info",
	eventType: "finding.created",
	message: "Finding created",
	data: { findingId: "finding-1" },
	createdAt: now,
};
const findings: Finding[] = [
	{
		id: "finding-1",
		scanRunId: scanRun.id,
		projectId: scanRun.projectId,
		sourceTool: "osv",
		ruleId: "GHSA-example",
		title: "Collected finding",
		description: "Collected while the scan is running.",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: null,
		fingerprint: "fingerprint-1",
		metadata: {},
		createdAt: now,
		updatedAt: now,
	},
];
const summary: ScanRunSummary = {
	scanRunId: scanRun.id,
	profileId: scanRun.profile,
	profileOutcome: "running",
	tools: [],
	totals: {
		findingCount: findings.length,
		artifactCount: 0,
		reviewedFindingCount: 0,
		decidedFindingCount: 0,
	},
};

type RefreshScope = Parameters<typeof useSelectedScanResultRefresh>[0];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createScope(
	selectedPollingStatus: RefreshScope["selectedPollingStatus"],
) {
	return {
		active: true,
		selectedPollingStatus,
		selectedProjectId: scanRun.projectId,
		selectedScanRunId: scanRun.id,
		setErrorText: vi.fn(),
		setFindings: vi.fn(),
		setReports: vi.fn(),
		setScanEvents: vi.fn(),
		setScanReviews: vi.fn(),
		setScanRuns: vi.fn(),
		setScanSummary: vi.fn(),
	} satisfies RefreshScope;
}

function Harness({ scope }: { scope: RefreshScope }) {
	useSelectedScanResultRefresh(scope);
	return null;
}

async function render(scope: RefreshScope): Promise<Root> {
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
	vi.mocked(scansApi.fetchScan).mockResolvedValue(scanRun);
	vi.mocked(scansApi.fetchScanEvents).mockResolvedValue([collectionEvent]);
	vi.mocked(scansApi.fetchScanFindings).mockResolvedValue(findings);
	vi.mocked(scansApi.fetchScanSummary).mockResolvedValue(summary);
	vi.mocked(scansApi.fetchScanReviews).mockResolvedValue([]);
	vi.mocked(scansApi.fetchScanReports).mockResolvedValue([]);
	vi.mocked(scansApi.fetchScans).mockResolvedValue([scanRun]);
});

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("result collection event cursors", () => {
	const events = [
		{ eventType: "scan.step.started", seq: 2 },
		{ eventType: "finding.created", seq: 4 },
		{ eventType: "scan.step.finished", seq: 5 },
	];

	it("refreshes findings for creation and finished-step events", () => {
		expect(latestFindingResultEventSeq(events)).toBe(5);
	});

	it("refreshes the heavier summary only for a finished step", () => {
		expect(latestSummaryResultEventSeq(events.slice(0, 2))).toBe(0);
		expect(latestSummaryResultEventSeq(events)).toBe(5);
	});
});

describe("useSelectedScanResultRefresh", () => {
	it("keeps polling state when a queued scan becomes running", async () => {
		const scope = createScope("queued");
		const root = await render(scope);

		await act(async () => {
			root.render(
				<Harness scope={{ ...scope, selectedPollingStatus: "running" }} />,
			);
			await Promise.resolve();
		});
		expect(scansApi.fetchScan).toHaveBeenCalledTimes(1);

		await unmount(root);
	});

	it("refreshes collected findings during a running scan only for a new result event", async () => {
		const scope = createScope("running");
		const root = await render(scope);

		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(1);
		expect(scope.setFindings).toHaveBeenCalledWith(findings);
		expect(scansApi.fetchScanSummary).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(1_500);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(1);

		await unmount(root);
	});

	it("refreshes findings and summary when a scan step finishes", async () => {
		vi.mocked(scansApi.fetchScanEvents).mockResolvedValue([
			{ ...collectionEvent, eventType: "scan.step.finished" },
		]);
		const scope = createScope("running");
		const root = await render(scope);

		expect(scope.setFindings).toHaveBeenCalledWith(findings);
		expect(scope.setScanSummary).toHaveBeenCalledWith(summary);

		await unmount(root);
	});

	it("does not apply a late result from a previously selected scan", async () => {
		const firstFindings = deferred<Finding[]>();
		const secondFindings = findings.map((finding) => ({
			...finding,
			id: "finding-2",
			scanRunId: "scan-2",
		}));
		vi.mocked(scansApi.fetchScan).mockImplementation(async (scanRunId) => ({
			...scanRun,
			id: scanRunId,
		}));
		vi.mocked(scansApi.fetchScanEvents).mockImplementation(
			async (scanRunId) => [{ ...collectionEvent, scanRunId }],
		);
		vi.mocked(scansApi.fetchScanFindings).mockImplementation((scanRunId) =>
			scanRunId === scanRun.id
				? firstFindings.promise
				: Promise.resolve(secondFindings),
		);
		const scope = createScope("running");
		const root = await render(scope);

		await act(async () => {
			root.render(
				<Harness scope={{ ...scope, selectedScanRunId: "scan-2" }} />,
			);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scope.setFindings).toHaveBeenCalledWith(secondFindings);

		await act(async () => {
			firstFindings.resolve(findings);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scope.setFindings).toHaveBeenCalledTimes(1);

		await unmount(root);
	});

	it("retries findings for the same collected event when their request fails", async () => {
		vi.mocked(scansApi.fetchScanFindings)
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValue(findings);
		const scope = createScope("running");
		const root = await render(scope);

		expect(scope.setFindings).not.toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(1_500);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(2);
		expect(scansApi.fetchScanSummary).not.toHaveBeenCalled();
		expect(scope.setFindings).toHaveBeenCalledWith(findings);

		await unmount(root);
	});

	it("retries a failed summary without fetching successful findings again", async () => {
		vi.mocked(scansApi.fetchScanEvents).mockResolvedValue([
			{ ...collectionEvent, eventType: "scan.step.finished" },
		]);
		vi.mocked(scansApi.fetchScanSummary)
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValue(summary);
		const scope = createScope("running");
		const root = await render(scope);

		expect(scope.setFindings).toHaveBeenCalledWith(findings);
		expect(scope.setScanSummary).not.toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(1_500);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(1);
		expect(scansApi.fetchScanSummary).toHaveBeenCalledTimes(2);
		expect(scope.setScanSummary).toHaveBeenCalledWith(summary);

		await unmount(root);
	});

	it("leaves terminal result loading to the terminal refresh effect", async () => {
		vi.mocked(scansApi.fetchScan).mockResolvedValue({
			...scanRun,
			status: "completed",
			completedAt: now,
		});
		const scope = createScope("running");
		const root = await render(scope);

		expect(scansApi.fetchScanFindings).not.toHaveBeenCalled();
		expect(scope.setScanRuns).toHaveBeenCalledTimes(1);

		await unmount(root);
	});

	it("refreshes terminal results immediately and again after ten seconds", async () => {
		const scope = createScope("completed");
		const root = await render(scope);

		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(1);
		expect(scope.setFindings).toHaveBeenCalledWith(findings);

		await act(async () => {
			vi.advanceTimersByTime(TERMINAL_RESULT_RETRY_DELAY_MS);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scansApi.fetchScanFindings).toHaveBeenCalledTimes(2);
		expect(scope.setFindings).toHaveBeenCalledTimes(2);

		await unmount(root);
	});

	it("does not let a slow initial terminal response overwrite the retry", async () => {
		const initialFindings = deferred<Finding[]>();
		const retryFindings = findings.map((finding) => ({
			...finding,
			id: "finding-from-retry",
		}));
		vi.mocked(scansApi.fetchScanFindings)
			.mockReturnValueOnce(initialFindings.promise)
			.mockResolvedValue(retryFindings);
		const scope = createScope("completed");
		const root = await render(scope);

		await act(async () => {
			vi.advanceTimersByTime(TERMINAL_RESULT_RETRY_DELAY_MS);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scope.setFindings).toHaveBeenCalledWith(retryFindings);

		await act(async () => {
			initialFindings.resolve(findings);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(scope.setFindings).toHaveBeenCalledTimes(1);

		await unmount(root);
	});
});
