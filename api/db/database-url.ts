import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
	if (databaseUrl === ":memory:") return databaseUrl;
	if (databaseUrl.startsWith("file:")) {
		return databaseUrl.slice("file:".length);
	}
	if (databaseUrl.startsWith("sqlite://")) {
		return databaseUrl.slice("sqlite://".length);
	}
	return databaseUrl;
}

export function canonicalDatabasePath(databaseUrl: string): string {
	const sqlitePath = sqlitePathFromDatabaseUrl(databaseUrl);
	if (sqlitePath === ":memory:") return sqlitePath;
	const absolutePath = path.resolve(sqlitePath);
	let existingAncestor = absolutePath;
	const suffix: string[] = [];
	while (true) {
		try {
			return path.join(realpathSync(existingAncestor), ...suffix);
		} catch {
			const parent = path.dirname(existingAncestor);
			if (parent === existingAncestor) return absolutePath;
			suffix.unshift(path.basename(existingAncestor));
			existingAncestor = parent;
		}
	}
}

export function databaseIdFromUrl(databaseUrl: string): string {
	return createHash("sha256")
		.update(canonicalDatabasePath(databaseUrl))
		.digest("hex");
}

export function defaultWriterSocketPath(databaseUrl: string): string {
	const databaseId = databaseIdFromUrl(databaseUrl).slice(0, 16);
	const uid = typeof process.getuid === "function" ? process.getuid() : "user";
	return path.join(os.tmpdir(), `vuln-workbench-${uid}-${databaseId}.sock`);
}

export function writerLockPath(databaseUrl: string): string {
	const sqlitePath = canonicalDatabasePath(databaseUrl);
	if (sqlitePath === ":memory:") {
		return path.join(
			os.tmpdir(),
			`vuln-workbench-memory-${process.pid}.writer-lock`,
		);
	}
	return `${sqlitePath}.writer-lock`;
}
