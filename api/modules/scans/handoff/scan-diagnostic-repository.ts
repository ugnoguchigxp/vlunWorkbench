import { and, eq, inArray, sql } from "drizzle-orm";
import type {
	AutomatedDiagnosticReadiness,
	AutomatedDiagnosticStatus,
} from "../../../../shared/schemas/automated-diagnostic.schema";
import type { AppDatabase } from "../../../db";
import { scanDiagnosticRuns, scanRuns } from "../../../db/schema";

export class ScanDiagnosticRepository {
	constructor(private readonly db: AppDatabase) {}

	async createOrFind(params: {
		scanRunId: string;
		inputSnapshotHash: string;
		scannerProvenanceHash: string;
		pipelineVersion: string;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanDiagnosticRuns)
			.values({
				scanRunId: params.scanRunId,
				inputSnapshotHash: params.inputSnapshotHash,
				scannerProvenanceHash: params.scannerProvenanceHash,
				pipelineVersion: params.pipelineVersion,
				status: "queued",
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [
					scanDiagnosticRuns.scanRunId,
					scanDiagnosticRuns.inputSnapshotHash,
					scanDiagnosticRuns.pipelineVersion,
				],
			})
			.returning();
		if (created) return created;
		return await this.findBySnapshot(params);
	}

	async claimQueued(id: string) {
		const now = new Date();
		const [claimed] = await this.db
			.update(scanDiagnosticRuns)
			.set({
				status: "running",
				readiness: null,
				errorMessage: null,
				startedAt: now,
				completedAt: null,
				attemptCount: sql`${scanDiagnosticRuns.attemptCount} + 1`,
				updatedAt: now,
			})
			.where(
				and(
					eq(scanDiagnosticRuns.id, id),
					eq(scanDiagnosticRuns.status, "queued"),
				),
			)
			.returning();
		return claimed ?? null;
	}

	async update(
		id: string,
		status: AutomatedDiagnosticStatus,
		options: {
			readiness?: AutomatedDiagnosticReadiness | null;
			scanReviewId?: string | null;
			scanReportId?: string | null;
			limitationCodes?: string[];
			errorMessage?: string | null;
		} = {},
	) {
		const now = new Date();
		const values: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options.readiness !== undefined) {
			values.readiness = options.readiness;
		}
		if (options.scanReviewId !== undefined) {
			values.scanReviewId = options.scanReviewId;
		}
		if (options.scanReportId !== undefined) {
			values.scanReportId = options.scanReportId;
		}
		if (options.limitationCodes !== undefined) {
			values.limitationCodes = [...new Set(options.limitationCodes)].sort();
		}
		if (options.errorMessage !== undefined) {
			values.errorMessage = options.errorMessage;
		}
		if (
			status === "completed" ||
			status === "completed_with_limitations" ||
			status === "failed"
		) {
			values.completedAt = now;
		}
		const [updated] = await this.db
			.update(scanDiagnosticRuns)
			.set(values)
			.where(eq(scanDiagnosticRuns.id, id))
			.returning();
		return updated ?? null;
	}

	async requeueInterrupted(id: string) {
		const [updated] = await this.db
			.update(scanDiagnosticRuns)
			.set({
				status: "queued",
				readiness: null,
				errorMessage: null,
				startedAt: null,
				completedAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scanDiagnosticRuns.id, id),
					eq(scanDiagnosticRuns.status, "running"),
				),
			)
			.returning();
		return updated ?? null;
	}

	async requeueForRetry(id: string) {
		const [updated] = await this.db
			.update(scanDiagnosticRuns)
			.set({
				status: "queued",
				readiness: null,
				scanReviewId: null,
				scanReportId: null,
				errorMessage: null,
				startedAt: null,
				completedAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scanDiagnosticRuns.id, id),
					inArray(scanDiagnosticRuns.status, [
						"failed",
						"completed_with_limitations",
					]),
				),
			)
			.returning();
		return updated ?? null;
	}

	async findById(id: string) {
		return (
			(await this.db.query.scanDiagnosticRuns.findFirst({
				where: eq(scanDiagnosticRuns.id, id),
			})) ?? null
		);
	}

	async findBySnapshot(params: {
		scanRunId: string;
		inputSnapshotHash: string;
		pipelineVersion: string;
	}) {
		return (
			(await this.db.query.scanDiagnosticRuns.findFirst({
				where: and(
					eq(scanDiagnosticRuns.scanRunId, params.scanRunId),
					eq(scanDiagnosticRuns.inputSnapshotHash, params.inputSnapshotHash),
					eq(scanDiagnosticRuns.pipelineVersion, params.pipelineVersion),
				),
			})) ?? null
		);
	}

	async listForScan(scanRunId: string) {
		return await this.db.query.scanDiagnosticRuns.findMany({
			where: eq(scanDiagnosticRuns.scanRunId, scanRunId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async listActive() {
		return await this.db.query.scanDiagnosticRuns.findMany({
			where: inArray(scanDiagnosticRuns.status, ["queued", "running"]),
		});
	}

	async listCompletedScanRuns() {
		return await this.db.query.scanRuns.findMany({
			where: eq(scanRuns.status, "completed"),
		});
	}
}
