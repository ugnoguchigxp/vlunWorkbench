/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AssessmentEngagement,
	BusinessLogicScenarioSummary,
	DynamicProfileConfig,
	DynamicProfileTemplate,
} from "../../../api";
import * as api from "../../../api";
import { useSpecializedScanLaunch } from "./use-specialized-scan-launch";

vi.mock("../../../api", () => ({
	fetchBusinessLogicScenarios: vi.fn(),
	fetchProjectAssessments: vi.fn(),
	fetchProjectDynamicProfiles: vi.fn(),
}));

const now = "2026-09-13T00:00:00.000Z";
const config: DynamicProfileConfig = {
	id: "cfg-1",
	projectId: "project-1",
	profileId: "dynamic-test",
	dynamicKind: "test",
	displayName: "Dynamic",
	enabled: true,
	commandJson: ["true"],
	workingDirectory: ".",
	timeoutSec: 30,
	network: "none",
	memory: null,
	cpus: null,
	writableWorkdir: false,
	allowProjectScripts: false,
	expectedArtifactsJson: [],
	metadata: {},
	createdByUserId: null,
	createdAt: now,
	updatedAt: now,
};
const template: DynamicProfileTemplate = {
	id: "dynamic-test",
	displayName: "Dynamic",
	dynamicKind: "test",
	applicable: true,
};
const engagement: AssessmentEngagement = {
	id: "eng-1",
	projectId: "project-1",
	purpose: "internal",
	environment: "local",
	status: "active",
	scope: { origins: ["http://127.0.0.1:3000"], paths: ["/"], methods: ["GET"] },
	rulesOfEngagement: null,
	startsAt: now,
	expiresAt: now,
};
const scenario: BusinessLogicScenarioSummary = {
	id: "scn-1",
	controlId: "ASVS-1",
	planHash: "hash",
	createdAt: now,
};

let latest: ReturnType<typeof useSpecializedScanLaunch> | null = null;

function Harness(props: { active: boolean; selectedProjectId: string }) {
	latest = useSpecializedScanLaunch(props);
	return null;
}

async function render(props: {
	active: boolean;
	selectedProjectId: string;
}): Promise<Root> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(<Harness {...props} />);
		await Promise.resolve();
		await Promise.resolve();
	});
	return root;
}

afterEach(async () => {
	document.body.replaceChildren();
	latest = null;
	vi.clearAllMocks();
});

describe("useSpecializedScanLaunch", () => {
	beforeEach(() => {
		vi.mocked(api.fetchProjectDynamicProfiles).mockResolvedValue({
			configs: [config, { ...config, id: "cfg-off", enabled: false }],
			templates: [template],
		});
		vi.mocked(api.fetchProjectAssessments).mockResolvedValue([
			engagement,
			{ ...engagement, id: "eng-prod", environment: "production" },
		]);
		vi.mocked(api.fetchBusinessLogicScenarios).mockResolvedValue([scenario]);
	});

	it("clears specialized state when inactive", async () => {
		const root = await render({
			active: false,
			selectedProjectId: "project-1",
		});
		expect(latest?.projectDynamicProfiles).toEqual([]);
		expect(latest?.specializedLaunchLoading).toBe(false);
		await act(async () => root.unmount());
	});

	it("loads enabled dynamic profiles, internal engagements, and scenarios", async () => {
		const root = await render({ active: true, selectedProjectId: "project-1" });
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latest?.projectDynamicProfiles).toEqual([config]);
		expect(latest?.dynamicProfileTemplates).toEqual([template]);
		expect(latest?.selectedProjectDynamicProfileId).toBe("dynamic-test");
		expect(latest?.assessmentEngagements).toEqual([engagement]);
		expect(latest?.selectedBusinessLogicScenarioId).toBe("scn-1");
		expect(latest?.specializedLaunchLoading).toBe(false);
		await act(async () => {
			latest?.setReleaseInputKind("image_ref");
			latest?.setImageRef("ghcr.io/example/app:1");
			latest?.setImageTar("/tmp/app.tar");
			latest?.setAttestationSubject("app");
			latest?.setSupplyChainVerifier("slsa");
			latest?.setAttestationBundle("bundle");
			latest?.setTrustPolicy("policy");
			latest?.setSlsaProvenance("prov");
			latest?.setSlsaPolicy("slsa-policy");
			latest?.setSelectedProjectDynamicProfileId("dynamic-test");
			latest?.setSelectedAssessmentEngagementId("eng-1");
			latest?.setActiveAssessmentPlanJson("{}");
			latest?.setSelectedBusinessLogicScenarioId("scn-1");
			latest?.setDestructiveScanConsent(true);
		});
		expect(latest?.releaseInputKind).toBe("image_ref");
		expect(latest?.supplyChainVerifier).toBe("slsa");
		expect(latest?.destructiveScanConsent).toBe(true);
		await act(async () => root.unmount());
	});

	it("clears specialized state when no project is selected", async () => {
		const root = await render({ active: true, selectedProjectId: "" });
		expect(latest?.projectDynamicProfiles).toEqual([]);
		expect(latest?.specializedLaunchLoading).toBe(false);
		await act(async () => root.unmount());
	});

	it("falls back to the first template when no enabled profile exists", async () => {
		vi.mocked(api.fetchProjectDynamicProfiles).mockResolvedValue({
			configs: [{ ...config, enabled: false }],
			templates: [template],
		});
		vi.mocked(api.fetchProjectAssessments).mockResolvedValue([]);
		vi.mocked(api.fetchBusinessLogicScenarios).mockResolvedValue([]);
		const root = await render({ active: true, selectedProjectId: "project-1" });
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latest?.projectDynamicProfiles).toEqual([]);
		expect(latest?.selectedProjectDynamicProfileId).toBe("dynamic-test");
		expect(latest?.selectedAssessmentEngagementId).toBe("");
		expect(latest?.selectedBusinessLogicScenarioId).toBe("");
		await act(async () => root.unmount());
	});

	it("records per-source errors when specialized lookups fail", async () => {
		vi.mocked(api.fetchProjectDynamicProfiles).mockRejectedValue(
			new Error("dynamic down"),
		);
		vi.mocked(api.fetchProjectAssessments).mockRejectedValue("engagements");
		vi.mocked(api.fetchBusinessLogicScenarios).mockRejectedValue(
			new Error("scenarios down"),
		);
		const root = await render({ active: true, selectedProjectId: "project-1" });
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(latest?.specializedLaunchErrors).toEqual({
			dynamic: "dynamic down",
			engagements: "Active診断のRoEを取得できませんでした。",
			businessLogic: "scenarios down",
		});
		await act(async () => root.unmount());
	});
});
