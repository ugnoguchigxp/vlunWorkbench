import { Hono } from "hono";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AppEnv } from "../app/env";
import type { DbConnection } from "../db";

type HealthRouteDeps = {
	env: AppEnv;
	dbConnection: DbConnection;
	expectedMigrations?: string[];
};

export function createHealthRoute(deps?: HealthRouteDeps) {
	return new Hono()
		.get("/", (c) => {
			return c.json({ status: "ok", service: "vuln-workbench" });
		})
		.get("/ready", async (c) => {
			if (!deps) {
				return c.json({ status: "not_ready", service: "vuln-workbench" }, 503);
			}
			try {
				deps.dbConnection.sqlite.query("select 1").get();
				const migrationFiles =
					deps.expectedMigrations ??
					(await readdir(path.resolve("drizzle")))
						.filter((filename) => filename.endsWith(".sql"))
						.sort((left, right) => left.localeCompare(right));
				const appliedMigrations = deps.dbConnection.sqlite
					.query<{ filename: string }, []>(
						"SELECT filename FROM vuln_workbench_schema_migrations ORDER BY filename",
					)
					.all()
					.map((row) => row.filename);
				if (
					migrationFiles.length !== appliedMigrations.length ||
					migrationFiles.some(
						(filename, index) => filename !== appliedMigrations[index],
					)
				) {
					throw new Error("Database migrations are not current.");
				}
				const writerHealth = await deps.dbConnection.writerClient?.health();
				if (writerHealth && writerHealth.status !== "ready") {
					throw new Error("SQLite Writer is not ready.");
				}
				for (const root of deps.env.projectAllowedRoots ?? []) {
					if (!(await stat(root)).isDirectory()) {
						throw new Error("A configured project root is not a directory.");
					}
				}
				return c.json({ status: "ready", service: "vuln-workbench" });
			} catch {
				return c.json({ status: "not_ready", service: "vuln-workbench" }, 503);
			}
		});
}
