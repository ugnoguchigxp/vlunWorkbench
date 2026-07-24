import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const databasePath = path.resolve(
	process.env.DATABASE_URL ?? ".tmp/e2e/vuln-workbench.sqlite",
);
const contentRoot = path.resolve(
	process.env.CONTENT_ROOT ?? ".tmp/e2e/content",
);
const projectRoot = path.resolve(
	process.env.PROJECT_ALLOWED_ROOTS ?? ".tmp/e2e/projects",
);

for (const filename of [
	databasePath,
	`${databasePath}-shm`,
	`${databasePath}-wal`,
]) {
	await rm(filename, { force: true });
}
await Promise.all([
	mkdir(path.dirname(databasePath), { recursive: true }),
	mkdir(contentRoot, { recursive: true }),
	mkdir(path.join(projectRoot, "allowed-project"), { recursive: true }),
]);

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: path.resolve("."),
		env: globalThis.process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(
			`${command.join(" ")} failed (${exitCode})\n${stdout}\n${stderr}`,
		);
	}
}

await run(["bun", "run", "db:migrate"]);
await run([
	"bun",
	"run",
	"db:seed",
	"--",
	"--email",
	"admin-e2e@example.com",
	"--name",
	"E2E Admin",
]);
