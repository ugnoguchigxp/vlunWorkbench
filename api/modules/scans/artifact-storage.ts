import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface ArtifactSaveResult {
	path: string; // Relative path from artifact root
	sha256: string;
	sizeBytes: number;
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

		await fs.writeFile(targetPath, buffer);

		const relativePath = path.relative(this.baseDir, targetPath);

		return {
			path: relativePath,
			sha256,
			sizeBytes,
		};
	}
}
