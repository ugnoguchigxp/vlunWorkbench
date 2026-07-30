import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import path from "node:path";

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

test("project path and member/admin boundaries hold through a browser session", async ({
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
		data: { repoPath: "/", defaultBranch: "main", metadata: {} },
	});
	expect(rejectedProject.status()).toBe(403);
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
	await expect(page.getByRole("heading", { name: "System Context" })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "LLM Providers" }),
	).toHaveCount(0);
	await expectNoSeriousAccessibilityViolations(page);
});

test("mocked completed scan results and Markdown report preview render", async ({
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
		profile: "baseline",
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
		reportMode: "deterministic",
		options: {},
		artifactId: "artifact-e2e",
		errorMessage: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};

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
		if (path === "/api/projects") return json({ projects: [project] });
		if (path === "/api/scan-profiles")
			return json({
				profiles: [
					{
						id: "baseline",
						name: "Baseline",
						description: "E2E profile",
						tools: [],
						steps: [],
					},
				],
			});
		if (path === `/api/scans/${scan.id}/findings`)
			return json({ findings: [finding] });
		if (path === `/api/scans/${scan.id}/events`) return json({ events: [] });
		if (path === `/api/scans/${scan.id}/groups`)
			return json({ groups: [], ungroupedFindingIds: [finding.id] });
		if (path === `/api/scans/${scan.id}/reports`)
			return json({ reports: [report] });
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
			return json({ scans: [scan] });
		return json({ ok: false, message: `Unhandled E2E route: ${path}` }, 404);
	});

	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scan.id}`);
	await expect(
		page.getByText("Unsafe fixture finding", { exact: true }),
	).toBeVisible();
	await page.getByRole("tab", { name: "レポート MD" }).click();
	await expect(page.getByText("E2E Security Report", { exact: false })).toBeVisible();
	await expect(page.getByText("Rendered report preview.")).toBeVisible();
	await expectNoSeriousAccessibilityViolations(page);
});

test("real DB flow registers a project, scans, shows a finding, and generates a report", async ({
	page,
}) => {
	test.setTimeout(60_000);
	await login(page, adminCredentials);
	await page.goto("/scans");

	const fixtureProjectPath = path.resolve(
		".tmp/e2e/projects/allowed-project",
	);
	await page.getByRole("button", { name: "新規プロジェクト" }).click();
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

	await page.getByLabel("スキャンプロファイル").selectOption("baseline");
	const scanResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname ===
				`/api/projects/${project.id}/scans`,
	);
	await page.getByRole("button", { name: "スキャンを開始" }).click();
	const scanResponse = await scanResponsePromise;
	expect(scanResponse.status()).toBe(202);
	const scan = (await scanResponse.json()).scan as { id: string };

	await expect
		.poll(
			async () => {
				const response = await page.request.get(`/api/scans/${scan.id}`);
				if (!response.ok()) return `http-${response.status()}`;
				return ((await response.json()).scan as { status: string }).status;
			},
			{ timeout: 30_000 },
			)
			.toBe("completed");

	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scan.id}`);
	await expect(
		page.getByText("E2E unsafe eval finding", { exact: true }).first(),
	).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByText("src/example.ts", { exact: false }).first(),
	).toBeVisible();

	const reportButton = page.getByRole("button", {
		name: /^(提出用レポート|内部レビュー用ドラフト|レビュー用ドラフト)を生成$/,
	});
	const reportResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === `/api/scans/${scan.id}/reports`,
	);
	await reportButton.click();
	const reportResponse = await reportResponsePromise;
	expect(reportResponse.status()).toBe(202);
	const generatedReport = (await reportResponse.json()).report as { id: string };

	await expect
		.poll(async () => {
			const response = await page.request.get(
				`/api/scans/${scan.id}/reports`,
			);
			if (!response.ok()) return `http-${response.status()}`;
			const reports = (await response.json()).reports as Array<{
				id: string;
				status: string;
			}>;
			return reports.find((report) => report.id === generatedReport.id)?.status;
		})
		.toBe("completed");
	await page.goto(`/scans?projectId=${project.id}&scanRunId=${scan.id}`);
	await page.getByRole("tab", { name: "レポート MD" }).click();
	await expect(
		page.getByText("E2E unsafe eval finding", { exact: false }).first(),
	).toBeVisible();

	const [projectsResponse, scansResponse, findingsResponse, reportsResponse] =
		await Promise.all([
			page.request.get("/api/projects"),
			page.request.get(`/api/scans?projectId=${project.id}`),
			page.request.get(`/api/scans/${scan.id}/findings`),
			page.request.get(`/api/scans/${scan.id}/reports`),
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
			(item) => item.id === scan.id && item.projectId === project.id,
		),
	).toBe(true);
	expect(
		findings.some(
			(item) =>
				item.scanRunId === scan.id &&
				item.projectId === project.id &&
				item.title === "E2E unsafe eval finding",
		),
	).toBe(true);
	expect(
		reports.some(
			(item) =>
				item.id === generatedReport.id && item.scanRunId === scan.id,
		),
	).toBe(true);
	await expectNoSeriousAccessibilityViolations(page);
});
