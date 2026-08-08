import { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createHealthRoute } from "./health.route";

describe("health route", () => {
	it("keeps liveness shallow and reports generic readiness", async () => {
		const sqlite = new Database(":memory:");
		sqlite.run(
			"CREATE TABLE vuln_workbench_schema_migrations (filename text PRIMARY KEY)",
		);
		const route = createHealthRoute({
			env: {} as never,
			expectedMigrations: [],
			dbConnection: {
				sqlite,
				db: {} as never,
				ownsConnection: true,
				writerClient: {
					health: vi.fn().mockResolvedValue({ status: "ready" }),
				} as never,
			},
		});

		expect((await route.request("/")).status).toBe(200);
		const readyResponse = await route.request("/ready");
		expect(readyResponse.status).toBe(200);
		expect(await readyResponse.json()).toEqual({
			status: "ready",
			service: "vuln-workbench",
		});
		sqlite.close();
	});

	it("does not expose internal readiness failure details", async () => {
		const route = createHealthRoute({
			env: {} as never,
			dbConnection: {
				sqlite: { query: () => ({ get: () => undefined }) },
				db: {} as never,
				ownsConnection: true,
				writerClient: {
					health: vi.fn().mockRejectedValue(new Error("sensitive socket path")),
				},
			} as never,
		});
		const response = await route.request("/ready");
		expect(response.status).toBe(503);
		expect(JSON.stringify(await response.json())).not.toContain("socket");
	});
});
