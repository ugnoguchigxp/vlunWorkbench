import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../../api";
import type { ScansActionScope } from "./scans-action-scope";
import { buildScanWorkspaceActions } from "./scans-workspace-actions";

vi.mock("../../../api", async () => {
	const actual = await vi.importActual<typeof import("../../../api")>(
		"../../../api",
	);
	return {
		...actual,
		fetchScans: vi.fn(),
		preflightScan: vi.fn(),
		startScan: vi.fn(),
		triggerProjectDynamicRun: vi.fn(),
	};
});

function baseScope(
	overrides: Record<string, unknown> = {},
): ScansActionScope {
	return {
		buildSelectedScanTarget: () => ({ kind: "full" }),
		continueOnToolFailure: true,
		diffPreview: null,
		diffPreviewCurrent: false,
		isScanning: false,
		projects: [
			{ id: "project-1", pathPolicy: { status: "allowed" } },
		],
		releaseInputKind: "filesystem",
		scanProjectCodeExecutionConsent: false,
		selectedProfileId: "source-assurance",
		selectedProjectId: "project-1",
		setDestructiveScanConsent: vi.fn(),
		setDiffPreview: vi.fn(),
		setDiffPreviewResolvedInputKey: vi.fn(),
		setErrorText: vi.fn(),
		setIsScanning: vi.fn(),
		setScanDetailTab: vi.fn(),
		setScanListTab: vi.fn(),
		setScanProjectCodeExecutionConsent: vi.fn(),
		setScanRuns: vi.fn(),
		setSelectedFindingDetails: vi.fn(),
		setSelectedFindingId: vi.fn(),
		setSelectedScanRunId: vi.fn(),
		setShowRunScanForm: vi.fn(),
		...overrides,
	} as unknown as ScansActionScope;
}

describe("scan workspace timeout policy", () => {
	beforeEach(() => {
		vi.mocked(api.fetchScans).mockReset().mockResolvedValue([]);
		vi.mocked(api.preflightScan).mockReset();
		vi.mocked(api.startScan).mockReset();
		vi.mocked(api.triggerProjectDynamicRun).mockReset();
	});

	it("lets a saved dynamic profile choose its timeout", async () => {
		vi.mocked(api.triggerProjectDynamicRun).mockResolvedValue({
			scanRunId: "dynamic-scan-1",
		});
		const actions = buildScanWorkspaceActions(
			baseScope({
				scanProjectCodeExecutionConsent: true,
				selectedProfileId: "dynamic-verification",
				selectedProjectDynamicProfileId: "bun-test",
			}),
		);

		await actions.handleStartScanProfile();

		expect(api.triggerProjectDynamicRun).toHaveBeenCalledOnce();
		const request = vi.mocked(api.triggerProjectDynamicRun).mock.calls[0]?.[1];
		expect(request).not.toHaveProperty("timeoutSec");
	});

	it("lets an execution profile choose each normal scan step timeout", async () => {
		vi.mocked(api.preflightScan).mockResolvedValue({
			mode: "enforced",
			status: "ready",
			bindingHash: `sha256:${"a".repeat(64)}`,
			executionPlan: { planHash: `sha256:${"b".repeat(64)}` },
			profileResolution: { catalogEntryHash: `sha256:${"c".repeat(64)}` },
		} as Awaited<ReturnType<typeof api.preflightScan>>);
		vi.mocked(api.startScan).mockResolvedValue({
			scan: { id: "source-scan-1", status: "queued", profile: "source-assurance" },
			profileOutcome: "pending",
			toolResults: [],
		});
		const actions = buildScanWorkspaceActions(baseScope());

		await actions.handleStartScanProfile();

		expect(api.startScan).toHaveBeenCalledOnce();
		const request = vi.mocked(api.startScan).mock.calls[0]?.[1];
		expect(request).not.toHaveProperty("timeoutSec");
	});
});
