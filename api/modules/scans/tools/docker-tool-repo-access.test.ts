import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	acquireDockerInputAccess,
	acquireDockerRepoAccess,
} from "./docker-tool-repo-access";

const cleanup: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanup.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })),
	);
});

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "docker-repo-access-"));
	cleanup.push(root);
	return root;
}

async function modeOf(target: string): Promise<number> {
	return (await fs.stat(target)).mode & 0o777;
}

describe("Docker repo and input access leases", () => {
	it("grants other read/traverse on a private directory and restores the original mode", async () => {
		const dir = path.join(await tempRoot(), "repo");
		await fs.mkdir(dir);
		await fs.chmod(dir, 0o700);

		const lease = await acquireDockerRepoAccess(dir);
		expect(lease.originalMode).toBe(0o700);
		expect(lease.executionMode).toBe(0o705);
		expect(await modeOf(dir)).toBe(0o705);

		await lease.release();
		await lease.release();
		expect(await modeOf(dir)).toBe(0o700);
	});

	it("shares one directory lease across concurrent scanners and skips chmod when bits already exist", async () => {
		const dir = path.join(await tempRoot(), "repo");
		await fs.mkdir(dir);
		await fs.chmod(dir, 0o755);

		const first = await acquireDockerRepoAccess(dir);
		const second = await acquireDockerRepoAccess(dir);
		expect(first.originalMode).toBe(0o755);
		expect(first.executionMode).toBe(0o755);
		expect(second.executionMode).toBe(first.executionMode);
		expect(await modeOf(dir)).toBe(0o755);

		await first.release();
		expect(await modeOf(dir)).toBe(0o755);
		await second.release();
		expect(await modeOf(dir)).toBe(0o755);
	});

	it("rejects a file as a repository mount", async () => {
		const file = path.join(await tempRoot(), "not-a-dir");
		await fs.writeFile(file, "payload\n");
		await expect(acquireDockerRepoAccess(file)).rejects.toThrow(
			"Docker tool repository mount must be a directory.",
		);
	});

	it("grants other-read on a private input file and restores it after overlapping leases", async () => {
		const file = path.join(await tempRoot(), "input.json");
		await fs.writeFile(file, "{}\n");
		await fs.chmod(file, 0o600);

		const first = await acquireDockerInputAccess(file);
		const second = await acquireDockerInputAccess(file);
		expect(first.originalMode).toBe(0o600);
		expect(first.executionMode).toBe(0o604);
		expect(await modeOf(file)).toBe(0o604);

		await Promise.all([first.release(), second.release()]);
		expect(await modeOf(file)).toBe(0o600);
	});

	it("skips chmod for world-readable input files and rejects directories", async () => {
		const root = await tempRoot();
		const file = path.join(root, "readable.json");
		await fs.writeFile(file, "{}\n");
		await fs.chmod(file, 0o644);

		const lease = await acquireDockerInputAccess(file);
		expect(lease.originalMode).toBe(0o644);
		expect(lease.executionMode).toBe(0o644);
		await lease.release();
		await lease.release();
		expect(await modeOf(file)).toBe(0o644);

		await expect(acquireDockerInputAccess(root)).rejects.toThrow(
			"Docker tool input mount must be a file.",
		);
	});
});
