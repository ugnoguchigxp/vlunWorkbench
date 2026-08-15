import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../app/env";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	integrationPreviews,
	scanArtifacts,
	scanReports,
	scanRuns,
	users,
} from "../../../db/schema";
import { IntegrationClientService } from "../../integrationClients/integration-client.service";
import { ArtifactStorage } from "../../scans/artifact-storage";
import { ScanReportRepository } from "../../scans/report-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../../scans/repositories";
import { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";
import { NightworkersIntegrationService } from "./nightworkers-integration.service";

async function runGit(cwd: string, args: string[]): Promise<void> {
	const process = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		process.exited,
		new Response(process.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`git ${args[0]} failed: ${stderr}`);
	}
}

describe("NightworkersIntegrationService", () => {
	let connection: DbConnection;
	let root: string;
	let projectPath: string;
	let artifactRoot: string;
	let projectId: string;
	let client: Awaited<ReturnType<IntegrationClientService["authenticate"]>>;
	let integrationRepository: NightworkersIntegrationRepository;
	let scanRepository: ScanRepository;
	let findingRepository: FindingRepository;
	let reportRepository: ScanReportRepository;
	let artifactRepository: ArtifactRepository;
	let launch: ReturnType<typeof vi.fn>;
	let enqueue: ReturnType<typeof vi.fn>;
	let service: NightworkersIntegrationService;
	let dependencies: ConstructorParameters<typeof NightworkersIntegrationService>[0];

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDirectory)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
			);
		}

		root = await fs.mkdtemp(
			path.join(os.tmpdir(), "vulnworkbench-nightworkers-service-"),
		);
		root = await fs.realpath(root);
		projectPath = path.join(root, "repository");
		artifactRoot = path.join(root, "artifacts");
		await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
		await fs.writeFile(
			path.join(projectPath, "package.json"),
			'{"name":"nightworkers-fixture","dependencies":{"lodash":"4.17.20"}}\n',
		);
		await fs.writeFile(
			path.join(projectPath, "src", "index.ts"),
			"export const value = 1;\n",
		);
		await runGit(projectPath, ["init", "-q"]);
		await runGit(projectPath, ["config", "user.email", "test@example.com"]);
		await runGit(projectPath, ["config", "user.name", "Test"]);
		await runGit(projectPath, ["add", "."]);
		await runGit(projectPath, ["commit", "-qm", "initial"]);
		await fs.writeFile(
			path.join(projectPath, "src", "index.ts"),
			"export const value = process.env.API_KEY;\n",
		);

		const now = new Date("2026-07-30T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "nightworkers-service@example.com",
				passwordHash: "hash",
				displayName: "NightWorkers service",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const projectRepository = new ProjectRepository(connection.db);
		const project = await projectRepository.createProject({
			ownerUserId: owner.id,
			name: "NightWorkers fixture",
			repoPath: projectPath,
			canonicalRepoPath: projectPath,
		});
		projectId = project.id;
		const integrationClientService = new IntegrationClientService(
			connection.db,
		);
		const credential = await integrationClientService.create({
			name: "nightworkers-test",
			ownerUserId: owner.id,
			scopes: [
				"nightworkers:security-scan:read",
				"nightworkers:security-scan:write",
				"nightworkers:security-report:read",
				"nightworkers:security-report:write",
			],
			allowedRoots: [root],
		});
		client = await integrationClientService.authenticate(credential.token);

		integrationRepository = new NightworkersIntegrationRepository(
			connection.db,
		);
		scanRepository = new ScanRepository(connection.db);
		findingRepository = new FindingRepository(connection.db);
		reportRepository = new ScanReportRepository(connection.db);
		artifactRepository = new ArtifactRepository(connection.db);
		launch = vi.fn(async () => undefined);
		enqueue = vi.fn(async () => ({
			reportId: "queued",
			status: "completed" as const,
		}));
		const env = {
			nodeEnv: "test",
			nightworkersIntegrationAutoCreateProjects: false,
			nightworkersIntegrationAllowedProfiles: [
				"source-baseline",
				"diff-source-baseline",
				"diff-basic-security",
				"basic-security",
				"detailed-security",
			],
			nightworkersIntegrationPreviewTtlSeconds: 300,
			nightworkersIntegrationIdempotencyTtlHours: 168,
			nightworkersIntegrationMaxConcurrentScans: 8,
			nightworkersIntegrationMaxFindingPageSize: 1,
			nightworkersIntegrationMaxEventPageSize: 1,
			nightworkersIntegrationMaxReportBytes: 5 * 1024 * 1024,
			allowHostScannerExecution: true,
			scanExecutionMode: "host",
		} as AppEnv;
		dependencies = {
			db: connection.db,
			env,
			projectRepository,
			scanRepository,
			findingRepository,
			reportRepository,
			artifactRepository,
			artifactStorage: new ArtifactStorage(artifactRoot),
			reportRunner: { enqueue } as never,
			integrationRepository,
			scanSupervisor: {
				launch,
				cancel: vi.fn(async () => ({ cancelled: true })),
			} as never,
		};
		service = new NightworkersIntegrationService(dependencies);
	});

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("reports default capabilities and resolves a full-snapshot preview", async () => {
		const defaultEnv = { ...dependencies.env };
		for (const key of [
			"nightworkersIntegrationAllowedProfiles",
			"nightworkersIntegrationMaxConcurrentScans",
			"nightworkersIntegrationMaxFindingPageSize",
			"nightworkersIntegrationMaxEventPageSize",
			"nightworkersIntegrationMaxReportBytes",
			"nightworkersIntegrationPreviewTtlSeconds",
		] as const) {
			Reflect.deleteProperty(defaultEnv, key);
		}
		const defaultService = new NightworkersIntegrationService({
			...dependencies,
			env: defaultEnv,
		});

		const capabilities = await defaultService.capabilities(client, projectPath);
		expect(capabilities).toMatchObject({
			provider: { id: "vulnworkbench", version: "1.0.0" },
			project: { ref: projectId },
			limits: {
				maxConcurrentScansForClient: 2,
				maxFindingPageSize: 100,
				maxEventPageSize: 200,
				maxReportBytes: 5 * 1024 * 1024,
			},
		});
		expect(capabilities.presets.length).toBeGreaterThan(0);
		expect(capabilities.selectableProfiles.length).toBeGreaterThan(0);

		const preview = await defaultService.preview(client, {
			projectPath,
			selection: { mode: "preset", presetId: "standard" },
			target: { kind: "full" },
		});
		expect(preview).toMatchObject({
			resolvedProfileRef: "basic-security",
			target: {
				kind: "full",
				fileCount: null,
			},
		});
		expect(preview.warnings).toContain(
			"未コミットの変更を含む現在のsnapshotを検査します。",
		);
	});

	it("keeps preview side-effect free and creates one persistent scan across concurrent retries and restart", async () => {
		const preview = await service.preview(client, {
			projectPath,
			selection: { mode: "preset", presetId: "standard" },
			target: { kind: "working_tree" },
		});
		expect(preview.resolvedProfileRef).toBe("diff-basic-security");
		expect(preview.target.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(0);
		expect(await connection.db.select().from(scanArtifacts)).toHaveLength(0);

		const request = {
			projectPath,
			selection: { mode: "preset" as const, presetId: "standard" as const },
			target: { kind: "working_tree" as const },
			previewRef: preview.previewRef,
			expectedTargetDigest: preview.target.digest,
		};
		const idempotencyKey = "11111111-1111-4111-8111-111111111111";
		const results = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				service.startScan({
					client,
					request,
					idempotencyKey,
					requestId: `request-${index}`,
				}),
			),
		);
		expect(new Set(results.map((result) => result.scanRunRef)).size).toBe(1);
		expect(results.filter((result) => !result.replayed)).toHaveLength(1);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(1);
		expect(launch).toHaveBeenCalled();

		await fs.writeFile(
			path.join(projectPath, "src", "index.ts"),
			"export const value = process.env.DIFFERENT_SECRET;\n",
		);
		await expect(
			service.startScan({
				client,
				request,
				idempotencyKey: "22222222-2222-4222-8222-222222222222",
			}),
		).rejects.toMatchObject({ code: "target_digest_mismatch" });
		expect(await connection.db.select().from(scanRuns)).toHaveLength(1);

		await connection.db
			.update(integrationPreviews)
			.set({ expiresAt: new Date(Date.now() - 1_000) })
			.where(eq(integrationPreviews.id, preview.previewRef));
		const restarted = new NightworkersIntegrationService(dependencies);
		const replay = await restarted.startScan({
			client,
			request,
			idempotencyKey,
			requestId: "after-restart",
		});
		expect(replay).toMatchObject({
			scanRunRef: results[0].scanRunRef,
			replayed: true,
		});
		expect(launch).toHaveBeenCalled();
	});

	it("projects bounded events/findings safely and reports incomplete zero-finding coverage", async () => {
		const preview = await service.preview(client, {
			projectPath,
			selection: { mode: "preset", presetId: "standard" },
			target: { kind: "working_tree" },
		});
		const started = await service.startScan({
			client,
			request: {
				projectPath,
				selection: { mode: "preset", presetId: "standard" },
				target: { kind: "working_tree" },
				previewRef: preview.previewRef,
				expectedTargetDigest: preview.target.digest,
			},
			idempotencyKey: "33333333-3333-4333-8333-333333333333",
		});
		const scan = await scanRepository.findById(started.scanRunRef);
		await scanRepository.updateScanRunStatus(started.scanRunRef, "completed", {
			metadata: {
				...(scan?.metadata ?? {}),
				stepOrder: ["semgrep", "gitleaks", "osv", "trivy"],
				stepResults: [
					{
						stepId: "osv",
						kind: "static_tool",
						toolId: "osv",
						coverageEffect: "gap",
						reasonCode: "runtime_not_configured",
					},
				],
			},
		});
		const completedDetail = await service.scanDetail(
			client,
			started.scanRunRef,
		);
		expect(completedDetail).toMatchObject({
			status: "completed",
			outcome: "inconclusive",
			summary: {
				findingCount: 0,
			},
		});
		expect(completedDetail.summary?.coverage.gaps).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: "runtime_not_configured" }),
				]),
		);

		await scanRepository.createScanEvent({
			scanRunId: started.scanRunRef,
			level: "error",
			eventType: "tool.failed",
			message: `secret=do-not-return path=${projectPath}`,
			data: { stdout: "do-not-return", stepRef: "gitleaks" },
		});
		const firstEvents = await service.events(client, started.scanRunRef, 0, 100);
		expect(firstEvents.items).toHaveLength(1);
		expect(firstEvents.hasMore).toBe(true);
		expect(JSON.stringify(firstEvents)).not.toContain("do-not-return");
		const secondEvents = await service.events(
			client,
			started.scanRunRef,
			firstEvents.nextAfterSeq,
			100,
		);
		expect(secondEvents.items[0]).toMatchObject({
			type: "tool.failed",
			message: "A scan tool updated its status.",
			stepRef: "gitleaks",
		});

		const secretFinding = await findingRepository.createFinding({
			scanRunId: started.scanRunRef,
			projectId,
			sourceTool: "gitleaks",
			ruleId: "generic-api-key",
				title: "Hardcoded API key: super-secret-value",
				description: "A credential super-secret-value is embedded in source.",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: {
				path: path.join(projectPath, "src", "index.ts"),
				startLine: 1,
			},
			fingerprint: "secret-finding",
			metadata: {
				category: "secret",
				references: [
					"https://example.com/security",
					"https://user:secret@example.com/private",
					"file:///etc/passwd",
					"javascript:alert(1)",
				],
			},
		});
		await findingRepository.createEvidence({
			findingId: secretFinding.id,
			kind: "tool-output",
			title: "Secret evidence",
			artifactId: null,
			location: null,
			snippet: "API_KEY=super-secret-value",
		});
		await findingRepository.createFinding({
			scanRunId: started.scanRunRef,
			projectId,
			sourceTool: "semgrep",
			ruleId: "ts.unsafe",
			title: "Unsafe pattern",
			description: "Unsafe source pattern.",
			severity: "medium",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/../../outside.ts", startLine: 2 },
			fingerprint: "source-finding",
		});

		const firstFindings = await service.findings({
			client,
			scanRunId: started.scanRunRef,
			limit: 100,
		});
		expect(firstFindings.items).toHaveLength(1);
		expect(firstFindings.nextCursor).not.toBeNull();
		const secondFindings = await service.findings({
			client,
			scanRunId: started.scanRunRef,
			cursor: firstFindings.nextCursor ?? undefined,
			limit: 100,
		});
		expect(secondFindings.items).toHaveLength(1);
		const projectedSecret = [...firstFindings.items, ...secondFindings.items].find(
			(finding) => finding.tool === "gitleaks",
			);
			expect(projectedSecret).toMatchObject({
				title: "Potential secret detected",
				description:
					"A potential secret was detected; sensitive match content was redacted.",
				location: { path: "src/index.ts", startLine: 1 },
				evidence: "[REDACTED: secret finding evidence]",
			references: ["https://example.com/security"],
		});
		expect(JSON.stringify(projectedSecret)).not.toContain("super-secret-value");
		const projectedSource = [
			...firstFindings.items,
			...secondFindings.items,
		].find((finding) => finding.tool === "semgrep");
		expect(projectedSource?.location.path).toBeNull();
		expect(JSON.stringify(projectedSecret)).not.toContain("user:secret");

		await expect(
			service.findings({
				client,
				scanRunId: started.scanRunRef,
				cursor: `${firstFindings.nextCursor}tampered`,
				limit: 1,
			}),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("creates one asynchronous report per idempotency key and replays after credential rotation", async () => {
		const preview = await service.preview(client, {
			projectPath,
			selection: { mode: "preset", presetId: "quick" },
			target: { kind: "working_tree" },
		});
		const scan = await service.startScan({
			client,
			request: {
				projectPath,
				selection: { mode: "preset", presetId: "quick" },
				target: { kind: "working_tree" },
				previewRef: preview.previewRef,
				expectedTargetDigest: preview.target.digest,
			},
			idempotencyKey: "44444444-4444-4444-8444-444444444444",
		});
		await scanRepository.updateScanRunStatus(scan.scanRunRef, "completed");
		const idempotencyKey = "55555555-5555-4555-8555-555555555555";
		const reports = await Promise.all(
			Array.from({ length: 5 }, () =>
				service.startReport({
					client,
					scanRunId: scan.scanRunRef,
					idempotencyKey,
				}),
			),
		);
		expect(
			new Set(reports.map((result) => result.report.reportRef)).size,
		).toBe(1);
		expect(reports.filter((result) => !result.replayed)).toHaveLength(1);
		expect(await connection.db.select().from(scanReports)).toHaveLength(1);
		expect(enqueue).toHaveBeenCalledTimes(1);

		const rotatedClient = { ...client, tokenHash: "f".repeat(64) };
		const replay = await new NightworkersIntegrationService(
			dependencies,
		).startReport({
			client: rotatedClient,
			scanRunId: scan.scanRunRef,
			idempotencyKey,
			requestId: "rotated-token",
		});
		expect(replay.replayed).toBe(true);
		expect(replay.report.reportRef).toBe(reports[0].report.reportRef);
		expect(enqueue).toHaveBeenCalledTimes(1);

		const reportId = reports[0].report.reportRef;
		const saved = await dependencies.artifactStorage.saveTextArtifact(
			scan.scanRunRef,
			"reports",
			"report",
			`${reportId}.md`,
		);
		const artifact = await artifactRepository.createArtifact({
			scanRunId: scan.scanRunRef,
			toolRunId: null,
			kind: "report",
			format: "markdown",
			path: saved.path,
			sha256: saved.sha256,
			sizeBytes: saved.sizeBytes,
			metadata: { reportId },
		});
		await reportRepository.updateReportStatus(reportId, "completed", {
			artifactId: artifact.id,
		});
		const boundedService = new NightworkersIntegrationService({
			...dependencies,
			env: {
				...dependencies.env,
				nightworkersIntegrationMaxReportBytes: 8,
			},
		});
		expect(
			await boundedService.reportContent(client, scan.scanRunRef, reportId),
		).toMatchObject({ content: "report" });

		await fs.writeFile(path.resolve(artifactRoot, saved.path), "123456789");
		await expect(
			boundedService.reportContent(client, scan.scanRunRef, reportId),
		).rejects.toMatchObject({ code: "report_too_large" });
		await fs.rm(path.resolve(artifactRoot, saved.path));
		await expect(
			boundedService.reportContent(client, scan.scanRunRef, reportId),
		).rejects.toMatchObject({ code: "provider_temporarily_unavailable" });
	});
});
