import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureEnvFile } from "./bootstrap";

const tempRoots: string[] = [];

function makeTempRoot(): string {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hono-standard-boot-"));
	tempRoots.push(tempRoot);
	return tempRoot;
}

afterEach(() => {
	for (const tempRoot of tempRoots.splice(0)) {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

describe("bootstrap env setup", () => {
	it("creates .env from .env.example and returns the SQLite database path", () => {
		const tempRoot = makeTempRoot();
		fs.writeFileSync(
			path.join(tempRoot, ".env.example"),
			"NODE_ENV=development\nDATABASE_URL=data/sqlite.db\n",
		);

		const databaseUrl = ensureEnvFile(tempRoot);

		expect(databaseUrl).toBe("data/sqlite.db");
		expect(fs.readFileSync(path.join(tempRoot, ".env"), "utf8")).toContain(
			"DATABASE_URL=data/sqlite.db",
		);
	});

	it("uses a PostgreSQL default from the variant .env.example", () => {
		const tempRoot = makeTempRoot();
		fs.writeFileSync(
			path.join(tempRoot, ".env.example"),
			"NODE_ENV=development\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/hono_standard\n",
		);

		const databaseUrl = ensureEnvFile(tempRoot);

		expect(databaseUrl).toBe(
			"postgres://postgres:postgres@localhost:5432/hono_standard",
		);
		expect(fs.readFileSync(path.join(tempRoot, ".env"), "utf8")).toContain(
			"DATABASE_URL=postgres://postgres:postgres@localhost:5432/hono_standard",
		);
	});

	it("normalizes URL-style or legacy SQLite database values for local bootstrap", () => {
		const tempRoot = makeTempRoot();
		fs.writeFileSync(
			path.join(tempRoot, ".env.example"),
			"NODE_ENV=development\nDATABASE_URL=data/sqlite.db\n",
		);
		fs.writeFileSync(
			path.join(tempRoot, ".env"),
			"NODE_ENV=development\nDATABASE_URL=postgres://localhost/app\n",
		);

		const databaseUrl = ensureEnvFile(tempRoot);

		expect(databaseUrl).toBe("data/sqlite.db");
		expect(fs.readFileSync(path.join(tempRoot, ".env"), "utf8")).toContain(
			"DATABASE_URL=data/sqlite.db",
		);
	});

	it("preserves an existing PostgreSQL URL for PostgreSQL variants", () => {
		const tempRoot = makeTempRoot();
		fs.writeFileSync(
			path.join(tempRoot, ".env.example"),
			"NODE_ENV=development\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/hono_standard\n",
		);
		fs.writeFileSync(
			path.join(tempRoot, ".env"),
			"NODE_ENV=development\nDATABASE_URL=postgres://postgres:postgres@localhost:5433/custom\n",
		);

		const databaseUrl = ensureEnvFile(tempRoot);

		expect(databaseUrl).toBe(
			"postgres://postgres:postgres@localhost:5433/custom",
		);
		expect(fs.readFileSync(path.join(tempRoot, ".env"), "utf8")).toContain(
			"DATABASE_URL=postgres://postgres:postgres@localhost:5433/custom",
		);
	});

	it("replaces another template default with the current variant default", () => {
		const tempRoot = makeTempRoot();
		fs.writeFileSync(
			path.join(tempRoot, ".env.example"),
			"NODE_ENV=development\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/hono_standard\n",
		);
		fs.writeFileSync(
			path.join(tempRoot, ".env"),
			"NODE_ENV=development\nDATABASE_URL=data/sqlite.db\n",
		);

		const databaseUrl = ensureEnvFile(tempRoot);

		expect(databaseUrl).toBe(
			"postgres://postgres:postgres@localhost:5432/hono_standard",
		);
		expect(fs.readFileSync(path.join(tempRoot, ".env"), "utf8")).toContain(
			"DATABASE_URL=postgres://postgres:postgres@localhost:5432/hono_standard",
		);
	});
});
