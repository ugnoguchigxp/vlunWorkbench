import { and, eq } from "drizzle-orm";
import type {
	CreateAssessmentEngagementInput,
	ScanCoverageResult,
} from "../../../shared/schemas/assessment.schema";
import {
	assessmentScopeSchema,
	rulesOfEngagementSchema,
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
		const current = await this.db.query.assessmentEngagements.findFirst({
			where: and(
				eq(assessmentEngagements.id, id),
				eq(assessmentEngagements.ownerUserId, ownerUserId),
			),
		});
		if (!current) return null;
		if (current.status === status) return current;
		const transitions: Record<string, Set<string>> = {
			draft: new Set(["active", "revoked"]),
			active: new Set(["completed", "expired", "revoked"]),
			completed: new Set(),
			expired: new Set(),
			revoked: new Set(),
		};
		if (!transitions[current.status]?.has(status)) {
			throw new Error("assessment_status_transition_rejected");
		}
		const now = new Date();
		if (status === "active") {
			const scope = assessmentScopeSchema.parse(current.scope);
			const roe = rulesOfEngagementSchema.parse(current.rulesOfEngagement);
			if (current.environment === "production") {
				throw new Error("active_assessment_production_rejected");
			}
			if (scope.origins.length === 0 || scope.paths.length === 0) {
				throw new Error("active_assessment_scope_incomplete");
			}
			if (
				current.startsAt.getTime() > now.getTime() ||
				current.expiresAt.getTime() <= now.getTime() ||
				Date.parse(roe.expiresAt) <= now.getTime() ||
				Date.parse(roe.expiresAt) > current.expiresAt.getTime()
			) {
				throw new Error("active_assessment_authorization_expired");
			}
		}
		if (status === "expired" && current.expiresAt.getTime() > now.getTime()) {
			throw new Error("assessment_not_yet_expired");
		}
		const [updated] = await this.db
			.update(assessmentEngagements)
			.set({ status, updatedAt: now })
			.where(
				and(
					eq(assessmentEngagements.id, id),
					eq(assessmentEngagements.ownerUserId, ownerUserId),
					eq(assessmentEngagements.status, current.status),
				),
			)
			.returning();
		if (!updated) throw new Error("assessment_status_transition_conflict");
		return updated;
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
