import crypto from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function sha256(value: string | Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export async function sha256File(filePath: string): Promise<string> {
	return sha256(await readFile(filePath));
}

export async function sha256Tree(inputPaths: string[]): Promise<string> {
	const files = (
		await Promise.all(inputPaths.map((inputPath) => listFiles(inputPath)))
	)
		.flat()
		.sort();
	const hash = crypto.createHash("sha256");
	for (const file of files) {
		hash.update(path.relative(process.cwd(), file));
		hash.update("\0");
		hash.update(await readFile(file));
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

export async function gitCommit(): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await child.exited) !== 0) throw new Error("git_commit_unavailable");
	const value = (await new Response(child.stdout).text()).trim();
	if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("git_commit_invalid");
	return value;
}

async function listFiles(inputPath: string): Promise<string[]> {
	const resolved = path.resolve(inputPath);
	const metadata = await stat(resolved);
	if (metadata.isFile()) return [resolved];
	if (!metadata.isDirectory()) return [];
	const entries = await readdir(resolved, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.filter((entry) => !entry.name.startsWith("."))
			.map((entry) => listFiles(path.join(resolved, entry.name))),
	);
	return nested.flat();
}
