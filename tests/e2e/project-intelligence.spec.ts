import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const timestamp = "2026-08-08T02:20:53.000Z";
const generationId = "00000000-0000-4000-8000-000000000010";
const project = {
	id: "project-intelligence-e2e",
	name: "vulnWorkbench",
	repositoryName: "vulnWorkbench",
	defaultBranch: "main",
	createdAt: timestamp,
	updatedAt: timestamp,
};
const scan = {
	id: "scan-intelligence-e2e",
	projectId: project.id,
	profile: "baseline",
	status: "completed",
	startedAt: timestamp,
	completedAt: timestamp,
	createdByUserId: "user-e2e",
	summary: null,
	metadata: {},
	createdAt: timestamp,
	updatedAt: timestamp,
};

const fileRisk = {
	path: "src/auth/session.ts",
	findingCount: 1,
	maxSeverity: "critical",
	evidenceQuality: "strong",
	scanners: ["semgrep"],
	ruleIds: ["typescript.sql-injection"],
	findingIds: ["finding-critical"],
	evidenceRefs: ["evidence-critical"],
	artifactRefs: [],
	verificationRefs: [],
	latestScanRunId: scan.id,
	latestSeenAt: timestamp,
};

const graph = {
	nodes: [
		{
			id: "project-node",
			kind: "project",
			label: project.name,
			sourceId: project.id,
		},
		{
			id: "finding-node-critical",
			kind: "finding",
			label: "SQL query includes untrusted input",
			sourceId: "finding-critical",
			severity: "critical",
		},
		{
			id: "evidence-node-critical",
			kind: "evidence",
			label: "Source location",
			sourceId: "evidence-critical",
		},
	],
	edges: [
		{
			id: "edge-evidence-critical",
			from: "finding-node-critical",
			to: "evidence-node-critical",
			kind: "evidenced_by",
			confidence: 1,
			evidenceRefs: ["evidence-critical"],
		},
	],
};

const exportPayload = {
	version: "v1",
	generatedAt: timestamp,
	project: { id: project.id, name: project.name },
	scan: {
		id: scan.id,
		profile: scan.profile,
		status: scan.status,
		startedAt: scan.startedAt,
		completedAt: scan.completedAt,
		findingCount: 1,
		toolRunCount: 2,
		artifactCount: 1,
		reviewStatus: "completed",
	},
	scanSummary: {
		riskBand: "critical",
		evidenceQuality: "strong",
		degradedReasons: [],
	},
	fileRiskIndex: [fileRisk],
	graph,
};

const readinessItem = {
	status: "available",
	reasonCodes: [],
	generatedAt: timestamp,
	generationId,
};
const projectView = {
	project,
	latestUsableScan: scan,
	selectedScan: scan,
	selection: {
		requestedScanRunId: scan.id,
		selectedScanRunId: scan.id,
		isLatest: true,
		selectionReason: "requested",
	},
	generation: {
		generationId,
		generatedAt: timestamp,
		sourceTreeHash: "a".repeat(64),
		sourceStateHash: "b".repeat(64),
		snapshotRef: "snapshot-e2e",
		exportHash: "c".repeat(64),
		status: "available",
	},
	export: exportPayload,
	manifest: {
		availableBundles: [
			{
				kind: "project_structure_snapshot",
				command: ["intelligence:project-structure", "--scan-run-id", scan.id],
			},
		],
	},
	readiness: {
		export: readinessItem,
		fileRiskIndex: readinessItem,
		evidenceGraph: readinessItem,
		codeStructure: readinessItem,
		semanticIndex: readinessItem,
		agentBundle: readinessItem,
		ontologyHandoff: readinessItem,
	},
	degradedReasons: [],
};

const authModule = {
	id: "module:auth",
	pathPrefix: "src/auth",
	label: "Authentication",
	fileCount: 1,
	entrypointFiles: ["src/auth/session.ts"],
	roleTags: ["route"],
	exportedSymbols: ["createSession"],
	internalDependencies: ["src/core"],
	packageDependencies: ["database"],
	risk: {
		findingCount: 1,
		maxSeverity: "critical",
		evidenceQuality: "strong",
		fileRefs: ["src/auth/session.ts"],
		findingIds: ["finding-critical"],
	},
	confidence: 0.95,
	reasons: ["directory boundary", "entrypoint"],
};
const coreModule = {
	id: "module:core",
	pathPrefix: "src/core",
	label: "Core",
	fileCount: 2,
	entrypointFiles: ["src/core/index.ts"],
	roleTags: ["source"],
	exportedSymbols: ["createCore", "CoreService"],
	internalDependencies: ["src/auth"],
	packageDependencies: [],
	risk: {
		findingCount: 0,
		maxSeverity: "unknown",
		evidenceQuality: "none",
		fileRefs: [],
		findingIds: [],
	},
	confidence: 0.88,
	reasons: ["directory boundary"],
};
const modules = [authModule, coreModule];

const coverage = {
	discoveredFileCount: 4,
	includedFileCount: 3,
	analyzableFileCount: 3,
	unsupportedFileCount: 0,
	resourceFileCount: 0,
	excludedFileCount: 1,
	excludedByReason: { ignored: 1 },
	unhashedFileCount: 0,
	totalIncludedBytes: 2400,
	budgetHit: false,
};
const structureReadiness = {
	inventory: { status: "available", reasonCodes: [] },
	analysis: { status: "available", reasonCodes: [] },
	resolution: { status: "available", reasonCodes: [] },
	moduleInference: { status: "available", reasonCodes: [] },
};
const structureSummary = {
	fileCount: 3,
	analyzedFileCount: 3,
	styleFileCount: 0,
	markupFileCount: 0,
	resourceFileCount: 0,
	resolvedReferenceCount: 2,
	unresolvedReferenceCount: 0,
	moduleCount: 2,
};

const moduleFiles = {
	"module:auth": [
		{
			path: "src/auth/session.ts",
			language: "typescript",
			moduleKind: "esm",
			tags: ["route"],
			analysisStatus: "analyzed",
			referenceCount: 2,
			exportCount: 1,
			externalDependencyCount: 1,
			risk: fileRisk,
		},
	],
	"module:core": [
		{
			path: "src/core/index.ts",
			language: "typescript",
			moduleKind: "esm",
			tags: ["source"],
			analysisStatus: "analyzed",
			referenceCount: 1,
			exportCount: 2,
			externalDependencyCount: 0,
			risk: null,
		},
	],
} as const;

const references = [
	{
		from: "src/auth/session.ts",
		specifier: "../core",
		kind: "code_module",
		status: "resolved",
		target: "src/core/index.ts",
		resolverId: "typescript",
		confidence: 1,
		diagnosticCodes: [],
	},
	{
		from: "src/core/index.ts",
		specifier: "../auth/session",
		kind: "code_module",
		status: "resolved",
		target: "src/auth/session.ts",
		resolverId: "typescript",
		confidence: 1,
		diagnosticCodes: [],
	},
];

async function mockProjectIntelligence(
	page: Page,
	options: { emptyFindings?: boolean; structureFailure?: boolean } = {},
) {
	let baseRequests = 0;
	let structureRequests = 0;
	let ontologyRequests = 0;
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
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
					email: "intelligence@example.com",
					displayName: "Intelligence E2E",
					role: "admin",
				},
			});
		}
		if (path === "/api/sources/health")
			return json({ service: "ok", git: null });
		if (path === "/api/health")
			return json({ status: "ok", service: "vuln-workbench" });
		if (path === "/api/sources/categories") return json({ items: ["tech"] });
		if (path === "/api/settings/system-context")
			return json({ systemContext: "", updatedAt: null });
		if (path === `/api/projects/${project.id}/intelligence`) {
			baseRequests += 1;
			return json(
				options.emptyFindings
					? {
							...projectView,
							export: {
								...exportPayload,
								scan: { ...exportPayload.scan, findingCount: 0 },
								scanSummary: {
									riskBand: "none",
									evidenceQuality: "none",
									degradedReasons: [],
								},
								fileRiskIndex: [],
								graph: { nodes: [graph.nodes[0]], edges: [] },
							},
						}
					: projectView,
			);
		}
		if (
			path === "/api/scans" &&
			url.searchParams.get("projectId") === project.id
		)
			return json({ scans: [scan] });
		if (path.endsWith("/intelligence/project-structure")) {
			structureRequests += 1;
			if (options.structureFailure)
				return json({ message: "structure fixture unavailable" }, 503);
			const view = url.searchParams.get("view") ?? "summary";
			const responseModules = options.emptyFindings
				? modules.map((module) => ({
						...module,
						risk: {
							findingCount: 0,
							maxSeverity: "unknown",
							evidenceQuality: "none",
							fileRefs: [],
							findingIds: [],
						},
					}))
				: modules;
			const base = {
				view,
				status: "available",
				generationId,
				summary: structureSummary,
				coverage,
				readiness: structureReadiness,
				diagnostics: [],
				modules: responseModules,
			};
			if (view === "summary") return json(base);
			if (view === "files") {
				const moduleId = url.searchParams.get("moduleId") ?? "module:auth";
				const items =
					moduleFiles[moduleId as keyof typeof moduleFiles]?.map((item) => ({
						...item,
						risk: options.emptyFindings ? null : item.risk,
					})) ?? [];
				return json({
					...base,
					view: "files",
					items,
					nextCursor: null,
					total: items.length,
				});
			}
			const moduleId = url.searchParams.get("moduleId");
			const selectedFiles = new Set(
				moduleId === "module:core"
					? ["src/core/index.ts"]
					: ["src/auth/session.ts"],
			);
			const items = references.filter(
				(reference) =>
					selectedFiles.has(reference.from) ||
					Boolean(reference.target && selectedFiles.has(reference.target)),
			);
			return json({
				...base,
				view: "references",
				items,
				nextCursor: null,
				total: items.length,
			});
		}
		if (path.endsWith("/intelligence/ontology-handoff")) {
			ontologyRequests += 1;
			return json({
				handoff: {
					status: "available",
					projectId: project.id,
					scanRunId: scan.id,
					generationId,
					snapshotRef: "snapshot-e2e",
					exportHash: "c".repeat(64),
					sourceTreeHash: "a".repeat(64),
					modules,
					graphSummary: {
						nodeCounts: { project: 1, finding: 1, evidence: 1 },
						edgeCounts: { evidenced_by: 1 },
					},
					verificationCommands: ["bun test src/auth"],
					sourceRefs: ["src/auth/session.ts", "src/core/index.ts"],
					degradedReasons: [],
					consumerBoundary: {
						ownsCanonicalOntology: false,
						ownsTaskCompilation: false,
						consumer: "NightWorkers",
					},
				},
			});
		}
		if (path === `/api/projects/${project.id}/threat-model-runs`)
			return json({ runs: [] });
		if (path === `/api/projects/${project.id}/business-logic-scenarios`)
			return json({ scenarios: [] });
		if (path === `/api/projects/${project.id}/active-assessment-runs`)
			return json({ runs: [] });
		return json({ message: `Unhandled E2E route: ${path}` }, 404);
	});
	return {
		baseRequests: () => baseRequests,
		structureRequests: () => structureRequests,
		ontologyRequests: () => ontologyRequests,
	};
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
	const result = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(
		result.violations.filter(
			(item) => item.impact === "serious" || item.impact === "critical",
		),
	).toEqual([]);
}

test("構造中心の4画面をURLと同期し、generationを再取得しない", async ({
	page,
}) => {
	const state = await mockProjectIntelligence(page);
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}`,
	);

	await expect(
		page.getByRole("heading", { name: "プロジェクト構造を利用できます" }),
	).toBeVisible();
	await expect.poll(state.structureRequests).toBe(1);
	const navigation = page.getByRole("navigation", {
		name: "Intelligence views",
	});
	await expect(navigation.getByRole("link")).toHaveCount(4);
	await expect(
		navigation.getByRole("link", { name: /^構造サマリー:/ }),
	).toHaveAttribute("aria-current", "page");

	await navigation.getByRole("link", { name: /^モジュール:/ }).click();
	await expect(page).toHaveURL(/intelligenceView=modules/);
	await expect(page.getByRole("heading", { name: "Core" })).toBeVisible();
	await expect(
		page.locator("td code").filter({ hasText: "src/core/index.ts" }),
	).toBeVisible();

	await navigation.getByRole("link", { name: /^関係マップ:/ }).click();
	await expect(page).toHaveURL(/intelligenceView=relationships/);
	await expect(
		page.getByRole("heading", { name: "関係マップ", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "Outbound" })).toBeVisible();
	await expect(
		page
			.getByRole("heading", { name: "Outbound" })
			.locator("..")
			.getByRole("link", { name: /Authentication src\/auth/ }),
	).toBeVisible();

	await navigation.getByRole("link", { name: /^Ontology連携:/ }).click();
	await expect(page).toHaveURL(/intelligenceView=handoff/);
	await expect(
		page.getByRole("heading", {
			name: "Ontologyへ渡す前の候補データです",
		}),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Handoff readiness" }),
	).toBeVisible();
	await expect.poll(state.ontologyRequests).toBe(1);

	await page.goBack();
	await expect(page).toHaveURL(/intelligenceView=relationships/);
	await page.goForward();
	await expect(page).toHaveURL(/intelligenceView=handoff/);
	await expect.poll(state.baseRequests).toBe(1);
	await expectNoSeriousAccessibilityViolations(page);
});

test("検出事項が0件でも構造・モジュール・関係を探索できる", async ({
	page,
}) => {
	await mockProjectIntelligence(page, { emptyFindings: true });
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}`,
	);

	await expect(
		page.getByText(
			"このgenerationには検出事項のoverlayがありません。構造解析結果は引き続き利用できます。",
		),
	).toBeVisible();
	await expect(page.getByText("Module candidates").first()).toBeVisible();
	await expect(page.getByText("2", { exact: true }).first()).toBeVisible();

	const navigation = page.getByRole("navigation", {
		name: "Intelligence views",
	});
	await navigation.getByRole("link", { name: /^モジュール:/ }).click();
	await expect(page.getByRole("heading", { name: "Core" })).toBeVisible();
	await expect(
		page.locator("td code").filter({ hasText: "src/core/index.ts" }),
	).toBeVisible();
	await navigation.getByRole("link", { name: /^関係マップ:/ }).click();
	await expect(
		page.getByRole("heading", { name: "Outbound" }),
	).toBeVisible();
	await expect(page.getByText("Findingを選択してください")).toHaveCount(0);
	await expect(page.getByText("検出事項を選択してください")).toHaveCount(0);
});

test("旧タブURLを対応する構造画面へ移行する", async ({ page }) => {
	await mockProjectIntelligence(page);
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}&intelligenceView=investigate`,
	);

	await expect(page.getByRole("heading", { name: "Core" })).toBeVisible();
	await expect(
		page.getByRole("link", { name: /^モジュール:/ }),
	).toHaveAttribute("aria-current", "page");
});

test("構造取得エラーを自動再試行せず、利用者の操作で再試行する", async ({
	page,
}) => {
	const state = await mockProjectIntelligence(page, { structureFailure: true });
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}`,
	);

	await expect(
		page.getByRole("heading", { name: "プロジェクト構造を取得できません" }),
	).toBeVisible();
	await expect.poll(state.structureRequests).toBe(1);
	await page.getByRole("button", { name: "再試行" }).click();
	await expect.poll(state.structureRequests).toBe(2);
});

test("390px幅でも横スクロールを出さず操作できる", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockProjectIntelligence(page);
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}&intelligenceView=modules`,
	);

	await expect(
		page.getByRole("navigation", { name: "Intelligence views" }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "Core" })).toBeVisible();
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
