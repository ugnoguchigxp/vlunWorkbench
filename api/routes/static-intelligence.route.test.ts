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

function buildApp(options: {
	projects?: Record<string, any>;
	scans?: Record<string, any>;
	scansForProject?: any[];
	buildExport?: ReturnType<typeof vi.fn>;
	runAgentQuery?: ReturnType<typeof vi.fn>;
}) {
	const projectRepository = {
		findById: vi.fn(async (id: string) => options.projects?.[id] ?? null),
	};
	const scanRepository = {
		findById: vi.fn(async (id: string) => options.scans?.[id] ?? null),
		listScanRunsByProject: vi.fn(async () => options.scansForProject ?? []),
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
			buildExport: options.buildExport as any,
			runAgentQuery: options.runAgentQuery as any,
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
		expect(body.latestScan.id).toBe("s-1");
		expect(body.latestExport.scan.id).toBe("s-1");
		expect(body.availability).toMatchObject({
			export: "available",
			fileRiskIndex: "available",
			evidenceGraph: "available",
			codeStructure: "missing",
			agentBundle: "available",
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
		expect(body.latestScan).toBeNull();
		expect(body.latestExport).toBeNull();
		expect(body.availability.export).toBe("missing");
		expect(body.degradedReasons).toContain("project has no scan runs");
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
		});
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
});
