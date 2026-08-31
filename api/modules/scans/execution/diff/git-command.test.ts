import path from "node:path";
import { describe, expect, test } from "bun:test";
import { runGitText } from "./git-command";

describe("Git command capture", () => {
	test("captures a full HEAD on macOS and Linux without relying on child pipes", async () => {
		const repositoryRoot = path.resolve(import.meta.dir, "../../../../../");
		const head = (
			await runGitText({
				cwd: repositoryRoot,
				args: ["rev-parse", "--verify", "HEAD^{commit}"],
			})
		).trim();
		expect(head).toMatch(/^[a-f0-9]{40}$/);
	});

	test("preserves stdin binding while capturing Git output", async () => {
		const repositoryRoot = path.resolve(import.meta.dir, "../../../../../");
		const hash = (
			await runGitText({
				cwd: repositoryRoot,
				args: ["hash-object", "--stdin"],
				input: "scanner-hardening\n",
			})
		).trim();
		expect(hash).toMatch(/^[a-f0-9]{40}$/);
	});

	test("terminates capture when the configured output bound is exceeded", async () => {
		const repositoryRoot = path.resolve(import.meta.dir, "../../../../../");
		await expect(
			runGitText({
				cwd: repositoryRoot,
				args: ["show", "HEAD:package.json"],
				maxBufferBytes: 8,
			}),
		).rejects.toThrow("output exceeded the configured limit");
	});
});
