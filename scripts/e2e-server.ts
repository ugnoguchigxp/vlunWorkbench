import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const databaseUrl = "data/e2e.sqlite";
const appUrl = "http://127.0.0.1:5174";

process.env.NODE_ENV = "development";
process.env.PORT = "5174";
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = "hono-standard-e2e-jwt-secret-change-this";
process.env.APP_URL = appUrl;
process.env.CORS_ORIGINS = appUrl;
process.env.AUTH_COOKIE_SECURE = "false";
process.env.AUTH_COOKIE_SAME_SITE = "lax";
process.env.SECURITY_HEADERS_MODE = "auto";

function run(command: string, args: string[]) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed.`);
	}
}

rmSync(databaseUrl, { force: true });
rmSync(`${databaseUrl}-shm`, { force: true });
rmSync(`${databaseUrl}-wal`, { force: true });

run("bun", ["run", "build"]);

const { readAppEnv } = await import("../api/app/env");
const { runMigrations } = await import("../api/db/migrate");
const { createDbRuntime } = await import("../api/db");
const { AuthService } = await import("../api/modules/auth/auth.service");

const env = readAppEnv();
await runMigrations(env);

const dbRuntime = createDbRuntime(env);
try {
	const authService = new AuthService(dbRuntime.client, env);
	await authService.createAdmin({
		email: "admin@example.com",
		displayName: "Admin User",
		password: "password123456",
	});
} finally {
	await dbRuntime.close();
}

const { default: app, getAppRuntime } = await import("../api/app/hono");

const server = Bun.serve({
	fetch: app.fetch,
	hostname: env.host,
	port: env.port,
});

console.log(`E2E server listening on http://${env.host}:${server.port}`);

const shutdown = async () => {
	server.stop(true);
	const runtime = await getAppRuntime();
	await runtime.dbRuntime.close();
	process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
