import { and, eq } from "drizzle-orm";
import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import type { ThreatHypothesis } from "../../../shared/schemas/threat-model.schema";
import type { AppDatabase } from "../../db";
import {
	applicationModelSnapshots,
	threatHypotheses,
	threatModelEvidences,
	threatModelRuns,
} from "../../db/schema";
import { canonicalJson } from "../scans/diff-scan-plan";
import crypto from "node:crypto";

export class ThreatModelRepository {
	constructor(private readonly db: AppDatabase) {}

	async saveSnapshot(params: { model: ApplicationModel; ownerUserId: string }) {
		await this.db
			.insert(applicationModelSnapshots)
			.values({
				projectId: params.model.projectId,
				ownerUserId: params.ownerUserId,
				sourceFingerprint: params.model.sourceFingerprint,
				snapshotHash: params.model.snapshotHash,
				model: params.model,
			})
			.onConflictDoNothing({
				target: [
					applicationModelSnapshots.projectId,
					applicationModelSnapshots.sourceFingerprint,
				],
			});
		return await this.db.query.applicationModelSnapshots.findFirst({
			where: and(
				eq(applicationModelSnapshots.projectId, params.model.projectId),
				eq(
					applicationModelSnapshots.sourceFingerprint,
					params.model.sourceFingerprint,
				),
				eq(applicationModelSnapshots.ownerUserId, params.ownerUserId),
			),
		});
	}

	async createRun(params: {
		projectId: string;
		modelSnapshotId: string;
		ownerUserId: string;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(threatModelRuns)
			.values({
				...params,
				status: "running",
				startedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async completeRun(params: {
		runId: string;
		modelSnapshotId: string;
		hypotheses: ThreatHypothesis[];
		status: "completed" | "completed_with_limitations";
		llmAvailable: boolean;
		limitations: string[];
	}) {
		for (const hypothesis of params.hypotheses) {
			const [created] = await this.db
				.insert(threatHypotheses)
				.values({
					runId: params.runId,
					modelSnapshotId: params.modelSnapshotId,
					externalId: hypothesis.id,
					category: hypothesis.category,
					status: hypothesis.status,
					validationKind: hypothesis.validationKind,
					hypothesis,
				})
				.returning();
			for (const evidence of hypothesis.evidenceRefs)
				await this.db.insert(threatModelEvidences).values({
					runId: params.runId,
					hypothesisId: created.id,
					kind: evidence.kind,
					reference: evidence.ref,
					evidenceHash: hash(canonicalJson(evidence)),
				});
		}
		await this.db
			.update(threatModelRuns)
			.set({
				status: params.status,
				llmAvailable: params.llmAvailable,
				limitations: params.limitations,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(threatModelRuns.id, params.runId));
		return await this.findOwnedRun(params.runId);
	}

	async failRun(runId: string, errorCode: string) {
		await this.db
			.update(threatModelRuns)
			.set({
				status: "failed",
				errorCode,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(threatModelRuns.id, runId));
	}

	async listOwnedRuns(projectId: string, ownerUserId: string) {
		return await this.db.query.threatModelRuns.findMany({
			where: and(
				eq(threatModelRuns.projectId, projectId),
				eq(threatModelRuns.ownerUserId, ownerUserId),
			),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async findOwnedRun(runId: string, ownerUserId?: string) {
		const run = await this.db.query.threatModelRuns.findFirst({
			where: ownerUserId
				? and(
						eq(threatModelRuns.id, runId),
						eq(threatModelRuns.ownerUserId, ownerUserId),
					)
				: eq(threatModelRuns.id, runId),
		});
		if (!run) return null;
		const [snapshot, hypotheses, evidence] = await Promise.all([
			this.db.query.applicationModelSnapshots.findFirst({
				where: eq(applicationModelSnapshots.id, run.modelSnapshotId),
			}),
			this.db.query.threatHypotheses.findMany({
				where: eq(threatHypotheses.runId, run.id),
				orderBy: (fields, { asc }) => [asc(fields.externalId)],
			}),
			this.db.query.threatModelEvidences.findMany({
				where: eq(threatModelEvidences.runId, run.id),
			}),
		]);
		return { run, snapshot, hypotheses, evidence };
	}
}

function hash(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
