import { access, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { readAppEnv } from "../api/app/env";
import { createDbConnection } from "../api/db";
import { resolveScanExecutionPolicy } from "../api/modules/scans/scan-execution-policy";
import { staticScannerAdapterRegistry } from "../api/modules/scans/static-scanner-adapters";

type CheckResult = {
	label: string;
	status: "ok" | "warn" | "fail";
	message: string;
};

const MIGRATIONS_TABLE = "vuln_workbench_schema_migrations";
const REQUIRED_TOOLS = ["bun"] as const;
const REGISTERED_SCAN_TOOLS = staticScannerAdapterRegistry.list();

function parseArgs(argv: string[]): { skipPort: boolean } {
	const args = { skipPort: false };
	for (const token of argv) {
		if (token === "--skip-port") {
			args.skipPort = true;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}
	return args;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function commandExists(command: string): Promise<boolean> {
	const proc = Bun.spawn(["/usr/bin/env", "which", command], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return (await proc.exited) === 0;
}

async function listSqlMigrations(): Promise<string[]> {
	const entries = await readdir(path.resolve(process.cwd(), "drizzle"), {
		withFileTypes: true,
	});
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

async function checkPortAvailable(
	host: string,
	port: number,
): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen(port, host);
	});
}

async function checkHealth(appUrl: string): Promise<boolean> {
	try {
		const url = new URL("/api/health", appUrl);
		const res = await fetch(url, {
			signal: AbortSignal.timeout(1000),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { status?: string };
		return body.status === "ok";
	} catch {
		return false;
	}
}

function printResult(result: CheckResult): void {
	const prefix =
		result.status === "ok" ? "OK" : result.status === "warn" ? "WARN" : "FAIL";
	console.log(`${prefix} ${result.label}: ${result.message}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const results: CheckResult[] = [];

	results.push({
		label: "bun",
		status: "ok",
		message: Bun.version,
	});

	for (const tool of REQUIRED_TOOLS) {
		const found = await commandExists(tool);
		results.push({
			label: `required tool ${tool}`,
			status: found ? "ok" : "fail",
			message: found ? "found" : "missing",
		});
	}

	const envFileExists = await fileExists(".env");
	results.push({
		label: ".env",
		status: envFileExists ? "ok" : "fail",
		message: envFileExists ? "found" : "missing; run bun run bootstrap",
	});

	let env: ReturnType<typeof readAppEnv> | undefined;
	try {
		env = readAppEnv();
		results.push({
			label: "environment",
			status: "ok",
			message: `DATABASE_URL=${env.databaseUrl}`,
		});
	} catch (error) {
		results.push({
			label: "environment",
			status: "fail",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	try {
		const memoryConnection = createDbConnection(":memory:");
		const row = memoryConnection.sqlite
			.query<{ version: string }, []>("select vec_version() as version")
			.get();
		memoryConnection.sqlite.close(false);
		results.push({
			label: "sqlite-vec",
			status: "ok",
			message: row?.version ? `loaded ${row.version}` : "loaded",
		});
	} catch (error) {
		results.push({
			label: "sqlite-vec",
			status: "fail",
			message: error instanceof Error ? error.message : String(error),
		});
	}

	if (env) {
		try {
			const policy = resolveScanExecutionPolicy({ env, surface: "cli" });
			const dockerAvailable =
				policy.runner !== "docker" ||
				(await commandExists(
					process.env.VULN_WORKBENCH_DOCKER_BIN ?? "docker",
				));
			results.push({
				label: "scanner execution policy",
				status: dockerAvailable ? "ok" : "fail",
				message: dockerAvailable
					? `${policy.runner} (${policy.source}, network=${policy.networkMode})`
					: "Docker policy is active but the Docker executable is missing.",
			});
		} catch (error) {
			results.push({
				label: "scanner execution policy",
				status: "fail",
				message: error instanceof Error ? error.message : String(error),
			});
		}

		try {
			const connection = createDbConnection(env.databaseUrl);
			const table = connection.sqlite
				.query<{ name: string }, [string]>(
					"select name from sqlite_master where type = 'table' and name = ?1",
				)
				.get(MIGRATIONS_TABLE);
			if (!table) {
				results.push({
					label: "migrations",
					status: "fail",
					message: "migration table missing; run bun run db:migrate",
				});
			} else {
				const allMigrations = await listSqlMigrations();
				const rows = connection.sqlite
					.query<{ filename: string }, []>(
						`select filename from ${MIGRATIONS_TABLE}`,
					)
					.all();
				const applied = new Set(rows.map((row) => row.filename));
				const pending = allMigrations.filter((name) => !applied.has(name));
				results.push({
					label: "migrations",
					status: pending.length === 0 ? "ok" : "fail",
					message:
						pending.length === 0
							? `${allMigrations.length} applied`
							: `${pending.length} pending: ${pending.join(", ")}`,
				});
			}

			try {
				const admin = connection.sqlite
					.query<{ email: string; role: string; is_active: number }, [string]>(
						"select email, role, is_active from users where email = ?1 limit 1",
					)
					.get("admin@example.com");
				results.push({
					label: "admin user",
					status: admin?.role === "admin" && admin.is_active ? "ok" : "fail",
					message: admin
						? `${admin.email} role=${admin.role} active=${Boolean(admin.is_active)}`
						: "missing; run bun run db:seed",
				});
			} catch (error) {
				results.push({
					label: "admin user",
					status: "fail",
					message: error instanceof Error ? error.message : String(error),
				});
			}

			connection.sqlite.close(false);
		} catch (error) {
			results.push({
				label: "database",
				status: "fail",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (env && !args.skipPort) {
		const healthOk = await checkHealth(env.appUrl);
		if (healthOk) {
			results.push({
				label: "dev server",
				status: "ok",
				message: `${env.appUrl}/api/health is responding`,
			});
		} else {
			const available = await checkPortAvailable(env.host, env.port);
			results.push({
				label: "dev server port",
				status: available ? "ok" : "fail",
				message: available
					? `${env.host}:${env.port} is available`
					: `${env.host}:${env.port} is busy and health check did not respond`,
			});
		}
	}

	for (const adapter of REGISTERED_SCAN_TOOLS) {
		const found = await commandExists(adapter.manifest.binaryName);
		results.push({
			label: `${adapter.manifest.distribution} scanner ${adapter.manifest.id}`,
			status: found ? "ok" : "warn",
			message: found
				? "found"
				: `${adapter.manifest.binaryName} missing; related scan profiles may fail until installed`,
		});
	}

	for (const result of results) {
		printResult(result);
	}

	if (results.some((result) => result.status === "fail")) {
		process.exit(1);
	}
}

await main();
