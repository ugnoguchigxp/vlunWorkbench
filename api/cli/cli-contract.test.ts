import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

function makeTempRoot(): string {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hono-standard-cli-"));
	tempRoots.push(tempRoot);
	return tempRoot;
}

function makeCliEnv(databaseUrl: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		NODE_ENV: "development",
		DATABASE_URL: databaseUrl,
		JWT_SECRET: "hono-standard-cli-test-secret-32-chars",
		APP_URL: "http://127.0.0.1:5173",
		CORS_ORIGINS: "http://127.0.0.1:5173",
		AUTH_COOKIE_SECURE: "false",
		AUTH_COOKIE_SAME_SITE: "lax",
		SECURITY_HEADERS_MODE: "auto",
	};
}

function runBunScript(
	args: string[],
	databaseUrl: string,
	input?: string,
): SpawnSyncReturns<string> {
	return spawnSync("bun", args, {
		cwd: process.cwd(),
		env: makeCliEnv(databaseUrl),
		input,
		encoding: "utf8",
	});
}

function expectSuccess(result: SpawnSyncReturns<string>): void {
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}

function parseLastJsonObject(stdout: string): unknown {
	const jsonStart = stdout.lastIndexOf("{");
	if (jsonStart === -1) {
		throw new Error(`No JSON object found in stdout: ${stdout}`);
	}
	return JSON.parse(stdout.slice(jsonStart));
}

afterEach(() => {
	for (const tempRoot of tempRoots.splice(0)) {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

describe("CLI contract", () => {
	it("applies SQLite migrations and reports idempotent re-runs", () => {
		const databaseUrl = path.join(makeTempRoot(), "data", "sqlite.db");

		const firstRun = runBunScript(["api/cli/migrate.ts"], databaseUrl);
		expectSuccess(firstRun);
		expect(parseLastJsonObject(firstRun.stdout)).toMatchObject({
			ok: true,
			total: 1,
			applied: 1,
			skipped: 0,
		});

		const secondRun = runBunScript(["api/cli/migrate.ts"], databaseUrl);
		expectSuccess(secondRun);
		expect(parseLastJsonObject(secondRun.stdout)).toMatchObject({
			ok: true,
			total: 1,
			applied: 0,
			skipped: 1,
		});
	});

	it("creates an admin user from stdin after migrations", () => {
		const databaseUrl = path.join(makeTempRoot(), "data", "sqlite.db");
		expectSuccess(runBunScript(["api/cli/migrate.ts"], databaseUrl));

		const result = runBunScript(
			[
				"api/cli/auth-create-admin.ts",
				"--email",
				"admin@example.com",
				"--name",
				"Admin User",
				"--password-stdin",
			],
			databaseUrl,
			"password123456\n",
		);

		expectSuccess(result);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			user: {
				email: "admin@example.com",
				displayName: "Admin User",
				role: "admin",
			},
		});
	});
});
