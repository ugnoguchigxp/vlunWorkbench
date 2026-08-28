import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "./test";

const adminCredentials = {
	email: "admin-e2e@example.com",
	password: "E2eAdminPassword!42",
};
const memberCredentials = {
	email: "member-e2e@example.com",
	password: "E2eMemberPassword!42",
};

async function login(
	page: Page,
	credentials: { email: string; password: string },
): Promise<void> {
	await page.goto("/");
	await page.getByLabel("Email").fill(credentials.email);
	await page.getByLabel("Password").fill(credentials.password);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
}

async function registerFixtureProject(
	page: Page,
	fixtureDirectory:
		| "fixture-project"
		| "fixture-project-semgrep"
		| "fixture-project-maven-war",
): Promise<{ id: string; repoPath: string }> {
	await page.goto("/scans");
	const fixtureProjectPath = path.resolve(
		`.tmp/e2e/projects/${fixtureDirectory}`,
	);
	await page.getByRole("button", { name: "プロジェクトを追加" }).click();
	await page
		.getByLabel("プロジェクトフォルダ path")
		.fill(fixtureProjectPath);
	await page.getByLabel("既定ブランチ").fill("main");

	const projectResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === "/api/projects",
	);
	await page.getByRole("button", { name: "プロジェクトを登録" }).click();
	const projectResponse = await projectResponsePromise;
	expect(projectResponse.status()).toBe(201);
	const project = (await projectResponse.json()).project as {
		id: string;
		repoPath: string;
	};
	expect(project.repoPath).toBe(fixtureProjectPath);
	return project;
}

async function startProfileScan(
	page: Page,
	projectId: string,
	profileId: "source-assurance",
): Promise<string> {
	await page
		.getByLabel("スキャンプロファイル", { exact: true })
		.selectOption(profileId);
	const scanResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname ===
				`/api/projects/${projectId}/scans`,
	);
	await page.getByRole("button", { name: "スキャンを開始" }).click();
	const scanResponse = await scanResponsePromise;
	expect(scanResponse.status()).toBe(202);
	return ((await scanResponse.json()).scan as { id: string }).id;
}

async function waitForCompletedScan(page: Page, scanId: string): Promise<void> {
	await expect
		.poll(
			async () => {
				const response = await page.request.get(`/api/scans/${scanId}`);
				if (!response.ok()) return `http-${response.status()}`;
				return ((await response.json()).scan as { status: string }).status;
			},
			{ timeout: 30_000 },
		)
		.toBe("completed");
}

async function waitForAutomaticReport(
	page: Page,
	scanId: string,
): Promise<string> {
	let automaticReportId: string | null = null;
	await expect
		.poll(
			async () => {
				const response = await page.request.get(
					`/api/scans/${scanId}/diagnostics`,
				);
				if (!response.ok()) return `http-${response.status()}`;
				const diagnostics = (await response.json()).diagnostics as Array<{
					status: string;
					readiness: string | null;
					scanReportId: string | null;
				}>;
				const diagnostic = diagnostics[0];
				automaticReportId = diagnostic?.scanReportId ?? null;
				return diagnostic
					? `${diagnostic.status}:${diagnostic.readiness}:${Boolean(
							diagnostic.scanReportId,
						)}`
					: "missing";
			},
			{ timeout: 30_000 },
		)
		.toBe("completed_with_limitations:ready_with_limitations:true");
	expect(automaticReportId).not.toBeNull();
	const reportId = automaticReportId as string;
	await expect
		.poll(async () => {
			const response = await page.request.get(`/api/scans/${scanId}/reports`);
			if (!response.ok()) return `http-${response.status()}`;
			const reports = (await response.json()).reports as Array<{
				id: string;
				status: string;
			}>;
			return reports.find((report) => report.id === reportId)?.status;
		})
		.toBe("completed");
	return reportId;
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

test("login is keyboard usable, accessible, and served with enforcing CSP", async ({
	page,
}) => {
	const response = await page.goto("/");
	expect(response?.headers()["content-security-policy"]).toContain(
		"default-src 'self'",
	);
	await expect(page.getByRole("heading", { name: "vulnWorkbench" })).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page);

	await page.getByLabel("Email").focus();
	await page.keyboard.press("Tab");
	await expect(page.getByLabel("Password")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "ログイン" })).toBeFocused();

	await page.getByLabel("Email").fill(adminCredentials.email);
	await page.getByLabel("Password").fill(adminCredentials.password);
	await page.getByRole("button", { name: "ログイン" }).click();
	await expect(page.getByText("E2E Admin (admin)")).toBeVisible();
});

test("project path validation and member/admin boundaries hold through a browser session", async ({
	page,
}) => {
	await login(page, adminCredentials);
	const createMember = await page.request.post("/api/admin/users", {
		data: {
			email: memberCredentials.email,
			displayName: "E2E Member",
			role: "member",
			initialPassword: memberCredentials.password,
		},
	});
	expect([201, 409]).toContain(createMember.status());

	await page.getByRole("button", { name: "Logout" }).click();
	await login(page, memberCredentials);

	const rejectedProject = await page.request.post("/api/projects", {
		data: {
			repoPath: path.resolve(".tmp/e2e/missing-project"),
			defaultBranch: "main",
			metadata: {},
		},
	});
	expect(rejectedProject.status()).toBe(400);
	expect((await page.request.post("/api/projects/folder-picker")).status()).toBe(
		403,
	);
	expect((await page.request.get("/api/settings/llm")).status()).toBe(403);
	expect(
		(
			await page.request.post("/api/sources/folders", {
				data: { path: "blocked", title: "Blocked" },
			})
		).status(),
	).toBe(403);

	await page.goto("/settings");
	await expect(page.getByRole("heading", { name: "概要" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "LLM Providers" }),
	).toHaveCount(0);
	await expectNoSeriousAccessibilityViolations(page);
});

test("mocked scan workspace renders results, report preview, and history deletion", async ({
	page,
}) => {
	const timestamp = "2026-07-24T00:00:00.000Z";
	const project = {
		id: "project-e2e",
		ownerUserId: "user-e2e",
		name: "E2E project",
		repoPath: "/tmp/e2e-project",
		defaultBranch: "main",
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
		pathPolicy: { status: "allowed", reasonCode: null },
	};
	const scan = {
		id: "scan-e2e",
		projectId: project.id,
		profile: "source-assurance",
		status: "completed",
		startedAt: timestamp,
		completedAt: timestamp,
		createdByUserId: "user-e2e",
		summary: "Completed browser fixture",
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const finding = {
		id: "finding-e2e",
		scanRunId: scan.id,
		projectId: project.id,
		sourceTool: "semgrep",
		ruleId: "e2e-rule",
		title: "Unsafe fixture finding",
		description: "Browser-visible finding evidence.",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: { path: "src/example.ts", line: 7 },
		fingerprint: "e2e-fingerprint",
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const report = {
		id: "report-e2e",
		scanRunId: scan.id,
		title: "E2E Security Report",
		status: "completed",
		stage: "canonical_final",
		reportMode: "deterministic",
		options: {},
		artifactId: "artifact-e2e",
		errorMessage: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	let scanDeleted = false;

	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		const json = (body: unknown, status = 200) =>
			route.fulfill({
				status,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		if (path === "/api/auth/me")
			return json({
				user: {
					id: "user-e2e",
					email: adminCredentials.email,
					displayName: "E2E Admin",
					role: "admin",
				},
			});
		if (path === "/api/sources/health")
			return json({ status: "ok", git: null });
		if (path === "/api/sources/categories") return json({ items: ["tech"] });
		if (path === "/api/settings/system-context")
			return json({ systemContext: "", updatedAt: null });
		if (path === "/api/health")
			return json({ status: "ok", service: "vuln-workbench" });
		if (
			path === `/api/scans/${scan.id}` &&
			route.request().method() === "DELETE"
		) {
			scanDeleted = true;
			return json({
				deletedScanRunId: scan.id,
				deletedAt: timestamp,
				artifactCleanup: "queued",
			});
		}
		if (path === "/api/projects") return json({ projects: [project] });
		if (path === "/api/scan-profiles")
			return json({
				schemaVersion: 1,
				profiles: [
					{
						id: "source-assurance",
						name: "ソースセキュリティ保証",
						description: "E2E profile",
						enabled: true,
						defaultTimeoutSec: 600,
						supportedTargets: ["full"],
						tools: [],
						steps: [],
					},
				],
				catalogEntries: [
					{
						id: "source-assurance",
						displayName: "ソースセキュリティ保証",
						description: "E2E profile",
						experienceKind: "scanner_preset",
						availability: "stable",
						safetyClass: "R0",
						launchMode: "profile_orchestrator",
						supportedTargets: ["full"],
						strictness: "strict",
						capabilityRequirements: [],
						requiredInputs: [
							{ kind: "source_target", requirement: "required" },
						],
					},
				],
				genericStartCatalogProfileIds: ["source-assurance"],
				defaultProfileIds: {
					full: "source-assurance",
					working_tree: "source-assurance",
					commit: "source-assurance",
					range: "source-assurance",
				},
			});
		if (path === `/api/scans/${scan.id}/findings`)
			return json({ findings: [finding] });
		if (path === `/api/scans/${scan.id}/events`) return json({ events: [] });
		if (path === `/api/scans/${scan.id}/groups`)
			return json({ groups: [], ungroupedFindingIds: [finding.id] });
		if (path === `/api/scans/${scan.id}/reports`)
			return json({ reports: [report] });
		if (path === `/api/scan-reports/${report.id}`)
			return json({ report: { ...report, format: "markdown" } });
		if (path === `/api/scan-reports/${report.id}/viewer-state`)
			return json({ viewerState: { llmCommentSeenAt: null } });
		if (path === `/api/scans/${scan.id}/reviews`)
			return json({ reviews: [] });
		if (path === `/api/scans/${scan.id}/attack-surface`)
			return json({ items: [] });
		if (path === `/api/scans/${scan.id}/security-checks`)
			return json({ results: [] });
		if (path === `/api/scans/${scan.id}/diagnostic-reports`)
			return json({ reports: [] });
		if (path === `/api/scans/${scan.id}/summary`)
			return json({ ok: false }, 404);
		if (path === `/api/scan-reports/${report.id}/download`) {
			return route.fulfill({
				status: 200,
				contentType: "text/markdown",
				body: "# E2E Security Report\n\nRendered report preview.",
			});
		}
		if (path === "/api/scans" && url.searchParams.get("projectId") === project.id)
			return json({ scans: scanDeleted ? [] : [scan] });
		return json({ ok: false, message: `Unhandled E2E route: ${path}` }, 404);
	});

	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scan.id}`);
	await expect(
		page.getByText("Unsafe fixture finding", { exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "レポート MD" }).click();
	await expect(
		page.getByRole("heading", { name: "Markdownレポート", exact: true }),
	).toBeVisible();
	await expect(page.getByLabel("表示するレポート")).toHaveValue(report.id);
	await expect(page.getByText("Rendered report preview.")).toBeVisible();
	const projectFolder = page
		.locator(".workspace-project-select")
		.filter({ hasText: "E2E project" });
	await expect(projectFolder).toHaveAttribute("aria-expanded", "true");
	await projectFolder.click();
	await expect(projectFolder).toHaveAttribute("aria-expanded", "false");
	await expect(
		page.getByRole("button", {
			name: "source-assurance のスキャン履歴を操作",
		}),
	).toHaveCount(0);
	await projectFolder.click();
	await expect(projectFolder).toHaveAttribute("aria-expanded", "true");
	await expect(
		page.getByRole("button", {
			name: "source-assurance のスキャン履歴を操作",
		}),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: "source-assurance のスキャン履歴を操作",
		})
		.click();
	await page.getByRole("menuitem", { name: "履歴を削除" }).click();
	await expect(
		page.getByRole("heading", {
			name: "「source-assurance」のスキャン履歴を削除しますか？",
		}),
	).toBeVisible();
	await page.getByRole("button", { name: "履歴を削除" }).click();
	await expect(page.getByText("スキャン履歴はありません。")).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page);
});

test("real DB standard profile completes without invoking optional Semgrep", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await login(page, adminCredentials);
	const fixtureProjectPath = path.resolve(".tmp/e2e/projects/fixture-project");
	const projectResponse = await page.request.post("/api/projects", {
		data: {
			repoPath: fixtureProjectPath,
			defaultBranch: "main",
			metadata: {},
		},
	});
	expect(projectResponse.status()).toBe(201);
	const project = (await projectResponse.json()).project as {
		id: string;
		repoPath: string;
	};
	expect(project.repoPath).toBe(fixtureProjectPath);
	const scanResponse = await page.request.post(
		`/api/projects/${project.id}/scans`,
		{
			data: {
				profile: "baseline",
				target: { kind: "full" },
				finalReport: true,
			},
		},
	);
	expect(scanResponse.status()).toBe(202);
	const scanId = ((await scanResponse.json()).scan as { id: string }).id;
	await waitForCompletedScan(page, scanId);

	const findingsResponse = await page.request.get(
		`/api/scans/${scanId}/findings`,
	);
	expect(findingsResponse.ok()).toBe(true);
	expect((await findingsResponse.json()).findings).toEqual([]);

	const reportId = await waitForAutomaticReport(page, scanId);
	const reportResponse = await page.request.get(
		`/api/scan-reports/${reportId}/download`,
	);
	expect(reportResponse.ok()).toBe(true);
	expect(await reportResponse.text()).toContain(
		"finding 0 is not a proof of safety",
	);
});

test("Maven Spring MVC WAR is rejected before a runtime scan is queued", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await login(page, adminCredentials);
	const project = await registerFixtureProject(
		page,
		"fixture-project-maven-war",
	);
	await page
		.getByLabel("スキャンプロファイル", { exact: true })
		.selectOption("runtime-passive");
	await page
		.getByLabel(
			"破棄可能なソースsnapshotからローカル対象を起動することに同意します",
		)
		.check();

	let queuedRuntimeScans = 0;
	page.on("request", (request) => {
		if (
			request.method() === "POST" &&
			new URL(request.url()).pathname === `/api/projects/${project.id}/scans`
		) {
			queuedRuntimeScans += 1;
		}
	});
	const preflightResponse = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname ===
				`/api/projects/${project.id}/scans/preflight`,
	);
	await page.getByRole("button", { name: "スキャンを開始" }).click();
	const response = await preflightResponse;
	expect(response.status()).toBe(200);
	const body = (await response.json()) as {
		preflight: {
			status: string;
			limitationCodes: string[];
			checks: Array<{ reasonCode: string | null; status: string }>;
		};
	};
	expect(body.preflight).toMatchObject({
		status: "blocked",
		limitationCodes: expect.arrayContaining([
			"runtime_dependency_adapter_unqualified",
		]),
	});
	expect(body.preflight.checks).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				status: "blocked",
				reasonCode: "runtime_dependency_adapter_unqualified",
			}),
		]),
	);
	await expect(page.locator(".status.error")).toContainText(
		"Maven、Gradle、Python、WAR配備型",
	);
	await expect(page.locator(".status.error")).toContainText(
		"ソースセキュリティ保証",
	);
	await expect(page.locator(".status.error")).toContainText(
		"runtime_dependency_adapter_unqualified",
	);
	await expect.poll(() => queuedRuntimeScans).toBe(0);
});

test("real DB optional Semgrep profile persists a finding and automatic report", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await login(page, adminCredentials);
	const project = await registerFixtureProject(
		page,
		"fixture-project-semgrep",
	);
	await expect(
		page
			.getByLabel("スキャンプロファイル", { exact: true })
			.locator('option[value="source-assurance"]'),
	).toHaveCount(1);
	const scanId = await startProfileScan(page, project.id, "source-assurance");
	await waitForCompletedScan(page, scanId);

	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scanId}`);
	await expect(
		page.getByText("E2E unsafe eval finding", { exact: true }).first(),
	).toBeVisible({ timeout: 15_000 });
	await page
		.getByRole("button", { name: /E2E unsafe eval finding/ })
		.first()
		.click();
	await expect(
		page.getByText("src/example.ts", { exact: false }).first(),
	).toBeVisible();

	const automaticReportId = await waitForAutomaticReport(page, scanId);
	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scanId}`);
	await page.getByRole("tab", { name: "レポート MD" }).click();
	await expect(
		page.getByText("E2E unsafe eval finding", { exact: false }).first(),
	).toBeVisible();

	const [projectsResponse, scansResponse, findingsResponse, reportsResponse] =
		await Promise.all([
			page.request.get("/api/projects"),
			page.request.get(`/api/scans?projectId=${project.id}`),
			page.request.get(`/api/scans/${scanId}/findings`),
			page.request.get(`/api/scans/${scanId}/reports`),
		]);
	for (const response of [
		projectsResponse,
		scansResponse,
		findingsResponse,
		reportsResponse,
	]) {
		expect(response.ok()).toBe(true);
	}
	const projects = (await projectsResponse.json()).projects as Array<{
		id: string;
	}>;
	const scans = (await scansResponse.json()).scans as Array<{
		id: string;
		projectId: string;
	}>;
	const findings = (await findingsResponse.json()).findings as Array<{
		scanRunId: string;
		projectId: string;
		title: string;
	}>;
	const reports = (await reportsResponse.json()).reports as Array<{
		id: string;
		scanRunId: string;
	}>;

	expect(projects.some((item) => item.id === project.id)).toBe(true);
	expect(
		scans.some(
			(item) => item.id === scanId && item.projectId === project.id,
		),
	).toBe(true);
	expect(
		findings.some(
			(item) =>
				item.scanRunId === scanId &&
				item.projectId === project.id &&
				item.title === "E2E unsafe eval finding",
		),
	).toBe(true);
	expect(
		reports.some(
			(item) =>
				item.id === automaticReportId && item.scanRunId === scanId,
		),
	).toBe(true);
	await expectNoSeriousAccessibilityViolations(page);
});
