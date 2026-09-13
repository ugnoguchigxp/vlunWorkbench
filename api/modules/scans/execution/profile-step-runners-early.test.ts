import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import { users } from "../../../db/schema";
import { ProjectRepository, ScanRepository } from "../repositories";
import { ArtifactStorage } from "./lifecycle/artifact-storage";
import { runDastStepIntoExistingScan } from "./profile-dast-step-runner";
import { runRuntimeScannerIntoExistingScan } from "./profile-runtime-step-runner";
import { runSchemaScannerIntoExistingScan } from "./profile-schema-step-runner";

function migrate(connection: DbConnection): void {
	for (const filename of readdirSync(path.resolve("drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.resolve("drizzle", filename), "utf8"),
		);
	}
}

describe("profile step runners early outcomes", () => {
	let connection: DbConnection;
	let scanRepo: ScanRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let artifactStorage: ArtifactStorage;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		artifactStorage = new ArtifactStorage(
			path.join(process.cwd(), ".tmp-coverage-artifacts"),
		);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "step@example.com",
				passwordHash: "hash",
				displayName: "Step",
				role: "member",
				isActive: true,
			})
			.returning();
		userId = user.id;
		const project = await new ProjectRepository(connection.db).createProject({
			ownerUserId: userId,
			name: "Step project",
			repoPath: "/tmp/step-project",
		});
		projectId = project.id;
		scanRepo = new ScanRepository(connection.db);
		const scan = await scanRepo.createScanRun({
			projectId,
			profile: "runtime-web-safe",
			status: "running",
			createdByUserId: userId,
		});
		scanRunId = scan.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("fails a DAST step when the isolated target is unavailable", async () => {
		const result = await runDastStepIntoExistingScan({
			db: connection.db,
			projectId,
			scanRunId,
			repoPath: "/tmp/step-project",
			createdByUserId: userId,
			step: {
				kind: "dast",
				profileId: "http-baseline",
				displayName: "HTTP",
				required: true,
				failurePolicy: "fail_profile",
				target: { mode: "auto_project_start" },
			},
		});
		expect(result.status).toBe("failed");
		expect(result.error).toBe("runtime_isolation_provider_unavailable");
	});

	it("fails a DAST step when the namespace executor is missing", async () => {
		const result = await runDastStepIntoExistingScan({
			db: connection.db,
			projectId,
			scanRunId,
			repoPath: "/tmp/step-project",
			createdByUserId: userId,
			step: {
				kind: "dast",
				profileId: "http-baseline",
				displayName: "HTTP",
				required: true,
				failurePolicy: "fail_profile",
				target: { mode: "auto_project_start" },
			},
			preparedAutoTarget: {
				origin: "http://127.0.0.1:9",
				runtimeNamespaceOwnerId: "owner",
				runtimeDastFetch: undefined,
				plan: {
					scriptName: "start",
					command: ["true"],
					port: 9,
					warnings: [],
				},
				targetConfig: {
					name: "auto",
					origin: "http://127.0.0.1:9",
					metadata: {},
				},
			} as never,
		});
		expect(result.status).toBe("failed");
		expect(result.error).toBe("runtime_namespace_dast_executor_unavailable");
	});

	it("returns not applicable when no API schema is discovered", async () => {
		await expect(
			runSchemaScannerIntoExistingScan({
				db: connection.db,
				projectId,
				scanRunId,
				repoPath: "/tmp/step-project",
				targetOrigin: "http://127.0.0.1:9",
				discovery: { applicable: false, reasonCode: "schema_not_found" },
				artifactStorage,
				authContextId: "auth",
			} as never),
		).rejects.toThrow("api_auth_context_and_identity_role_required");
		await expect(
			runSchemaScannerIntoExistingScan({
				db: connection.db,
				projectId,
				scanRunId,
				repoPath: "/tmp/step-project",
				targetOrigin: "http://127.0.0.1:9",
				discovery: { applicable: true, schemaPath: "/tmp/openapi.json" },
				artifactStorage,
				authContextId: "auth",
				identityRole: "user",
			} as never),
		).rejects.toThrow("api_auth_context_repository_unavailable");
		const skipped = await runSchemaScannerIntoExistingScan({
			db: connection.db,
			projectId,
			scanRunId,
			repoPath: "/tmp/step-project",
			targetOrigin: "http://127.0.0.1:9",
			discovery: { applicable: false },
			artifactStorage,
		} as never);
		expect(skipped).toMatchObject({
			applicable: false,
			reasonCode: "schema_not_found",
			toolRunId: null,
		});
	});

	it("fails nuclei when the host binary is unavailable", async () => {
		try {
			const result = await runRuntimeScannerIntoExistingScan({
				db: connection.db,
				projectId,
				scanRunId,
				adapter: "nuclei-safe",
				targetOrigin: "http://127.0.0.1:9",
				artifactStorage,
				execution: { runner: "host" },
			});
			expect(result.reasonCode).toBe("tool_unavailable");
			expect(result.findingCount).toBe(0);
		} catch (error) {
			expect(String(error)).toMatch(/Scanner data|nuclei|tool_unavailable/i);
		}
	});
});
