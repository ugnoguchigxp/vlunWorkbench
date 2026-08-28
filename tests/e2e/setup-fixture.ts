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
const fixtureProjects = [
	{
		source: fixtureProjectRoot,
		destination: path.join(projectRoot, "fixture-project"),
	},
	{
		source: fixtureProjectRoot,
		destination: path.join(projectRoot, "fixture-project-semgrep"),
	},
	{
		source: path.resolve("tests/e2e/fixtures/maven-war-project"),
		destination: path.join(projectRoot, "fixture-project-maven-war"),
	},
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
	...fixtureProjects.map((fixture) =>
		rm(fixture.destination, { recursive: true, force: true }),
	),
]);
await Promise.all([
	mkdir(path.dirname(databasePath), { recursive: true }),
	mkdir(contentRoot, { recursive: true }),
	mkdir(projectRoot, { recursive: true }),
	mkdir(artifactRoot, { recursive: true }),
]);
await Promise.all(
	fixtureProjects.map((fixture) =>
		cp(fixture.source, fixture.destination, { recursive: true }),
	),
);
await Promise.all(
	["semgrep", "gitleaks", "osv-scanner", "trivy", "zizmor"].map((filename) =>
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

async function initializeFixtureRepository(projectPath: string): Promise<void> {
	await run(["git", "init", "--initial-branch=main", projectPath]);
	await run([
		"git",
		"-C",
		projectPath,
		"config",
		"user.email",
		"e2e@example.invalid",
	]);
	await run([
		"git",
		"-C",
		projectPath,
		"config",
		"user.name",
		"vulnWorkbench E2E",
	]);
	await run(["git", "-C", projectPath, "add", "."]);
	await run(["git", "-C", projectPath, "commit", "-m", "Create E2E fixture"]);
}

for (const fixture of fixtureProjects) {
	await initializeFixtureRepository(fixture.destination);
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
