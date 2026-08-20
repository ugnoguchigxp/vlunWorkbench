import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../scans/normalizers/redaction";

export interface ArtifactSaveResult {
	path: string; // Relative path from reproduction baseDir
	sha256: string;
	sizeBytes: number;
}

export class ReproductionArtifactStorage {
	private readonly baseDir: string;

	constructor(baseDir?: string) {
		this.baseDir =
			baseDir ??
			process.env.REPRODUCTION_ARTIFACT_ROOT ??
			path.resolve(process.cwd(), "artifacts", "reproductions");
	}

	private getRunDir(reproductionRunId: string): string {
		return path.resolve(this.baseDir, reproductionRunId);
	}

	private validateRunDirectory(reproductionRunId: string): string {
		const runDir = this.getRunDir(reproductionRunId);
		const relative = path.relative(this.baseDir, runDir);
		if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
			throw new Error(
				"Path traversal detected: reproduction run directory is outside of artifact root.",
			);
		}
		return runDir;
	}

	private validatePath(targetPath: string, reproductionRunId: string): void {
		const runDir = this.getRunDir(reproductionRunId);
		const resolvedTarget = path.resolve(targetPath);
		const relative = path.relative(runDir, resolvedTarget);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of reproduction directory.",
			);
		}
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
	}

	async saveReproductionRawArtifact(
		reproductionRunId: string,
		sourcePath: string,
		suggestedFilename?: string,
	): Promise<ArtifactSaveResult> {
		const runDir = this.getRunDir(reproductionRunId);
		const rawDir = path.join(runDir, "raw");
		await fs.mkdir(rawDir, { recursive: true });

		const filename = this.sanitizeFilename(
			suggestedFilename ?? path.basename(sourcePath),
		);
		const targetPath = path.join(rawDir, filename);
		this.validatePath(targetPath, reproductionRunId);

		// Read source
		const contentStr = await fs.readFile(sourcePath, "utf8");

		// Redact secrets
		let redactedContent: string;
		try {
			const parsed = JSON.parse(contentStr);
			// Redact JSON secrets
			redactedContent = JSON.stringify(parsed);
			redactedContent = redactSecrets(redactedContent);
		} catch {
			redactedContent = redactSecrets(contentStr);
		}

		const buffer = Buffer.from(redactedContent, "utf8");
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

	async saveReproductionLog(
		reproductionRunId: string,
		logType: "stdout" | "stderr" | "log" | "summary",
		content: string,
		suggestedFilename?: string,
	): Promise<ArtifactSaveResult> {
		const runDir = this.getRunDir(reproductionRunId);
		const logDir = path.join(runDir, "logs");
		await fs.mkdir(logDir, { recursive: true });

		const filename = this.sanitizeFilename(
			suggestedFilename ?? `${logType}.log`,
		);
		const targetPath = path.join(logDir, filename);
		this.validatePath(targetPath, reproductionRunId);

		// Redact secrets from logs
		const redactedContent = redactSecrets(content);

		const buffer = Buffer.from(redactedContent, "utf8");
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

	async readReproductionTextArtifact(relativePath: string): Promise<string> {
		const targetPath = path.resolve(this.baseDir, relativePath);
		const relative = path.relative(this.baseDir, targetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of reproduction root.",
			);
		}
		return await fs.readFile(targetPath, "utf8");
	}

	async removeRunDirectory(reproductionRunId: string): Promise<void> {
		await fs.rm(this.validateRunDirectory(reproductionRunId), {
			recursive: true,
			force: true,
		});
	}
}
