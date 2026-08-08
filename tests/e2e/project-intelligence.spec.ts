import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const timestamp = "2026-08-08T02:20:53.000Z";
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

const findings = [
	{
		id: "finding-critical",
		scanRunId: scan.id,
		projectId: project.id,
		sourceTool: "semgrep",
		ruleId: "typescript.sql-injection",
		title: "SQL query includes untrusted input",
		description: "A request value is concatenated into a SQL query.",
		severity: "critical",
		confidence: "static",
		status: "open",
		primaryLocation: { path: "src/auth/session.ts", startLine: 42 },
		fingerprint: "fingerprint-critical",
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
		latestDecision: null,
		latestReview: null,
	},
	{
		id: "finding-medium",
		scanRunId: scan.id,
		projectId: project.id,
		sourceTool: "gitleaks",
		ruleId: "generic-api-key",
		title: "Possible API key",
		description: "A value resembles an API key.",
		severity: "medium",
		confidence: "static",
		status: "open",
		primaryLocation: { path: "src/config.ts", startLine: 8 },
		fingerprint: "fingerprint-medium",
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
		latestDecision: null,
		latestReview: null,
	},
];

const fileRiskIndex = [
	{
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
	},
	{
		path: "src/config.ts",
		findingCount: 1,
		maxSeverity: "medium",
		evidenceQuality: "weak",
		scanners: ["gitleaks"],
		ruleIds: ["generic-api-key"],
		findingIds: ["finding-medium"],
		evidenceRefs: [],
		artifactRefs: [],
		verificationRefs: [],
		latestScanRunId: scan.id,
	},
];

const graph = {
	nodes: [
		{ id: "project-node", kind: "project", label: project.name, sourceId: project.id },
		{
			id: "finding-node-critical",
			kind: "finding",
			label: findings[0].title,
			sourceId: findings[0].id,
			severity: "critical",
		},
		{
			id: "finding-node-medium",
			kind: "finding",
			label: findings[1].title,
			sourceId: findings[1].id,
			severity: "medium",
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

const readinessItem = { status: "available", reasonCodes: [] };
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
		findingCount: findings.length,
		toolRunCount: 2,
		artifactCount: 1,
		reviewStatus: "completed",
	},
	scanSummary: {
		riskBand: "critical",
		evidenceQuality: "mixed",
		degradedReasons: [],
	},
	fileRiskIndex,
	graph,
	codeStructure: {
		status: "available",
		snapshotRef: "snapshot-e2e",
		summary: {
			fileCount: 2,
			parsedFileCount: 2,
			importEdgeCount: 1,
			packageDependencyCount: 1,
		},
		degradedReasons: [],
	},
};

const projectView = {
	project,
	latestUsableScan: scan,
	selectedScan: scan,
	selection: {
		requestedScanRunId: null,
		selectedScanRunId: scan.id,
		isLatest: true,
		selectionReason: "latest_completed",
	},
	generation: {
		generationId: "generation-intelligence-e2e",
		generatedAt: timestamp,
		sourceTreeHash: "a".repeat(64),
		sourceStateHash: "b".repeat(64),
		snapshotRef: "snapshot-e2e",
		exportHash: "c".repeat(64),
		status: "available",
	},
	export: exportPayload,
	manifest: null,
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

const moduleCandidate = {
	id: "module-auth",
	pathPrefix: "src/auth",
	label: "Authentication",
	fileCount: 1,
	entrypointFiles: ["src/auth/session.ts"],
	roleTags: ["entrypoint"],
	exportedSymbols: ["createSession"],
	internalDependencies: [],
	packageDependencies: ["database"],
	risk: {
		findingCount: 1,
		maxSeverity: "critical",
		evidenceQuality: "strong",
		fileRefs: ["src/auth/session.ts"],
		findingIds: ["finding-critical"],
	},
	confidence: 0.9,
	reasons: ["path prefix"],
};

async function mockProjectIntelligence(
	page: Page,
	options: { paginateFindings?: boolean } = {},
) {
	let baseRequests = 0;
	let structureRequests = 0;
	let ontologyRequests = 0;
	let findingRequests = 0;
	let savedDecision: Record<string, unknown> | null = null;
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
					email: "intelligence@example.com",
					displayName: "Intelligence E2E",
					role: "admin",
				},
			});
		}
		if (path === "/api/sources/health") return json({ service: "ok", git: null });
		if (path === "/api/health") return json({ status: "ok", service: "vuln-workbench" });
		if (path === "/api/sources/categories") return json({ items: ["tech"] });
		if (path === "/api/settings/system-context") return json({ systemContext: "", updatedAt: null });
		if (path === `/api/projects/${project.id}/intelligence`) {
			baseRequests += 1;
			return json(projectView);
		}
		if (path === "/api/scans" && url.searchParams.get("projectId") === project.id) {
			return json({ scans: [scan] });
		}
		if (path.endsWith("/intelligence/project-structure")) {
			structureRequests += 1;
			return json({
				status: "available",
				generationId: projectView.generation.generationId,
				items: [
					{
						path: "src/auth/session.ts",
						language: "typescript",
						moduleKind: "source",
						tags: ["entrypoint"],
						analysisStatus: "analyzed",
						referenceCount: 1,
						exportCount: 1,
						externalDependencyCount: 1,
						risk: fileRiskIndex[0],
					},
				],
				modules: [moduleCandidate],
				nextCursor: null,
				total: 1,
			});
		}
		if (path.endsWith("/intelligence/ontology-handoff")) {
			ontologyRequests += 1;
			return json({ handoff: null });
		}
		if (path === `/api/scans/${scan.id}/findings`) {
			findingRequests += 1;
			const cursor = url.searchParams.get("cursor");
			const pageFindings = options.paginateFindings
				? cursor
					? [findings[1]]
					: [findings[0]]
				: findings;
			return json({
				findings: pageFindings.map((finding) =>
					finding.id === "finding-critical" && savedDecision
						? { ...finding, latestDecision: savedDecision }
						: finding,
				),
				nextCursor:
					options.paginateFindings && !cursor ? findings[0].id : null,
			});
		}
		if (path.startsWith("/api/findings/") && !path.endsWith("/decisions")) {
			const findingId = path.split("/")[3];
			const finding = findings.find((item) => item.id === findingId);
			return json({
				finding,
				evidence:
					findingId === "finding-critical"
						? [
								{
									id: "evidence-critical",
									findingId,
									kind: "source-location",
									title: "Source location",
									artifactId: null,
									location: { path: "src/auth/session.ts", startLine: 42 },
									snippet: "db.query('SELECT ' + request.userId)",
									metadata: {},
									createdAt: timestamp,
								},
							]
						: [],
				latestReview: null,
				latestDecision: findingId === "finding-critical" ? savedDecision : null,
			});
		}
		if (path === `/api/findings/finding-critical/decisions` && request.method() === "POST") {
			const body = request.postDataJSON();
			savedDecision = {
				id: "decision-e2e",
				findingId: "finding-critical",
				...body,
				linkedReviewId: null,
				decidedByUserId: "user-e2e",
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			return json({ decision: savedDecision });
		}
		if (path === `/api/scans/${scan.id}/intelligence/agent-query`) {
			return json({
				result: {
					ok: true,
					status: "completed",
					version: "v1",
					generatedAt: timestamp,
					scanRunId: scan.id,
					queryKind: "project_overview",
					summary: { title: "Landscape", body: "Current risk landscape", candidateOnly: true },
					refs: { findingIds: [], evidenceRefs: [], artifactRefs: [], fileRefs: [], sourceRefs: [] },
					results: [],
					bundles: {
						landscape: {
							risk: { band: "critical", findingCount: 2, bySeverity: { critical: 1, medium: 1 }, byScanner: { semgrep: 1, gitleaks: 1 }, byFile: [] },
							coverage: { status: "covered", scannedToolCount: 2, artifactCount: 1, unknownFileCount: 0, degradedReasons: [] },
							evidence: { quality: "mixed", missingEvidenceFindingIds: ["finding-medium"], weakEvidenceFindingIds: [], artifactBackedEvidenceRefs: [] },
							remediation: { reviewStatus: "completed", hasImprovementRequest: false, acceptanceCriteriaCount: 2, verificationCommandCount: 1, openFocus: [] },
						},
					},
					degradedReasons: [],
				},
			});
		}
		if (path === `/api/projects/${project.id}/threat-model-runs`) return json({ runs: [] });
		if (path === `/api/projects/${project.id}/business-logic-scenarios`) return json({ scenarios: [] });
		if (path === `/api/projects/${project.id}/active-assessment-runs`) return json({ runs: [] });
		return json({ message: `Unhandled E2E route: ${path}` }, 404);
	});
	return {
		baseRequests: () => baseRequests,
		structureRequests: () => structureRequests,
		ontologyRequests: () => ontologyRequests,
		findingRequests: () => findingRequests,
		savedDecision: () => savedDecision,
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

test("Intelligenceの4画面をURLと同期し、基礎データを再取得しない", async ({ page }) => {
	const state = await mockProjectIntelligence(page);
	await page.goto(`/projects/${project.id}/intelligence?scanRunId=${scan.id}`);

	await expect(page.getByRole("heading", { name: "優先して確認するFindingがあります" })).toBeVisible();
	await expect.poll(state.structureRequests).toBe(0);
	await expect.poll(state.ontologyRequests).toBe(0);
	const projectNavigation = page.getByRole("navigation", { name: "プロジェクト" });
	const intelligenceNavigation = page.getByRole("navigation", { name: "Intelligence views" });
	await expect(intelligenceNavigation.getByRole("link")).toHaveCount(4);
	await expect(projectNavigation).toBeVisible();
	await expect(
		page.locator(".project-detail-actions, .intelligence-tabs").first(),
	).toHaveClass(/project-detail-actions/);

	await intelligenceNavigation
		.getByRole("link", { name: /^調査ビュー:/ })
		.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/intelligenceView=investigate/);
	await expect(page.getByRole("heading", { name: findings[0].title })).toBeVisible();
	await expect(page.getByText("db.query('SELECT ' + request.userId)")).toBeVisible();

	await intelligenceNavigation.getByRole("link", { name: /^リスクマップ:/ }).click();
	await expect(page).toHaveURL(/intelligenceView=landscape/);
	await expect(page.getByRole("heading", { name: /Module × Severity/ })).toBeVisible();
	await expect(page.getByRole("button", { name: "Authenticationのcritical Finding 1件" })).toBeVisible();
	await expect.poll(state.structureRequests).toBe(1);

	await intelligenceNavigation.getByRole("link", { name: /^ガイド方式:/ }).click();
	await expect(page).toHaveURL(/intelligenceView=guided/);
	await expect(page.getByRole("heading", { name: "確認ステップ" })).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/intelligenceView=landscape/);
	await expect(page.getByRole("heading", { name: /Module × Severity/ })).toBeVisible();
	await page.goForward();
	await expect(page).toHaveURL(/intelligenceView=guided/);
	await intelligenceNavigation.getByRole("link", { name: /^判断優先:/ }).click();
	await expect.poll(state.ontologyRequests).toBe(0);
	await page.getByText("分析詳細", { exact: true }).click();
	await expect.poll(state.ontologyRequests).toBe(1);
	await expect(
		page.getByRole("heading", { name: "External Agent Readiness" }),
	).toBeVisible();
	await expect.poll(state.baseRequests).toBe(1);
	await expectNoSeriousAccessibilityViolations(page);
});

test("ガイド方式から確認付きで互換Decisionを保存する", async ({ page }) => {
	const state = await mockProjectIntelligence(page);
	await page.goto(`/projects/${project.id}/intelligence?scanRunId=${scan.id}&intelligenceView=guided`);

	await page.getByRole("button", { name: /問題として確認/ }).click();
	await page.getByLabel("理由（必須）").selectOption("confirmed_by_evidence");
	await page.getByLabel("補足（任意）").fill("E2Eで確認しました");
	await page.getByRole("button", { name: "互換Decisionを保存" }).click();

	await expect(page.getByRole("status")).toContainText("互換Decisionを保存しました");
	await expect(
		page.getByRole("heading", { name: findings[0].title }),
	).toBeVisible();
	await expect.poll(state.savedDecision).toMatchObject({
		decision: "needs_fix",
		reason: "confirmed_by_evidence",
		comment: "E2Eで確認しました",
	});
	await expect(page.getByText("実装改善候補").first()).toBeVisible();
	await page.getByRole("button", { name: /^次へ/ }).click();
	await expect(
		page.getByRole("heading", { name: findings[1].title }),
	).toBeVisible();
});

test("ガイド方式でFindingをカーソルから追加読込する", async ({ page }) => {
	const state = await mockProjectIntelligence(page, { paginateFindings: true });
	await page.goto(
		`/projects/${project.id}/intelligence?scanRunId=${scan.id}&intelligenceView=guided`,
	);

	await expect(page.getByText("読み込み済みの確認進捗")).toBeVisible();
	await page
		.getByRole("button", { name: "さらにFindingを読み込む" })
		.click();
	await expect(
		page.getByRole("button", { name: new RegExp(findings[1].title) }),
	).toBeVisible();
	await expect.poll(state.findingRequests).toBe(2);
	await expect(
		page.getByRole("button", { name: "さらにFindingを読み込む" }),
	).toHaveCount(0);
});

test("390px幅でもページ全体に横スクロールを出さない", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockProjectIntelligence(page);
	await page.goto(`/projects/${project.id}/intelligence?scanRunId=${scan.id}&intelligenceView=investigate`);
	await expect(page.getByRole("navigation", { name: "Intelligence views" })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
			),
		)
		.toBe(true);
	await expectNoSeriousAccessibilityViolations(page);
});
