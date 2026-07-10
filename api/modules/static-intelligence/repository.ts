import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
} from "../../db/schema";
import { isStaticIntelligenceDerivedArtifact } from "./generation-types";
import type { StaticIntelligenceSourceBundle } from "./types";

export class StaticIntelligenceRepository {
	constructor(private readonly db: AppDatabase) {}

	async loadSourceBundle(
		scanRunId: string,
	): Promise<StaticIntelligenceSourceBundle | null> {
		const [scanRun] = await this.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId));
		if (!scanRun) return null;

		const [project] = await this.db
			.select()
			.from(projects)
			.where(eq(projects.id, scanRun.projectId));
		if (!project) return null;

		const [toolRunRows, artifactRows, findingRows, reviewRows] =
			await Promise.all([
				this.db
					.select()
					.from(toolRuns)
					.where(eq(toolRuns.scanRunId, scanRunId)),
				this.db
					.select()
					.from(scanArtifacts)
					.where(eq(scanArtifacts.scanRunId, scanRunId)),
				this.db
					.select()
					.from(findings)
					.where(eq(findings.scanRunId, scanRunId)),
				this.db
					.select()
					.from(scanReviews)
					.where(eq(scanReviews.scanRunId, scanRunId)),
			]);

		const findingIds = findingRows.map((finding) => finding.id);
		const evidenceRows =
			findingIds.length === 0
				? []
				: await this.db
						.select()
						.from(findingEvidences)
						.where(inArray(findingEvidences.findingId, findingIds));

		const reviewsByNewest = [...reviewRows].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		);
		const latestCompletedReview =
			reviewsByNewest.find((review) => review.status === "completed") ?? null;
		const latestReview = reviewsByNewest[0] ?? null;

		const diagnosticArtifacts = artifactRows.filter(
			(artifact) => !isStaticIntelligenceDerivedArtifact(artifact.kind),
		);

		return {
			project,
			scanRun,
			toolRuns: sortById(toolRunRows),
			artifacts: sortById(diagnosticArtifacts),
			findings: sortById(findingRows),
			evidences: sortById(evidenceRows),
			latestReview,
			latestCompletedReview,
		};
	}

	async findCompletedReview(scanRunId: string) {
		const reviews = await this.db
			.select()
			.from(scanReviews)
			.where(
				and(
					eq(scanReviews.scanRunId, scanRunId),
					eq(scanReviews.status, "completed"),
				),
			);
		return (
			reviews.sort(
				(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
			)[0] ?? null
		);
	}
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}
