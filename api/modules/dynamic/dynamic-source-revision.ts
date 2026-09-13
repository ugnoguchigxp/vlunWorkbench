import { runGitCommand } from "../scans/execution/diff/git-command";

export async function resolveImmutableHead(
	repositoryPath: string,
): Promise<string> {
	const { stdout } = await runGitCommand({
		cwd: repositoryPath,
		args: ["rev-parse", "HEAD"],
		timeoutMs: 30_000,
		maxBufferBytes: 256,
	});
	const revision = stdout.toString("utf8").trim();
	if (!/^[a-f0-9]{40,64}$/i.test(revision)) {
		throw new Error("dynamic_source_revision_invalid");
	}
	return revision;
}
