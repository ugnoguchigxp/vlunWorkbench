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

export type ArtifactOwnerKind =
	| "tool-run"
	| "report"
	| "scan"
	| "dast"
	| "diagnostic";

const ARTIFACT_OWNER_KINDS: readonly ArtifactOwnerKind[] = [
	"tool-run",
	"report",
	"scan",
	"dast",
	"diagnostic",
];

/**
 * A server-generated owner namespace for artifacts belonging to one producer.
 * A scan run may execute several tools concurrently, so the scan run ID alone
 * is not a sufficient write namespace.
 */
export type ArtifactOwner = {
	scanRunId: string;
	kind: ArtifactOwnerKind;
	id: string;
};

export class ArtifactSizeLimitError extends Error {
	constructor(readonly maxBytes: number) {
		super("Artifact exceeds the configured read limit.");
		this.name = "ArtifactSizeLimitError";
	}
}

export class ArtifactStorage {
	private readonly baseDir: string;
	private readonly owner: ArtifactOwner | null;

	constructor(baseDir?: string, owner: ArtifactOwner | null = null) {
		this.baseDir =
			baseDir ??
			process.env.SCAN_ARTIFACT_ROOT ??
			path.resolve(process.cwd(), "artifacts", "scans");
		this.owner = owner;
	}

	/** Returns an isolated writer for one tool/report producer. */
	forOwner(owner: ArtifactOwner): ArtifactStorage {
		this.assertPathComponent(owner.scanRunId, "scan run ID");
		this.assertPathComponent(owner.id, "artifact owner ID");
		if (!ARTIFACT_OWNER_KINDS.includes(owner.kind)) {
			throw new Error("Invalid artifact owner kind.");
		}
		return new ArtifactStorage(this.baseDir, owner);
	}

	forToolRun(scanRunId: string, toolRunId: string): ArtifactStorage {
		return this.forOwner({ scanRunId, kind: "tool-run", id: toolRunId });
	}

	private getScanDir(scanRunId: string): string {
		this.assertPathComponent(scanRunId, "scan run ID");
		return path.resolve(this.baseDir, scanRunId);
	}

	private assertPathComponent(value: string, label: string): void {
		if (
			!value ||
			value === "." ||
			value === ".." ||
			value.includes("/") ||
			value.includes("\\") ||
			path.isAbsolute(value)
		) {
			throw new Error(`Invalid ${label}.`);
		}
	}

	private getArtifactDir(scanRunId: string): string {
		if (!this.owner) return this.getScanDir(scanRunId);
		if (this.owner.scanRunId !== scanRunId) {
			throw new Error("Artifact owner does not belong to this scan run.");
		}
		return path.join(
			this.getScanDir(scanRunId),
			"owners",
			this.owner.kind,
			this.owner.id,
		);
	}

	private validatePath(targetPath: string, scanRunId: string): void {
		const scanDir = this.getArtifactDir(scanRunId);
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
		return await this.saveFileArtifact(
			scanRunId,
			"raw",
			sourcePath,
			suggestedFilename ?? path.basename(sourcePath),
		);
	}

	/** Copies a file into a caller-selected artifact role directory without decoding it. */
	async saveFileArtifact(
		scanRunId: string,
		subDir: string,
		sourcePath: string,
		filename: string,
	): Promise<ArtifactSaveResult> {
		const scanDir = this.getArtifactDir(scanRunId);
		const targetDir = path.join(scanDir, subDir);
		const targetPath = path.join(targetDir, filename);
		this.validatePath(targetPath, scanRunId);
		await fs.mkdir(targetDir, { recursive: true });

		const content = await fs.readFile(sourcePath);
		await fs.writeFile(targetPath, content, { flag: "wx" });
		return {
			path: path.relative(this.baseDir, targetPath),
			sha256: crypto.createHash("sha256").update(content).digest("hex"),
			sizeBytes: content.length,
		};
	}

	async saveLog(
		scanRunId: string,
		logType: "stdout" | "stderr" | "log",
		content: string,
		suggestedFilename?: string,
		options?: { mode?: number },
	): Promise<ArtifactSaveResult> {
		const scanDir = this.getArtifactDir(scanRunId);
		const logDir = path.join(scanDir, "logs");
		await fs.mkdir(logDir, { recursive: true });

		const filename = suggestedFilename ?? `${logType}.log`;
		const targetPath = path.join(logDir, filename);
		this.validatePath(targetPath, scanRunId);

		const buffer = Buffer.from(content, "utf8");
		const sizeBytes = buffer.length;
		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

		await fs.writeFile(targetPath, buffer, {
			mode: options?.mode,
			flag: "wx",
		});
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
		const scanDir = this.getArtifactDir(scanRunId);
		const targetDir = path.join(scanDir, subDir);
		await fs.mkdir(targetDir, { recursive: true });

		const targetPath = path.join(targetDir, filename);
		this.validatePath(targetPath, scanRunId);

		const buffer = Buffer.from(content, "utf8");
		const sizeBytes = buffer.length;
		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

		await fs.writeFile(targetPath, buffer, {
			mode: options?.mode,
			flag: "wx",
		});
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

		const scanDir = this.getArtifactDir(scanRunId);
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
				// link(2) is exclusive at the target path, unlike rename(2), which
				// could silently replace a concurrently-created artifact.
				await fs.link(artifact.stagedPath, artifact.targetPath);
				movedPaths.push(artifact.result.path);
				await fs.rm(artifact.stagedPath, { force: true });
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
				if (this.owner) {
					const ownerDir = this.getArtifactDir(this.owner.scanRunId);
					const ownerRelative = path.relative(ownerDir, targetPath);
					if (
						ownerRelative.startsWith("..") ||
						path.isAbsolute(ownerRelative)
					) {
						throw new Error(
							"Artifact owner cannot remove artifacts outside its namespace.",
						);
					}
				}
				await fs.rm(targetPath, { force: true });
			}),
		);
	}

	/** Removes only the directory addressed by a server-owned scan run ID. */
	async removeRunDirectory(scanRunId: string): Promise<void> {
		const scanDir = this.getScanDir(scanRunId);
		const relative = path.relative(this.baseDir, scanDir);
		if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
			throw new Error(
				"Path traversal detected: scan directory is outside of artifact root.",
			);
		}
		await fs.rm(scanDir, { recursive: true, force: true });
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

	async hashArtifact(
		relativePath: string,
		options: { maxBytes: number },
	): Promise<{ sha256: string; sizeBytes: number }> {
		if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
			throw new RangeError(
				"Artifact hash limit must be a non-negative safe integer.",
			);
		}
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

		const handle = await fs.open(canonicalTarget, "r");
		try {
			const stat = await handle.stat();
			if (stat.size > options.maxBytes) {
				throw new ArtifactSizeLimitError(options.maxBytes);
			}
			const hash = crypto.createHash("sha256");
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
				hash.update(buffer.subarray(0, bytesRead));
				total += bytesRead;
			}
			if (total > options.maxBytes) {
				throw new ArtifactSizeLimitError(options.maxBytes);
			}
			return { sha256: hash.digest("hex"), sizeBytes: total };
		} finally {
			await handle.close();
		}
	}

	async verifyArtifact(
		relativePath: string,
		expected: Pick<ArtifactSaveResult, "sha256" | "sizeBytes">,
		options: { maxBytes: number },
	): Promise<boolean> {
		const actual = await this.hashArtifact(relativePath, options);
		return (
			actual.sha256 === expected.sha256 &&
			actual.sizeBytes === expected.sizeBytes
		);
	}
}
