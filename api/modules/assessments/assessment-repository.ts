import { and, eq } from "drizzle-orm";
import type {
	CreateAssessmentEngagementInput,
	ScanCoverageResult,
} from "../../../shared/schemas/assessment.schema";
import type { AppDatabase } from "../../db";
import { assessmentEngagements, scanCoverageResults } from "../../db/schema";

export class AssessmentRepository {
	constructor(private readonly db: AppDatabase) {}

	async createEngagement(
		input: CreateAssessmentEngagementInput & { ownerUserId: string },
	) {
		const now = new Date();
		const [created] = await this.db
			.insert(assessmentEngagements)
			.values({
				projectId: input.projectId,
				purpose: input.purpose,
				environment: input.environment,
				scope: input.scope,
				rulesOfEngagement: input.rulesOfEngagement,
				ownerUserId: input.ownerUserId,
				status: "draft",
				startsAt: new Date(input.startsAt),
				expiresAt: new Date(input.expiresAt),
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async listEngagements(projectId: string, ownerUserId: string) {
		return await this.db.query.assessmentEngagements.findMany({
			where: and(
				eq(assessmentEngagements.projectId, projectId),
				eq(assessmentEngagements.ownerUserId, ownerUserId),
			),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async findEngagement(id: string) {
		return (
			(await this.db.query.assessmentEngagements.findFirst({
				where: eq(assessmentEngagements.id, id),
			})) ?? null
		);
	}

	async setEngagementStatus(
		id: string,
		ownerUserId: string,
		status: "draft" | "active" | "completed" | "expired" | "revoked",
	) {
		const [updated] = await this.db
			.update(assessmentEngagements)
			.set({ status, updatedAt: new Date() })
			.where(
				and(
					eq(assessmentEngagements.id, id),
					eq(assessmentEngagements.ownerUserId, ownerUserId),
				),
			)
			.returning();
		return updated ?? null;
	}

	async upsertCoverageResults(params: {
		scanRunId: string;
		snapshotHash: string;
		results: ScanCoverageResult[];
		engagementId?: string | null;
	}) {
		for (const result of params.results) {
			await this.db
				.insert(scanCoverageResults)
				.values({
					scanRunId: params.scanRunId,
					engagementId: params.engagementId ?? null,
					controlId: result.controlId,
					status: result.status,
					method: result.method,
					reasonCode: result.reasonCode,
					evidenceRefs: result.evidenceRefs,
					snapshotHash: params.snapshotHash,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						scanCoverageResults.scanRunId,
						scanCoverageResults.controlId,
					],
					set: {
						engagementId: params.engagementId ?? null,
						status: result.status,
						method: result.method,
						reasonCode: result.reasonCode,
						evidenceRefs: result.evidenceRefs,
						snapshotHash: params.snapshotHash,
						updatedAt: new Date(),
					},
				});
		}
		return await this.listCoverageResults(params.scanRunId);
	}

	async listCoverageResults(scanRunId: string) {
		return await this.db.query.scanCoverageResults.findMany({
			where: eq(scanCoverageResults.scanRunId, scanRunId),
			orderBy: (fields, { asc }) => [asc(fields.controlId)],
		});
	}
}
