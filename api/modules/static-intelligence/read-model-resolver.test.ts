import { describe, expect, it, vi } from "vitest";
import {
	StaticIntelligenceReadModelResolver,
	StaticIntelligenceSelectionNotFoundError,
	classifySemanticIndexReadiness,
} from "./read-model-resolver";

const now = new Date("2026-07-10T00:00:00.000Z");
const project = { id: "p-1", ownerUserId: "u-1", repoPath: "/tmp/project", name: "Project", defaultBranch: "main", metadata: {}, createdAt: now, updatedAt: now } as any;
const scan = (id: string, status: string, projectId = "p-1", offset = 0) => ({ id, projectId, profile: "baseline", status, startedAt: now, completedAt: new Date(now.getTime() + offset), createdByUserId: "u-1", summary: null, metadata: {}, createdAt: new Date(now.getTime() + offset), updatedAt: now });

describe("Static Intelligence read model resolver", () => {
	it("excludes temporary projects from UI summaries", async () => {
		const normalProject = {
			...project,
			id: "p-normal",
			name: "todolist",
			repoPath: "/Users/test/todolist",
		};
		const resolver = new StaticIntelligenceReadModelResolver(
			{} as any,
			{
				listProjects: vi.fn(async () => [
					normalProject,
					project,
					{ ...project, id: "p-private-tmp", repoPath: "/private/tmp/case" },
				]),
				findById: vi.fn(),
			} as any,
			{
				listScanRunsByProject: vi.fn(async () => []),
				findById: vi.fn(),
			} as any,
		);

		const summaries = await resolver.listSummaries("u-1");

		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.project.repositoryName).toBe("todolist");
	});

	it("distinguishes missing, stale, partial, and current semantic indexes", () => {
		const sources = [
			{ sourceKind: "finding", sourceId: "one", contentHash: "new-one" },
			{ sourceKind: "finding", sourceId: "two", contentHash: "new-two" },
		];
		expect(classifySemanticIndexReadiness(sources, [])).toMatchObject({ status: "missing" });
		expect(
			classifySemanticIndexReadiness(sources, [
				{ ...sources[0]!, contentHash: "old-one", embedding: new Uint8Array([1]) },
			]),
		).toMatchObject({ status: "stale" });
		expect(
			classifySemanticIndexReadiness(sources, [
				{ ...sources[0]!, embedding: new Uint8Array([1]) },
			]),
		).toMatchObject({ status: "degraded" });
		expect(
			classifySemanticIndexReadiness(
				sources,
				sources.map((source) => ({ ...source, embedding: new Uint8Array([1]) })),
			),
		).toMatchObject({ status: "available" });
	});

	it("prefers the latest completed scan over a newer failed scan", async () => {
		const scans = [scan("failed-new", "failed", "p-1", 2000), scan("completed", "completed", "p-1", 1000)];
		const resolver = new StaticIntelligenceReadModelResolver(
			{} as any,
			{ listProjects: vi.fn(), findById: vi.fn() } as any,
			{ listScanRunsByProject: vi.fn(async () => scans), findById: vi.fn() } as any,
			{
				loadLatestValidGeneration: vi.fn(async () => null),
				hasDerivedArtifacts: vi.fn(async () => false),
			} as any,
		);
		const view = await resolver.resolveView({ project, probeFilesystem: false });
		expect(view.selectedScan?.id).toBe("completed");
		expect(view.selection.selectionReason).toBe("latest_completed");
		expect(view.readiness.export.status).toBe("missing");
		expect(view.project.repositoryName).toBe("project");
		expect(JSON.stringify(view)).not.toContain("/tmp/project");
		expect(JSON.stringify(view)).not.toContain("ownerUserId");
	});

	it("marks an unusable persisted generation as failed instead of missing", async () => {
		const completed = scan("completed", "completed");
		const resolver = new StaticIntelligenceReadModelResolver(
			{} as any,
			{} as any,
			{
				listScanRunsByProject: vi.fn(async () => [completed]),
				findById: vi.fn(),
			} as any,
			{
				loadLatestValidGeneration: vi.fn(async () => null),
				hasDerivedArtifacts: vi.fn(async () => true),
			} as any,
		);
		const view = await resolver.resolveView({ project, probeFilesystem: false });
		expect(view.readiness.export).toEqual({
			status: "failed",
			reasonCodes: ["generation_invalid"],
		});
	});

	it("does not select an empty terminal scan as the default", async () => {
		const failed = scan("failed", "failed");
		const sources = {
			loadSourceBundle: vi.fn(async () => ({
				findings: [],
				artifacts: [],
				latestReview: null,
			})),
		};
		const resolver = new StaticIntelligenceReadModelResolver(
			{} as any,
			{} as any,
			{
				listScanRunsByProject: vi.fn(async () => [failed]),
				findById: vi.fn(),
			} as any,
			{} as any,
			sources as any,
		);
		const view = await resolver.resolveView({ project, probeFilesystem: false });
		expect(view.selectedScan).toBeNull();
		expect(view.selection.selectionReason).toBe("none");
	});

	it("returns a not-found boundary for a scan from another project", async () => {
		const resolver = new StaticIntelligenceReadModelResolver(
			{} as any,
			{} as any,
			{
				listScanRunsByProject: vi.fn(async () => []),
				findById: vi.fn(async () => scan("foreign", "completed", "p-2")),
			} as any,
			{} as any,
		);
		await expect(
			resolver.resolveView({ project, requestedScanRunId: "foreign" }),
		).rejects.toBeInstanceOf(StaticIntelligenceSelectionNotFoundError);
	});
});
