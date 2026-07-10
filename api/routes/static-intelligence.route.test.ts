import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { StaticIntelligenceAgentQueryResult } from "../../shared/schemas/static-intelligence-agent-query.schema";
import type { StaticIntelligenceExportV1 } from "../../shared/schemas/static-intelligence.schema";
import { HttpError } from "../modules/auth/errors";
import { createStaticIntelligenceRoute } from "./static-intelligence.route";

const now = new Date("2026-07-06T00:00:00.000Z");

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: "p-1",
		ownerUserId: "user-123",
		name: "Project 1",
		repoPath: "/tmp/project-1",
		defaultBranch: "main",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function scan(overrides: Record<string, unknown> = {}) {
	return {
		id: "s-1",
		projectId: "p-1",
		profile: "baseline",
		status: "completed",
		startedAt: now,
		completedAt: now,
		createdByUserId: "user-123",
		summary: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function exportPayload(
	overrides: Partial<StaticIntelligenceExportV1> = {},
): StaticIntelligenceExportV1 {
	return {
		version: "v1",
		generatedAt: now.toISOString(),
		project: { id: "p-1", name: "Project 1" },
		scan: {
			id: "s-1",
			profile: "baseline",
			status: "completed",
			startedAt: now.toISOString(),
			completedAt: now.toISOString(),
			findingCount: 1,
			toolRunCount: 1,
			artifactCount: 1,
			reviewStatus: "missing",
		},
		scanSummary: {
			riskBand: "high",
			evidenceQuality: "strong",
			degradedReasons: [],
		},
		fileRiskIndex: [
			{
				path: "src/app.ts",
				findingCount: 1,
				maxSeverity: "high",
				evidenceQuality: "strong",
				scanners: ["semgrep"],
				ruleIds: ["rule-1"],
				findingIds: ["f-1"],
				evidenceRefs: ["evidence:f-1"],
				artifactRefs: ["artifact:a-1"],
				verificationRefs: [],
				latestScanRunId: "s-1",
				latestSeenAt: now.toISOString(),
			},
		],
		graph: {
			nodes: [
				{ id: "project:p-1", kind: "project", label: "Project 1" },
				{
					id: "finding:f-1",
					kind: "finding",
					label: "Finding 1",
					severity: "high",
				},
			],
			edges: [
				{
					id: "project:p-1->finding:f-1",
					from: "project:p-1",
					to: "finding:f-1",
					kind: "related_to",
					confidence: 1,
					evidenceRefs: [],
				},
			],
		},
		...overrides,
	};
}

function agentResult(): StaticIntelligenceAgentQueryResult {
	return {
		ok: true,
		status: "completed",
		version: "v1",
		generatedAt: now.toISOString(),
		scanRunId: "s-1",
		queryKind: "project_overview",
		summary: {
			title: "Static intelligence overview",
			body: "Candidate-only overview.",
			candidateOnly: true,
		},
		refs: {
			findingIds: [],
			evidenceRefs: [],
			artifactRefs: [],
			fileRefs: [],
			sourceRefs: ["scan:s-1"],
		},
		results: [],
		bundles: {},
		degradedReasons: [],
	};
}

function readiness(item: Record<string, unknown>) {
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

function buildApp(options: {
	projects?: Record<string, any>;
	scans?: Record<string, any>;
	scansForProject?: any[];
	buildExport?: (
		db: unknown,
		scanRunId: string,
	) => Promise<StaticIntelligenceExportV1>;
	runAgentQuery?: ReturnType<typeof vi.fn>;
	readResolver?: any;
	buildGeneration?: ReturnType<typeof vi.fn>;
}) {
	const projectRepository = {
		findById: vi.fn(async (id: string) => options.projects?.[id] ?? null),
	};
	const scanRepository = {
		findById: vi.fn(async (id: string) => options.scans?.[id] ?? null),
		listScanRunsByProject: vi.fn(async () => options.scansForProject ?? []),
	};
	const available = {
		status: "available",
		reasonCodes: [],
		generationId: "00000000-0000-4000-8000-000000000010",
	};
	const missing = { status: "missing", reasonCodes: ["generation_missing"] };
	const defaultResolver = {
		listSummaries: vi.fn(async () => []),
		resolveView: vi.fn(async ({ project: selectedProject }: any) => {
			const selectedScan = options.scansForProject?.at(-1) ?? null;
			const payload =
				selectedScan && options.buildExport
					? await options.buildExport({}, selectedScan.id)
					: null;
			return {
				project: selectedProject,
				latestUsableScan: selectedScan,
				selectedScan,
				selection: {
					requestedScanRunId: null,
					selectedScanRunId: selectedScan?.id ?? null,
					isLatest: true,
					selectionReason: selectedScan ? "latest_completed" : "none",
				},
				generation: payload
					? { generationId: available.generationId, status: "available" }
					: null,
				export: payload,
				readiness: readiness(payload ? available : missing),
				degradedReasons: payload ? [] : ["generation_missing"],
			};
		}),
		resolveGeneration: vi.fn(async () => {
			const payload = options.buildExport
				? await options.buildExport({}, "s-1")
				: exportPayload();
			return {
				generationId: available.generationId,
				export: { payload },
			};
		}),
	};
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", {
			userId: "user-123",
			email: "user@example.com",
			role: "member",
		});
		await next();
	});
	app.onError((err, c) => {
		if (err instanceof HttpError) {
			return c.json({ message: err.message }, err.status as any);
		}
		return c.json({ message: err instanceof Error ? err.message : "error" }, 500);
	});
	app.route(
		"/api",
		createStaticIntelligenceRoute({
			db: {} as any,
			projectRepository: projectRepository as any,
			scanRepository: scanRepository as any,
			runAgentQuery: options.runAgentQuery as any,
			readResolver: (options.readResolver ?? defaultResolver) as any,
			buildGeneration: options.buildGeneration as any,
		}),
	);
	return { app, projectRepository, scanRepository };
}

describe("Static Intelligence Route", () => {
	it("returns project intelligence overview for the latest scan", async () => {
		const buildExport = vi.fn(async () => exportPayload());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scansForProject: [
				scan({ id: "s-old", completedAt: new Date("2026-07-05T00:00:00Z") }),
				scan({ id: "s-1", completedAt: now }),
			],
			buildExport,
		});

		const res = await app.request("/api/projects/p-1/intelligence");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.selectedScan.id).toBe("s-1");
		expect(body.export.scan.id).toBe("s-1");
		expect(body.readiness).toMatchObject({
			export: { status: "available" },
			fileRiskIndex: { status: "available" },
			evidenceGraph: { status: "available" },
		});
		expect(buildExport).toHaveBeenCalledWith({}, "s-1");
	});

	it("returns missing availability when a project has no scans", async () => {
		const buildExport = vi.fn(async () => exportPayload());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scansForProject: [],
			buildExport,
		});

		const res = await app.request("/api/projects/p-1/intelligence");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.selectedScan).toBeNull();
		expect(body.export).toBeNull();
		expect(body.readiness.export.status).toBe("missing");
		expect(body.degradedReasons).toContain("generation_missing");
		expect(buildExport).not.toHaveBeenCalled();
	});

	it("rejects project intelligence for another user's project", async () => {
		const { app } = buildApp({
			projects: { "p-1": project({ ownerUserId: "other-user" }) },
		});

		const res = await app.request("/api/projects/p-1/intelligence");
		expect(res.status).toBe(403);
	});

	it("returns scan export only after scan ownership is verified", async () => {
		const buildExport = vi.fn(async () => exportPayload());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scans: { "s-1": scan() },
			buildExport,
		});

		const res = await app.request("/api/scans/s-1/intelligence/export");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.export.scan.id).toBe("s-1");
	});

	it("maps agent query modes without accepting browser filesystem paths", async () => {
		const runAgentQuery = vi.fn(async () => agentResult());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scans: { "s-1": scan() },
			runAgentQuery,
		});

		const res = await app.request(
			"/api/scans/s-1/intelligence/agent-query?mode=verification",
		);
		expect(res.status).toBe(200);
		expect(runAgentQuery).toHaveBeenCalledWith({
			db: {},
			input: { scanRunId: "s-1", queryKind: "verification_commands" },
			exportPayload: expect.objectContaining({ version: "v1" }),
		});
	});

	it("pins agent reads to the requested persisted generation", async () => {
		const generationId = "00000000-0000-4000-8000-000000000020";
		const resolveGeneration = vi.fn(async () => ({
			generationId,
			export: { payload: exportPayload() },
		}));
		const runAgentQuery = vi.fn(async () => agentResult());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scans: { "s-1": scan() },
			runAgentQuery,
			readResolver: {
				listSummaries: vi.fn(async () => []),
				resolveGeneration,
			},
		});

		const res = await app.request(
			`/api/scans/s-1/intelligence/agent-query?mode=overview&generationId=${generationId}`,
		);
		expect(res.status).toBe(200);
		expect(resolveGeneration).toHaveBeenCalledWith("s-1", generationId);
	});

	it("requires findingId for evidence bundle previews", async () => {
		const runAgentQuery = vi.fn(async () => agentResult());
		const { app } = buildApp({
			projects: { "p-1": project() },
			scans: { "s-1": scan() },
			runAgentQuery,
		});

		const res = await app.request(
			"/api/scans/s-1/intelligence/agent-query?mode=evidence",
		);
		expect(res.status).toBe(400);
		expect(runAgentQuery).not.toHaveBeenCalled();
	});

	it("returns one selected persisted view for the requested scan", async () => {
		const resolveView = vi.fn(async () => ({
			project: project(),
			latestUsableScan: scan(),
			selectedScan: scan(),
			selection: { requestedScanRunId: "s-1", selectedScanRunId: "s-1", isLatest: true, selectionReason: "requested" },
			generation: null,
			export: null,
			readiness: {},
			degradedReasons: [],
		}));
		const { app } = buildApp({
			projects: { "p-1": project() },
			readResolver: { resolveView, listSummaries: vi.fn() },
		});
		const res = await app.request("/api/projects/p-1/intelligence?scanRunId=s-1");
		expect(res.status).toBe(200);
		expect(resolveView).toHaveBeenCalledTimes(1);
		expect(resolveView).toHaveBeenCalledWith(expect.objectContaining({ requestedScanRunId: "s-1" }));
	});

	it("rejects refresh when the scan does not belong to the route project", async () => {
		const buildGeneration = vi.fn();
		const { app } = buildApp({
			projects: { "p-1": project() },
			scans: { "s-2": scan({ id: "s-2", projectId: "p-2" }) },
			readResolver: { listSummaries: vi.fn(), resolveView: vi.fn() },
			buildGeneration,
		});
		const res = await app.request("/api/projects/p-1/intelligence/refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ scanRunId: "s-2" }),
		});
		expect(res.status).toBe(404);
		expect(buildGeneration).not.toHaveBeenCalled();
	});
});
