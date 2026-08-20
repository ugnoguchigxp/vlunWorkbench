import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { scanArtifacts } from "../../db/schema";

export class ArtifactRepository {
	constructor(private readonly db: AppDatabase) {}

	async createArtifact(params: {
		scanRunId: string;
		toolRunId: string | null;
		kind: string;
		format: string;
		path: string;
		storageKey?: string;
		sha256: string;
		sizeBytes: number;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanArtifacts)
			.values({
				scanRunId: params.scanRunId,
				toolRunId: params.toolRunId ?? null,
				kind: params.kind,
				format: params.format,
				path: params.path,
				storageKey: params.storageKey ?? params.path,
				sha256: params.sha256,
				sizeBytes: params.sizeBytes,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listArtifacts(scanRunId: string) {
		return await this.db.query.scanArtifacts.findMany({
			where: eq(scanArtifacts.scanRunId, scanRunId),
		});
	}
}
