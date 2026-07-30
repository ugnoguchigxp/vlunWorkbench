import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type TextArtifactInput = {
	subDir: string;
	content: string;
	filename: string;
};

export interface ArtifactSaveResult {
	path: string; // Relative path from artifact root
	sha256: string;
	sizeBytes: number;
}

export class ArtifactSizeLimitError extends Error {
	constructor(readonly maxBytes: number) {
		super("Artifact exceeds the configured read limit.");
		this.name = "ArtifactSizeLimitError";
	}
}

export class ArtifactStorage {
	private readonly baseDir: string;

	constructor(baseDir?: string) {
		this.baseDir =
			baseDir ??
			process.env.SCAN_ARTIFACT_ROOT ??
			path.resolve(process.cwd(), "artifacts", "scans");
	}

	private getScanDir(scanRunId: string): string {
		return path.resolve(this.baseDir, scanRunId);
	}

	private validatePath(targetPath: string, scanRunId: string): void {
		const scanDir = this.getScanDir(scanRunId);
		const resolvedTarget = path.resolve(targetPath);
		const relative = path.relative(scanDir, resolvedTarget);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of scan directory.",
			);
		}
	}

	async saveRawArtifact(
		scanRunId: string,
		sourcePath: string,
		suggestedFilename?: string,
	): Promise<ArtifactSaveResult> {
		const scanDir = this.getScanDir(scanRunId);
		const rawDir = path.join(scanDir, "raw");
		await fs.mkdir(rawDir, { recursive: true });

		const filename = suggestedFilename ?? path.basename(sourcePath);
		const targetPath = path.join(rawDir, filename);
		this.validatePath(targetPath, scanRunId);

		// Read source
		const content = await fs.readFile(sourcePath);
		const sizeBytes = content.length;
		const sha256 = crypto.createHash("sha256").update(content).digest("hex");

		// Write to target
		await fs.writeFile(targetPath, content);

		const relativePath = path.relative(this.baseDir, targetPath);

		return {
			path: relativePath,
			sha256,
			sizeBytes,
		};
	}

	async saveLog(
		scanRunId: string,
		logType: "stdout" | "stderr" | "log",
		content: string,
		suggestedFilename?: string,
		options?: { mode?: number },
	): Promise<ArtifactSaveResult> {
		const scanDir = this.getScanDir(scanRunId);
		const logDir = path.join(scanDir, "logs");
		await fs.mkdir(logDir, { recursive: true });

		const filename = suggestedFilename ?? `${logType}.log`;
		const targetPath = path.join(logDir, filename);
		this.validatePath(targetPath, scanRunId);

		const buffer = Buffer.from(content, "utf8");
		const sizeBytes = buffer.length;
		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

		await fs.writeFile(targetPath, buffer, { mode: options?.mode });
		if (options?.mode !== undefined) await fs.chmod(targetPath, options.mode);

		const relativePath = path.relative(this.baseDir, targetPath);

		return {
			path: relativePath,
			sha256,
			sizeBytes,
		};
	}

	async saveTextArtifact(
		scanRunId: string,
		subDir: string,
		content: string,
		filename: string,
		options?: { mode?: number },
	): Promise<ArtifactSaveResult> {
		const scanDir = this.getScanDir(scanRunId);
		const targetDir = path.join(scanDir, subDir);
		await fs.mkdir(targetDir, { recursive: true });

		const targetPath = path.join(targetDir, filename);
		this.validatePath(targetPath, scanRunId);

		const buffer = Buffer.from(content, "utf8");
		const sizeBytes = buffer.length;
		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

		await fs.writeFile(targetPath, buffer, { mode: options?.mode });
		if (options?.mode !== undefined) await fs.chmod(targetPath, options.mode);

		const relativePath = path.relative(this.baseDir, targetPath);

		return {
			path: relativePath,
			sha256,
			sizeBytes,
		};
	}

	async saveTextArtifactsAtomically(
		scanRunId: string,
		artifacts: TextArtifactInput[],
	): Promise<ArtifactSaveResult[]> {
		if (artifacts.length === 0) return [];

		const scanDir = this.getScanDir(scanRunId);
		const stagingDir = path.join(scanDir, ".staging", crypto.randomUUID());
		const staged: Array<{
			targetPath: string;
			stagedPath: string;
			result: ArtifactSaveResult;
		}> = [];
		const movedPaths: string[] = [];

		try {
			await fs.mkdir(stagingDir, { recursive: true });
			for (const [index, artifact] of artifacts.entries()) {
				const targetDir = path.join(scanDir, artifact.subDir);
				const targetPath = path.join(targetDir, artifact.filename);
				this.validatePath(targetPath, scanRunId);
				const existing = await fs.stat(targetPath).catch(() => null);
				if (existing) {
					throw new Error("Artifact target already exists.");
				}

				const buffer = Buffer.from(artifact.content, "utf8");
				const stagedPath = path.join(stagingDir, `${index}.artifact`);
				await fs.writeFile(stagedPath, buffer);
				staged.push({
					targetPath,
					stagedPath,
					result: {
						path: path.relative(this.baseDir, targetPath),
						sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
						sizeBytes: buffer.length,
					},
				});
			}

			for (const artifact of staged) {
				await fs.mkdir(path.dirname(artifact.targetPath), { recursive: true });
				await fs.rename(artifact.stagedPath, artifact.targetPath);
				movedPaths.push(artifact.result.path);
			}
			return staged.map((artifact) => artifact.result);
		} catch (error) {
			await this.removeArtifacts(movedPaths).catch(() => undefined);
			throw error;
		} finally {
			await fs.rm(stagingDir, { recursive: true, force: true });
		}
	}

	async removeArtifacts(relativePaths: string[]): Promise<void> {
		await Promise.all(
			relativePaths.map(async (relativePath) => {
				const targetPath = path.resolve(this.baseDir, relativePath);
				const relative = path.relative(this.baseDir, targetPath);
				if (relative.startsWith("..") || path.isAbsolute(relative)) {
					throw new Error(
						"Path traversal detected: target path is outside of artifact root.",
					);
				}
				await fs.rm(targetPath, { force: true });
			}),
		);
	}

	async readTextArtifact(
		relativePath: string,
		options: { maxBytes?: number } = {},
	): Promise<string> {
		const targetPath = path.resolve(this.baseDir, relativePath);
		const relative = path.relative(this.baseDir, targetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of artifact root.",
			);
		}
		const [canonicalBase, canonicalTarget] = await Promise.all([
			fs.realpath(this.baseDir),
			fs.realpath(targetPath),
		]);
		const canonicalRelative = path.relative(canonicalBase, canonicalTarget);
		if (
			canonicalRelative.startsWith("..") ||
			path.isAbsolute(canonicalRelative)
		) {
			throw new Error(
				"Path traversal detected: artifact symlink resolves outside of artifact root.",
			);
		}
		if (options.maxBytes === undefined) {
			return await fs.readFile(canonicalTarget, "utf8");
		}
		if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
			throw new RangeError(
				"Artifact read limit must be a non-negative safe integer.",
			);
		}

		const handle = await fs.open(canonicalTarget, "r");
		try {
			const stat = await handle.stat();
			if (stat.size > options.maxBytes) {
				throw new ArtifactSizeLimitError(options.maxBytes);
			}
			const chunks: Buffer[] = [];
			let total = 0;
			while (total <= options.maxBytes) {
				const buffer = Buffer.allocUnsafe(
					Math.min(64 * 1024, options.maxBytes + 1 - total),
				);
				const { bytesRead } = await handle.read(
					buffer,
					0,
					buffer.length,
					total,
				);
				if (bytesRead === 0) break;
				chunks.push(buffer.subarray(0, bytesRead));
				total += bytesRead;
			}
			if (total > options.maxBytes) {
				throw new ArtifactSizeLimitError(options.maxBytes);
			}
			return Buffer.concat(chunks, total).toString("utf8");
		} finally {
			await handle.close();
		}
	}
}
