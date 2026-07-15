import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const FINGERPRINT_VERSION = "project-source-v1";
const SCAN_PROFILE_VERSION = "structure-only-v1";
const STATIC_INTELLIGENCE_SCHEMA_VERSION = "static-intelligence-export-v1";
const GENERATION_BUILDER_VERSION = "phase-44-v1";
const IGNORED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"dist-web",
	"build",
	"coverage",
	"artifacts",
]);

export type ProjectSourceFingerprint = {
	value: string;
	fileCount: number;
	version: typeof FINGERPRINT_VERSION;
};

export async function computeProjectSourceFingerprint(
	projectPath: string,
): Promise<ProjectSourceFingerprint> {
	const files = await listSourceFiles(projectPath);
	const hash = createHash("sha256");
	hash.update(
		JSON.stringify({
			version: FINGERPRINT_VERSION,
			scanProfile: SCAN_PROFILE_VERSION,
			schema: STATIC_INTELLIGENCE_SCHEMA_VERSION,
			builder: GENERATION_BUILDER_VERSION,
		}),
	);
	for (const relativePath of files) {
		const absolutePath = path.join(projectPath, relativePath);
		const stat = await fsp.stat(absolutePath);
		hash.update(`\0${relativePath}\0${stat.size}\0`);
		await appendFileHash(hash, absolutePath);
	}
	return {
		value: hash.digest("hex"),
		fileCount: files.length,
		version: FINGERPRINT_VERSION,
	};
}

async function listSourceFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const visit = async (directory: string): Promise<void> => {
		const entries = await fsp.readdir(directory, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(absolutePath);
			} else if (entry.isFile()) {
				files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
			}
			if (files.length > 20_000) {
				throw new Error("Project source contains more than 20000 files.");
			}
		}
	};
	await visit(root);
	return files.sort((a, b) => a.localeCompare(b));
}

async function appendFileHash(
	target: ReturnType<typeof createHash>,
	filePath: string,
): Promise<void> {
	const fileHash = createHash("sha256");
	await new Promise<void>((resolve, reject) => {
		const stream = fs.createReadStream(filePath);
		stream.on("data", (chunk) => fileHash.update(chunk));
		stream.on("error", reject);
		stream.on("end", resolve);
	});
	target.update(fileHash.digest("hex"));
}
