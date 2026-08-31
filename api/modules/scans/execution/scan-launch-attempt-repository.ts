import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import { scanLaunchAttempts } from "../../../db/schema";
import type {
	CanonicalProfileId,
	ExecutionEngineId,
	ScanReadinessStatus,
} from "../../../../shared/schemas/scan-profile-definition.schema";

export class ScanLaunchAttemptRepository {
	constructor(private readonly db: AppDatabase) {}

	async create(params: {
		projectId: string;
		requestedProfileId: string;
		createdByUserId: string;
		canonicalProfileId?: CanonicalProfileId | null;
		profileVariantId?: string | null;
		engineId?: ExecutionEngineId | null;
		readinessStatus?: ScanReadinessStatus | null;
		reasonCodes?: string[];
		sanitizedInputSummary?: Record<string, unknown>;
		catalogEntryHash?: string | null;
		readinessHash?: string | null;
		planHash?: string | null;
		dependencyQualificationHash?: string | null;
	}) {
		const [created] = await this.db
			.insert(scanLaunchAttempts)
			.values({
				projectId: params.projectId,
				requestedProfileId: params.requestedProfileId,
				canonicalProfileId: params.canonicalProfileId ?? null,
				profileVariantId: params.profileVariantId ?? null,
				engineId: params.engineId ?? null,
				status: "received",
				readinessStatus: params.readinessStatus ?? null,
				reasonCodes: params.reasonCodes ?? [],
				sanitizedInputSummary: params.sanitizedInputSummary ?? {},
				catalogEntryHash: params.catalogEntryHash ?? null,
				readinessHash: params.readinessHash ?? null,
				planHash: params.planHash ?? null,
				dependencyQualificationHash: params.dependencyQualificationHash ?? null,
				createdByUserId: params.createdByUserId,
			})
			.returning();
		if (!created) throw new Error("scan_launch_attempt_create_failed");
		return created;
	}

	async reject(params: {
		attemptId: string;
		readinessStatus: ScanReadinessStatus | null;
		reasonCodes: string[];
	}) {
		const [updated] = await this.db
			.update(scanLaunchAttempts)
			.set({
				status: "rejected",
				readinessStatus: params.readinessStatus,
				reasonCodes: params.reasonCodes,
				resolvedAt: new Date(),
				rejectedAt: new Date(),
			})
			.where(eq(scanLaunchAttempts.id, params.attemptId))
			.returning();
		return updated ?? null;
	}

	async admit(params: { attemptId: string; scanRunId: string }) {
		const [updated] = await this.db
			.update(scanLaunchAttempts)
			.set({
				status: "admitted",
				scanRunId: params.scanRunId,
				resolvedAt: new Date(),
				admittedAt: new Date(),
			})
			.where(eq(scanLaunchAttempts.id, params.attemptId))
			.returning();
		return updated ?? null;
	}

	async findById(projectId: string, attemptId: string) {
		return (
			(await this.db.query.scanLaunchAttempts.findFirst({
				where: and(
					eq(scanLaunchAttempts.id, attemptId),
					eq(scanLaunchAttempts.projectId, projectId),
				),
			})) ?? null
		);
	}

	async listRecent(projectId: string) {
		return await this.db.query.scanLaunchAttempts.findMany({
			where: eq(scanLaunchAttempts.projectId, projectId),
			orderBy: [desc(scanLaunchAttempts.createdAt)],
			limit: 100,
		});
	}
}
