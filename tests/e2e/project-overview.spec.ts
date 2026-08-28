import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./test";

const timestamp = "2026-08-06T00:12:43.000Z";
const project = {
	id: "project-overview-e2e",
	name: "vulnWorkbench",
	repositoryName: "vulnWorkbench",
	defaultBranch: "main",
	createdAt: timestamp,
	updatedAt: timestamp,
};
const scan = {
	id: "scan-overview-e2e",
	projectId: project.id,
	profile: "baseline",
	status: "completed",
	startedAt: "2026-08-06T00:10:00.000Z",
	completedAt: timestamp,
	createdByUserId: "user-e2e",
	summary: null,
	metadata: {},
	createdAt: "2026-08-06T00:09:00.000Z",
	updatedAt: timestamp,
};

const readinessItem = (
	status: "available" | "missing",
	reasonCodes: string[] = [],
) => ({ status, reasonCodes });

function readiness(status: "available" | "missing", reasons: string[] = []) {
	const item = readinessItem(status, reasons);
	return {
		export: item,
		fileRiskIndex: item,
		evidenceGraph: item,
		codeStructure: item,
		semanticIndex: item,
		agentBundle: item,
		ontologyHandoff: item,
	};
}

function projectView(generated: boolean, selectedScan = scan) {
	return {
		project,
		latestUsableScan: selectedScan,
		selectedScan,
		selection: {
			requestedScanRunId: null,
			selectedScanRunId: selectedScan.id,
			isLatest: true,
			selectionReason: "latest_completed",
		},
		generation: generated
			? {
					generationId: "generation-overview-e2e",
					generatedAt: timestamp,
					sourceTreeHash: "a".repeat(64),
					sourceStateHash: "b".repeat(64),
					snapshotRef: "snapshot-overview-e2e",
					exportHash: "c".repeat(64),
					status: "available",
				}
			: null,
		export: generated
			? {
					scan: { findingCount: 2 },
					scanSummary: {
						riskBand: "high",
						evidenceQuality: "strong",
						degradedReasons: [],
					},
				}
			: null,
		manifest: null,
		readiness: generated
			? readiness("available")
			: readiness("missing", ["generation_missing"]),
		degradedReasons: generated ? [] : ["generation_missing"],
	};
}

function emptyProjectView() {
	return {
		project,
		latestUsableScan: null,
		selectedScan: null,
		selection: {
			requestedScanRunId: null,
			selectedScanRunId: null,
			isLatest: true,
			selectionReason: "none",
		},
		generation: null,
		export: null,
		manifest: null,
		readiness: readiness("missing", ["scan_missing"]),
		degradedReasons: ["scan_missing"],
	};
}

async function mockProjectOverview(
	page: Page,
	options: {
		scanAvailable: boolean;
		scanStatus?: "completed" | "running";
		viewGate?: Promise<void>;
	},
) {
	let generated = false;
	let refreshRequests = 0;
	const selectedScan = options.scanStatus
		? { ...scan, status: options.scanStatus }
		: scan;
	await page.route("**/api/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		if (path === "/api/auth/me") {
			return json({
				user: {
					id: "user-e2e",
					email: "overview@example.com",
					displayName: "Overview E2E",
					role: "admin",
				},
			});
		}
		if (path === "/api/sources/health") {
			return json({ service: "ok", git: null });
		}
		if (path === "/api/health") {
			return json({ status: "ok", service: "vuln-workbench" });
		}
		if (path === "/api/sources/categories") {
			return json({ items: ["tech"] });
		}
		if (path === "/api/settings/system-context") {
			return json({ systemContext: "", updatedAt: null });
		}
		if (path === `/api/projects/${project.id}/intelligence`) {
			await options.viewGate;
			return json(
				options.scanAvailable
					? projectView(generated, selectedScan)
					: emptyProjectView(),
			);
		}
		if (
			path === `/api/projects/${project.id}/intelligence/refresh` &&
			request.method() === "POST"
		) {
			refreshRequests += 1;
			generated = true;
			return json({ ok: true, status: "completed" });
		}
		if (path === "/api/scans" && url.searchParams.get("projectId") === project.id) {
			return json({ scans: options.scanAvailable ? [selectedScan] : [] });
		}
		if (path === `/api/projects/${project.id}/threat-model-runs`) {
			return json({ runs: [] });
		}
		if (path === `/api/projects/${project.id}/business-logic-scenarios`) {
			return json({ scenarios: [] });
		}
		if (path === `/api/projects/${project.id}/active-assessment-runs`) {
			return json({ runs: [] });
		}
		return json({ message: `Unhandled E2E route: ${path}` }, 404);
	});
	return { refreshRequests: () => refreshRequests };
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
	const result = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	const blocking = result.violations.filter(
		(item) => item.impact === "serious" || item.impact === "critical",
	);
	expect(blocking).toEqual([]);
}

test("project Overview separates a completed scan from missing Intelligence and generates it", async ({
	page,
}) => {
	const state = await mockProjectOverview(page, { scanAvailable: true });
	await page.goto(`/projects/${project.id}`);

	await expect(page.getByRole("heading", { name: "プロジェクト概要" })).toBeVisible();
	await expect(page.getByText("完了", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("未生成", { exact: true })).toBeVisible();
	await expect(page.getByText("generation_missing")).toHaveCount(0);
	await expect(page.getByText("Risk Band")).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
	await expectNoSeriousAccessibilityViolations(page);

	await page.getByRole("button", { name: "Intelligenceを生成" }).click();
	await expect.poll(state.refreshRequests).toBe(1);
	await expect(page.getByText("利用可能", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("高", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Intelligenceを開く" }),
	).toBeVisible();

	const projectTabs = page.getByRole("navigation", { name: "プロジェクト" });
	await expect(projectTabs.getByRole("link")).toHaveText([
		"Overview",
		"Scans",
		"Intelligence",
	]);
	await expect(
		projectTabs.getByRole("link", { name: "Overview" }),
	).toHaveAttribute("aria-current", "page");
	await expectNoSeriousAccessibilityViolations(page);
});

test("project Overview explains that a scan is required before Intelligence", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockProjectOverview(page, { scanAvailable: false });
	await page.goto(`/projects/${project.id}`);

	await expect(page.getByText("スキャンはまだありません")).toBeVisible();
	await expect(page.getByText("スキャンが必要", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "スキャンを開始" })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Intelligenceを生成" }),
	).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					document.documentElement.scrollWidth <=
					document.documentElement.clientWidth,
			),
		)
		.toBe(true);
	await expectNoSeriousAccessibilityViolations(page);
});

test("project Overview keeps loading distinct from empty and missing states", async ({
	page,
}) => {
	let releaseView: (() => void) | undefined;
	const viewGate = new Promise<void>((resolve) => {
		releaseView = resolve;
	});
	await mockProjectOverview(page, { scanAvailable: true, viewGate });

	await page.goto(`/projects/${project.id}`);
	await expect(
		page.getByRole("status").getByText("プロジェクト情報を読み込んでいます…"),
	).toBeVisible();
	await expect(page.getByText("スキャンはまだありません")).toHaveCount(0);
	await expect(page.getByText("プロジェクトが見つかりません。")).toHaveCount(
		0,
	);

	releaseView?.();
	await expect(page.getByRole("heading", { name: "プロジェクト概要" })).toBeVisible();
});

test("project Overview waits for a running scan before generating Intelligence", async ({
	page,
}) => {
	await mockProjectOverview(page, {
		scanAvailable: true,
		scanStatus: "running",
	});
	await page.goto(`/projects/${project.id}?scanRunId=${scan.id}`);

	await expect(
		page
			.getByRole("region", { name: "スキャン", exact: true })
			.getByText("実行中", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("スキャン完了待ち", { exact: true })).toBeVisible();
	await expect(page.getByText("最新スキャンを確認")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Intelligenceを生成" }),
	).toHaveCount(0);
});
