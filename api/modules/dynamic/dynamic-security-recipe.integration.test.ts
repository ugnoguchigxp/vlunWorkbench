import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeDynamicDockerRun } from "./dynamic-docker-executor";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function runGoRace(fixture: "vulnerable" | "fixed") {
	return await runGoSecurityRecipe({ fixtureRoot: "go-race", fixture, command: ["go", "test", "-race", "./..."] });
}

async function runGoFuzz(fixture: "vulnerable" | "fixed") {
	return await runGoSecurityRecipe({
		fixtureRoot: "go-fuzz",
		fixture,
		command: ["go", "test", "-parallel=1", "-fuzz=Fuzz", "-fuzztime=2s", "./..."],
	});
}

async function runGoSecurityRecipe(params: {
	fixtureRoot: "go-race" | "go-fuzz";
	fixture: "vulnerable" | "fixed";
	command: string[];
}) {
	const out = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-go-race-out-"));
	roots.push(out);
	await fs.chmod(out, 0o777);
	return await executeDynamicDockerRun({
		dockerBin: "docker",
		image: "vuln-workbench-dynamic:local",
		containerName: `vwb-go-race-${crypto.randomUUID().slice(0, 8)}`,
		networkMode: "none",
		memory: "1g",
		cpus: "1",
		pidsLimit: 128,
		outputLimits: { stdoutBytes: 512 * 1024, stderrBytes: 512 * 1024 },
		repoPath: path.resolve(
			process.cwd(),
			"tests/security-capability",
			params.fixtureRoot,
			params.fixture,
		),
		hostOutDir: out,
		workingDirectory: "",
		command: params.command,
		writableWorkdir: true,
		expectedArtifacts: [],
		timeoutSec: 120,
	});
}

describe("tier-1 Go race recipe", () => {
	it("detects the vulnerable fixture and accepts the fixed fixture in the isolated dynamic image", async () => {
		const vulnerable = await runGoRace("vulnerable");
		expect(vulnerable.exitCode).not.toBe(0);
		expect(vulnerable.timedOut).toBe(false);

		const fixed = await runGoRace("fixed");
		expect(fixed.ok).toBe(true);
		expect(fixed.exitCode).toBe(0);
	}, 120_000);
});

describe("bounded Go fuzz recipe", () => {
	it("detects the seeded crash and completes against the fixed fixture within its budget", async () => {
		const vulnerable = await runGoFuzz("vulnerable");
		expect(vulnerable.exitCode).not.toBe(0);
		expect(vulnerable.timedOut).toBe(false);

		const fixed = await runGoFuzz("fixed");
		expect(fixed.ok).toBe(true);
		expect(fixed.exitCode).toBe(0);
	}, 120_000);
});
