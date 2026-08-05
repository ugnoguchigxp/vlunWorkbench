import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const defaultDatabaseUrl = "data/sqlite.db";
const urlWithAuthorityPattern = /^[a-z][a-z0-9+.-]*:\/\//i;
const postgresUrlPattern = /^postgres(?:ql)?:\/\//i;
const knownTemplateDatabaseDefaults = new Set([
	"data/sqlite.db",
	"sqlite.db",
	"file:sqlite.db",
	"postgres://postgres:postgres@localhost:5432/hono_standard",
]);

type BootstrapPaths = {
	cwd: string;
	envPath: string;
	envExamplePath: string;
	nodeModulesPath: string;
};

type DotenvEntry =
	| { type: "assignment"; key: string; value: string; raw: string }
	| { type: "raw"; raw: string };

function resolveBootstrapPaths(cwd = process.cwd()): BootstrapPaths {
	return {
		cwd,
		envPath: path.resolve(cwd, ".env"),
		envExamplePath: path.resolve(cwd, ".env.example"),
		nodeModulesPath: path.resolve(cwd, "node_modules"),
	};
}

function runCommand(
	cwd: string,
	command: string,
	args: string[],
	env = process.env,
): void {
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed.`);
	}
}

function tryCommand(
	cwd: string,
	command: string,
	args: string[],
	env = process.env,
): boolean {
	const result = spawnSync(command, args, {
		cwd,
		env,
		stdio: "inherit",
	});
	if (result.error) return false;
	return result.status === 0;
}

function sleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseDotenv(text: string): DotenvEntry[] {
	return text.split(/\r?\n/).map((raw) => {
		const trimmed = raw.trim();
		if (!trimmed || trimmed.startsWith("#")) return { type: "raw", raw };

		const separator = raw.indexOf("=");
		if (separator === -1) return { type: "raw", raw };

		return {
			type: "assignment",
			key: raw.slice(0, separator).trim(),
			value: raw
				.slice(separator + 1)
				.trim()
				.replace(/^(['"])(.*)\1$/, "$2"),
			raw,
		};
	});
}

function serializeDotenv(entries: DotenvEntry[]): string {
	const lines = entries.map((entry) => {
		if (entry.type === "raw") return entry.raw;
		return `${entry.key}=${entry.value}`;
	});

	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	return `${lines.join("\n")}\n`;
}

function readDefaultDatabaseUrl(cwd: string): string {
	const { envExamplePath } = resolveBootstrapPaths(cwd);
	if (!fs.existsSync(envExamplePath)) return defaultDatabaseUrl;
	const defaultEntry = parseDotenv(
		fs.readFileSync(envExamplePath, "utf8"),
	).find(
		(entry): entry is Extract<DotenvEntry, { type: "assignment" }> =>
			entry.type === "assignment" && entry.key === "DATABASE_URL",
	);
	return defaultEntry?.value ?? defaultDatabaseUrl;
}

function shouldNormalizeToSqliteDefault(
	currentDatabaseUrl: string,
	defaultDatabaseUrlForVariant: string,
): boolean {
	if (defaultDatabaseUrlForVariant !== defaultDatabaseUrl) return false;
	return (
		urlWithAuthorityPattern.test(currentDatabaseUrl) ||
		currentDatabaseUrl === "sqlite.db"
	);
}

function shouldUseVariantDatabaseDefault(
	currentDatabaseUrl: string,
	defaultDatabaseUrlForVariant: string,
): boolean {
	if (currentDatabaseUrl === defaultDatabaseUrlForVariant) return false;
	if (
		knownTemplateDatabaseDefaults.has(currentDatabaseUrl) &&
		knownTemplateDatabaseDefaults.has(defaultDatabaseUrlForVariant)
	) {
		return true;
	}
	return shouldNormalizeToSqliteDefault(
		currentDatabaseUrl,
		defaultDatabaseUrlForVariant,
	);
}

export function ensureEnvFile(cwd = process.cwd()): string {
	const { envPath, envExamplePath } = resolveBootstrapPaths(cwd);
	if (!fs.existsSync(envPath)) {
		fs.copyFileSync(envExamplePath, envPath);
		console.log("created .env from .env.example");
	}

	const entries = parseDotenv(fs.readFileSync(envPath, "utf8"));
	const defaultDatabaseUrlForVariant = readDefaultDatabaseUrl(cwd);
	const databaseEntry = entries.find(
		(entry): entry is Extract<DotenvEntry, { type: "assignment" }> =>
			entry.type === "assignment" && entry.key === "DATABASE_URL",
	);

	let databaseUrl = databaseEntry?.value ?? defaultDatabaseUrlForVariant;
	if (!databaseEntry) {
		entries.push({
			type: "assignment",
			key: "DATABASE_URL",
			value: databaseUrl,
			raw: "",
		});
	} else if (
		shouldUseVariantDatabaseDefault(
			databaseEntry.value,
			defaultDatabaseUrlForVariant,
		)
	) {
		databaseUrl = defaultDatabaseUrlForVariant;
		databaseEntry.value = databaseUrl;
	}

	const nextText = serializeDotenv(entries);
	const currentText = fs.readFileSync(envPath, "utf8");
	if (nextText !== currentText) {
		fs.writeFileSync(envPath, nextText);
		console.log("updated .env for local SQLite");
	}

	return databaseUrl;
}

function ensureDependencies(paths: BootstrapPaths): void {
	const { cwd, nodeModulesPath } = paths;
	if (fs.existsSync(nodeModulesPath)) return;

	console.log("installing dependencies");
	runCommand(cwd, "bun", ["install", "--frozen-lockfile"]);
}

function ensurePostgresService(cwd: string, databaseUrl: string): void {
	if (!postgresUrlPattern.test(databaseUrl)) return;

	const composePath = path.resolve(cwd, "docker-compose.yml");
	if (!fs.existsSync(composePath)) return;

	const composeText = fs.readFileSync(composePath, "utf8");
	if (!/^\s{2}db:/m.test(composeText)) return;

	console.log("starting local PostgreSQL service");
	if (
		!tryCommand(cwd, "docker", ["compose", "up", "-d", "db"], {
			...process.env,
			COMPOSE_JWT_SECRET:
				process.env.COMPOSE_JWT_SECRET ??
				"hono-standard-local-compose-secret-change-before-production",
		})
	) {
		console.warn(
			"could not start docker compose db; continuing in case PostgreSQL is already running",
		);
	}
}

function runMigrations(cwd: string, databaseUrl: string): void {
	const env = {
		...process.env,
		DATABASE_URL: databaseUrl,
	};
	const maxAttempts = postgresUrlPattern.test(databaseUrl) ? 30 : 1;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		if (tryCommand(cwd, "bun", ["run", "db:migrate"], env)) return;
		if (attempt === maxAttempts) break;
		console.log(`waiting for database (${attempt}/${maxAttempts})`);
		sleep(1000);
	}

	throw new Error("bun run db:migrate failed.");
}

export function main(cwd = process.cwd()): void {
	const paths = resolveBootstrapPaths(cwd);
	const databaseUrl = ensureEnvFile(cwd);
	ensureDependencies(paths);
	ensurePostgresService(cwd, databaseUrl);
	runMigrations(cwd, databaseUrl);
	console.log("bootstrap complete");
}

if (import.meta.main) {
	main();
}
