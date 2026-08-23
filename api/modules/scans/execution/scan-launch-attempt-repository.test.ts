import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDbConnection, type DbConnection } from "../../../db";
import { users } from "../../../db/schema";
import { ProjectRepository } from "../repositories";
import { ScanLaunchAttemptRepository } from "./scan-launch-attempt-repository";

describe("ScanLaunchAttemptRepository", () => {
	let connection: DbConnection;
	let attempts: ScanLaunchAttemptRepository;
	let projectId: string;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const file of readdirSync(path.resolve(process.cwd(), "drizzle")).filter((entry) => entry.endsWith(".sql")).sort()) {
			connection.sqlite.exec(readFileSync(path.resolve(process.cwd(), "drizzle", file), "utf8"));
		}
		const [user] = await connection.db.insert(users).values({ email: "attempt@example.test", passwordHash: "hash", displayName: "Attempt", role: "member", isActive: true, createdAt: new Date(), updatedAt: new Date() }).returning();
		userId = user!.id;
		projectId = (await new ProjectRepository(connection.db).createProject({ ownerUserId: userId, name: "project", repoPath: "/tmp/project" })).id;
		attempts = new ScanLaunchAttemptRepository(connection.db);
	});

	afterEach(() => connection.sqlite.close());

	test("keeps a rejected preflight attempt without a scan run", async () => {
		const attempt = await attempts.create({ projectId, requestedProfileId: "runtime-passive", createdByUserId: userId, canonicalProfileId: "runtime-passive", engineId: "passive-runtime" });
		const rejected = await attempts.reject({ attemptId: attempt.id, readinessStatus: "blocked_environment", reasonCodes: ["docker_image_unavailable"] });
		expect(rejected).toMatchObject({ status: "rejected", scanRunId: null, reasonCodes: ["docker_image_unavailable"] });
	});
});
