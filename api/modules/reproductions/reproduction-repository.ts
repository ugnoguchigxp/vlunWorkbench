import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	legacyOutcomeToObservation,
	type VerificationKind,
	verificationResultSchema,
} from "../../../shared/schemas/verification.schema";
import {
	reproductionArtifacts,
	reproductionEvidence,
	reproductionRuns,
} from "../../db/schema";

export class ReproductionRepository {
	constructor(private readonly db: AppDatabase) {}

	async createRun(params: {
		projectId: string;
		scanRunId: string;
		findingId: string;
		profileId: string;
		status: string;
		runner: string;
		commandJson?: string[] | null;
		createdByUserId?: string | null;
		metadata?: Record<string, unknown>;
		verificationKind?: VerificationKind;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(reproductionRuns)
			.values({
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				findingId: params.findingId,
				profileId: params.profileId,
				verificationKind: params.verificationKind ?? "scanner_recheck",
				evidenceStrength:
					params.verificationKind === "exploit_reproduction"
						? "impact_demonstrated"
						: params.verificationKind === "runtime_observation"
							? "runtime_observation"
							: "scanner_signal",
				status: params.status,
				runner: params.runner,
				commandJson: params.commandJson ?? null,
				startedAt: now,
				metadata: params.metadata ?? {},
				createdByUserId: params.createdByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateRunStatus(
		id: string,
		status: string,
		options?: {
			outcome?: string | null;
			exitCode?: number | null;
			completedAt?: Date | null;
			summary?: string | null;
			errorMessage?: string | null;
			metadata?: Record<string, unknown>;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.outcome !== undefined) {
			const current = await this.getRun(id);
			const kind = (current?.verificationKind ??
				"scanner_recheck") as VerificationKind;
			const outcome =
				kind === "scanner_recheck"
					? legacyOutcomeToObservation(options.outcome)
					: options.outcome;
			if (outcome !== null) {
				verificationResultSchema.parse({
					kind,
					outcome,
					evidenceStrength:
						kind === "exploit_reproduction"
							? "impact_demonstrated"
							: kind === "runtime_observation"
								? "runtime_observation"
								: "scanner_signal",
					evidenceRefs: ["pending:persisted-run-evidence"],
				});
			}
			updateValues.outcome = outcome;
		}
		if (options?.exitCode !== undefined) {
			updateValues.exitCode = options.exitCode;
		}
		if (options?.summary !== undefined) {
			updateValues.summary = options.summary;
		}
		if (options?.errorMessage !== undefined) {
			updateValues.errorMessage = options.errorMessage;
		}
		if (options?.metadata !== undefined) {
			updateValues.metadata = options.metadata;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (
			status === "completed" ||
			status === "failed" ||
			status === "timed_out" ||
			status === "cancelled"
		) {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(reproductionRuns)
			.set(updateValues)
			.where(eq(reproductionRuns.id, id))
			.returning();
		return updated || null;
	}

	async getRun(id: string) {
		return (
			(await this.db.query.reproductionRuns.findFirst({
				where: eq(reproductionRuns.id, id),
			})) ?? null
		);
	}

	async listRunsForFinding(findingId: string) {
		return await this.db.query.reproductionRuns.findMany({
			where: eq(reproductionRuns.findingId, findingId),
			orderBy: (runs, { desc }) => [desc(runs.createdAt)],
		});
	}

	async createArtifact(params: {
		reproductionRunId: string;
		findingId: string;
		kind: string;
		format: string;
		path: string;
		sha256: string;
		sizeBytes: number;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(reproductionArtifacts)
			.values({
				reproductionRunId: params.reproductionRunId,
				findingId: params.findingId,
				kind: params.kind,
				format: params.format,
				path: params.path,
				sha256: params.sha256,
				sizeBytes: params.sizeBytes,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listArtifacts(reproductionRunId: string) {
		return await this.db.query.reproductionArtifacts.findMany({
			where: eq(reproductionArtifacts.reproductionRunId, reproductionRunId),
		});
	}

	async createEvidence(params: {
		reproductionRunId: string;
		findingId: string;
		kind: string;
		title: string;
		artifactId?: string | null;
		location?: Record<string, unknown> | null;
		snippet?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(reproductionEvidence)
			.values({
				reproductionRunId: params.reproductionRunId,
				findingId: params.findingId,
				kind: params.kind,
				title: params.title,
				artifactId: params.artifactId ?? null,
				location: params.location ?? null,
				snippet: params.snippet ?? null,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listEvidence(reproductionRunId: string) {
		return await this.db.query.reproductionEvidence.findMany({
			where: eq(reproductionEvidence.reproductionRunId, reproductionRunId),
		});
	}
}
