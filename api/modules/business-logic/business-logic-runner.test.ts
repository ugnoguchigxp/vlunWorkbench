import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository } from "../scans/repositories";
import {
	BusinessLogicRunner,
	businessLogicProfileOutcome,
} from "./business-logic-runner";

function migrate(connection: DbConnection): void {
	for (const filename of readdirSync(path.resolve("drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.resolve("drizzle", filename), "utf8"),
		);
	}
}

describe("businessLogicProfileOutcome", () => {
	it("keeps business findings separate from operational profile completion", () => {
		expect(businessLogicProfileOutcome("observed")).toBe("completed");
		expect(businessLogicProfileOutcome("not_observed")).toBe("completed");
		expect(businessLogicProfileOutcome("inconclusive")).toBe("incomplete");
		expect(businessLogicProfileOutcome("not_tested")).toBe("incomplete");
		expect(businessLogicProfileOutcome("failed_cleanup")).toBe("failed");
	});
});

describe("BusinessLogicRunner", () => {
	let connection: DbConnection;
	let runner: BusinessLogicRunner;
	let ownerUserId: string;
	let projectId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		runner = new BusinessLogicRunner(connection.db);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "runner@example.com",
				passwordHash: "hash",
				displayName: "Runner",
				role: "member",
				isActive: true,
			})
			.returning();
		ownerUserId = user.id;
		const project = await new ProjectRepository(connection.db).createProject({
			ownerUserId,
			name: "Runner",
			repoPath: "/tmp/runner",
		});
		projectId = project.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("requires consent and a project-owned scenario", async () => {
		await expect(
			runner.run({
				scenarioId: "00000000-0000-4000-8000-000000000099",
				projectId,
				ownerUserId,
				executionConsent: false as never,
			}),
		).rejects.toThrow("business_logic_execution_consent_required");
		await expect(
			runner.run({
				scenarioId: "00000000-0000-4000-8000-000000000099",
				projectId,
				ownerUserId,
				executionConsent: true,
			}),
		).rejects.toThrow("business_logic_scenario_not_found");
		expect(await runner.recover()).toBe(0);
	});
});
