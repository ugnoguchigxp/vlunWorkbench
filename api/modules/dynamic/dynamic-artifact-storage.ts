import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../scans/normalizers/redaction";

export interface ArtifactSaveResult {
	path: string; // Relative path from dynamic baseDir
	sha256: string;
	sizeBytes: number;
}

export const DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DYNAMIC_ARTIFACT_TOTAL_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT = 128;
export const DEFAULT_DYNAMIC_ARTIFACT_DIRECTORY_DEPTH_LIMIT = 16;
export const DEFAULT_DYNAMIC_ARTIFACT_ENTRY_LIMIT = 2_048;

export class DynamicArtifactStorage {
	private readonly baseDir: string;
	private readonly maxFileBytes: number;

	constructor(
		baseDir?: string,
		options: {
			maxFileBytes?: number;
		} = {},
	) {
		this.baseDir =
			baseDir ??
			process.env.DYNAMIC_ARTIFACT_ROOT ??
			path.resolve(process.cwd(), "artifacts", "dynamic");
		this.maxFileBytes =
			options.maxFileBytes ?? DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES;
		if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes <= 0) {
			throw new Error(
				"Dynamic artifact file limit must be a positive integer.",
			);
		}
	}

	private getRunDir(dynamicRunId: string): string {
		return path.resolve(this.baseDir, dynamicRunId);
	}

	private validatePath(targetPath: string, dynamicRunId: string): void {
		const runDir = this.getRunDir(dynamicRunId);
		const resolvedTarget = path.resolve(targetPath);
		const relative = path.relative(runDir, resolvedTarget);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of dynamic run directory.",
			);
		}
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
	}

	async saveDynamicRawArtifact(
		dynamicRunId: string,
		sourcePath: string,
		suggestedFilename?: string,
	): Promise<ArtifactSaveResult> {
		const runDir = this.getRunDir(dynamicRunId);
		const rawDir = path.join(runDir, "raw");
		await fs.mkdir(rawDir, { recursive: true });

		const filename = this.sanitizeFilename(
			suggestedFilename ?? path.basename(sourcePath),
		);
		const targetPath = path.join(rawDir, filename);
		this.validatePath(targetPath, dynamicRunId);

		const sourceStat = await fs.stat(sourcePath);
		if (!sourceStat.isFile() || sourceStat.size > this.maxFileBytes) {
			throw new Error(
				`dynamic_artifact_file_limit_exceeded:${sourceStat.size}:${this.maxFileBytes}`,
			);
		}

		// Read source
		const contentStr = await fs.readFile(sourcePath, "utf8");

		// Redact secrets
		let redactedContent: string;
		try {
			const parsed = JSON.parse(contentStr);
			redactedContent = JSON.stringify(parsed);
			redactedContent = redactSecrets(redactedContent);
		} catch {
			redactedContent = redactSecrets(contentStr);
		}

		const buffer = Buffer.from(redactedContent, "utf8");
		this.assertBufferWithinLimit(buffer);
		const sizeBytes = buffer.length;
		const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

		// Write to target
		await fs.writeFile(targetPath, buffer);

		const relativePath = path.relative(this.baseDir, targetPath);

		return {
			path: relativePath,
			sha256,
			sizeBytes,
		};
	}

	async saveDynamicLog(
		dynamicRunId: string,
		logType: string,
		content: string,
		suggestedFilename?: string,
	): Promise<ArtifactSaveResult> {
		const runDir = this.getRunDir(dynamicRunId);
		const logDir = path.join(runDir, "logs");
		await fs.mkdir(logDir, { recursive: true });

		const filename = this.sanitizeFilename(
			suggestedFilename ?? `${logType}.log`,
		);
		const targetPath = path.join(logDir, filename);
		this.validatePath(targetPath, dynamicRunId);

		// Redact secrets from logs
		const redactedContent = redactSecrets(content);

		const buffer = Buffer.from(redactedContent, "utf8");
		this.assertBufferWithinLimit(buffer);
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

	async saveDynamicTextArtifact(
		dynamicRunId: string,
		subDir: string,
		content: string,
		filename: string,
	): Promise<ArtifactSaveResult> {
		const runDir = this.getRunDir(dynamicRunId);
		const targetDir = path.join(runDir, this.sanitizeFilename(subDir));
		await fs.mkdir(targetDir, { recursive: true });

		const sanitizedFilename = this.sanitizeFilename(filename);
		const targetPath = path.join(targetDir, sanitizedFilename);
		this.validatePath(targetPath, dynamicRunId);

		// Redact secrets
		const redactedContent = redactSecrets(content);

		const buffer = Buffer.from(redactedContent, "utf8");
		this.assertBufferWithinLimit(buffer);
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

	async readDynamicTextArtifact(relativePath: string): Promise<string> {
		const targetPath = path.resolve(this.baseDir, relativePath);
		const relative = path.relative(this.baseDir, targetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of dynamic root.",
			);
		}
		const artifactStat = await fs.stat(targetPath);
		if (!artifactStat.isFile() || artifactStat.size > this.maxFileBytes) {
			throw new Error(
				`dynamic_artifact_file_limit_exceeded:${artifactStat.size}:${this.maxFileBytes}`,
			);
		}
		return await fs.readFile(targetPath, "utf8");
	}

	private assertBufferWithinLimit(buffer: Uint8Array): void {
		if (buffer.byteLength > this.maxFileBytes) {
			throw new Error(
				`dynamic_artifact_file_limit_exceeded:${buffer.byteLength}:${this.maxFileBytes}`,
			);
		}
	}
}
