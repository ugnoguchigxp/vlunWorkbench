import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const databasePath = path.resolve(
	process.env.DATABASE_URL ?? ".tmp/e2e/vuln-workbench.sqlite",
);
const contentRoot = path.resolve(
	process.env.CONTENT_ROOT ?? ".tmp/e2e/content",
);
const projectRoot = path.resolve(".tmp/e2e/projects");
const artifactRoot = path.resolve(
	process.env.SCAN_ARTIFACT_ROOT ?? ".tmp/e2e/artifacts",
);
const fixtureProjectRoot = path.resolve("tests/e2e/fixtures/project");
const fixtureProjectPaths = [
	path.join(projectRoot, "fixture-project"),
	path.join(projectRoot, "fixture-project-semgrep"),
];
const fixtureBinRoot = path.resolve("tests/e2e/fixtures/bin");

for (const filename of [
	databasePath,
	`${databasePath}-shm`,
	`${databasePath}-wal`,
]) {
	await rm(filename, { force: true });
}
await Promise.all([
	rm(artifactRoot, { recursive: true, force: true }),
	...fixtureProjectPaths.map((fixtureProjectPath) =>
		rm(fixtureProjectPath, { recursive: true, force: true }),
	),
]);
await Promise.all([
	mkdir(path.dirname(databasePath), { recursive: true }),
	mkdir(contentRoot, { recursive: true }),
	mkdir(projectRoot, { recursive: true }),
	mkdir(artifactRoot, { recursive: true }),
]);
await Promise.all(
	fixtureProjectPaths.map((fixtureProjectPath) =>
		cp(fixtureProjectRoot, fixtureProjectPath, { recursive: true }),
	),
);
await Promise.all(
	["semgrep", "gitleaks", "osv-scanner"].map((filename) =>
		chmod(path.join(fixtureBinRoot, filename), 0o755),
	),
);

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: path.resolve("."),
		env: {
			...globalThis.process.env,
			NODE_ENV: "test",
		},
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
