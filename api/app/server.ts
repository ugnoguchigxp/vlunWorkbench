import app, { getAppRuntime } from "./hono";
import { readAppEnv } from "./env";

const env = readAppEnv();

const server = Bun.serve({
	fetch: app.fetch,
	hostname: env.host,
	port: env.port,
});

console.log(
	`vulnWorkbench server listening on http://${env.host}:${server.port}`,
);

const shutdown = async (signal: string) => {
	console.log(`\nReceived ${signal}. Shutting down gracefully...`);
	server.stop(true);

	try {
		const runtime = await getAppRuntime();
		await runtime.scanSupervisor.shutdown();
		await runtime.scanDiagnosticRunner.shutdown();
		await runtime.scanReportRunner.shutdown();
		if (runtime.dbConnection.writerClient) {
			console.log("Stopping owned SQLite Writer...");
			await runtime.dbConnection.writerClient.close({ shutdownIfOwned: true });
		}
		if (runtime?.dbConnection?.ownsConnection) {
			console.log("Closing SQLite database connection...");
			runtime.dbConnection.sqlite.close(false);
		}
		console.log("Shutdown complete.");
		process.exit(0);
	} catch (error) {
		console.error("Error during shutdown:", error);
		process.exit(1);
	}
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
