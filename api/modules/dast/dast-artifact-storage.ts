import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../scans/normalizers/redaction";

export interface DastArtifactSaveResult {
	path: string;
	sha256: string;
	sizeBytes: number;
}

export class DastArtifactStorage {
	private readonly baseDir: string;

	constructor(baseDir?: string) {
		this.baseDir =
			baseDir ??
			process.env.DAST_ARTIFACT_ROOT ??
			path.resolve(process.cwd(), "artifacts", "dast");
	}

	private getRunDir(dastRunId: string): string {
		return path.resolve(this.baseDir, dastRunId);
	}

	private validatePath(targetPath: string, dastRunId: string): void {
		const runDir = this.getRunDir(dastRunId);
		const resolvedTarget = path.resolve(targetPath);
		const relative = path.relative(runDir, resolvedTarget);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of DAST run directory.",
			);
		}
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
	}

	private async saveBuffer(params: {
		dastRunId: string;
		subDir: string;
		filename: string;
		buffer: Uint8Array;
	}): Promise<DastArtifactSaveResult> {
		const runDir = this.getRunDir(params.dastRunId);
		const targetDir = path.join(runDir, this.sanitizeFilename(params.subDir));
		await fs.mkdir(targetDir, { recursive: true });
		const targetPath = path.join(
			targetDir,
			this.sanitizeFilename(params.filename),
		);
		this.validatePath(targetPath, params.dastRunId);

		const buffer = Buffer.from(params.buffer);
		await fs.writeFile(targetPath, buffer);
		return {
			path: path.relative(this.baseDir, targetPath),
			sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
			sizeBytes: buffer.length,
		};
	}

	async saveJsonArtifact(
		dastRunId: string,
		subDir: string,
		value: unknown,
		filename: string,
	): Promise<DastArtifactSaveResult> {
		const content = redactSecrets(JSON.stringify(value, null, 2));
		return await this.saveBuffer({
			dastRunId,
			subDir,
			filename,
			buffer: Buffer.from(content, "utf8"),
		});
	}

	async saveTextArtifact(
		dastRunId: string,
		subDir: string,
		content: string,
		filename: string,
	): Promise<DastArtifactSaveResult> {
		return await this.saveBuffer({
			dastRunId,
			subDir,
			filename,
			buffer: Buffer.from(redactSecrets(content), "utf8"),
		});
	}

	async saveBinaryArtifact(
		dastRunId: string,
		subDir: string,
		content: Uint8Array,
		filename: string,
	): Promise<DastArtifactSaveResult> {
		return await this.saveBuffer({
			dastRunId,
			subDir,
			filename,
			buffer: content,
		});
	}

	async readArtifact(relativePath: string): Promise<Buffer> {
		const targetPath = path.resolve(this.baseDir, relativePath);
		const relative = path.relative(this.baseDir, targetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			throw new Error(
				"Path traversal detected: target path is outside of DAST artifact root.",
			);
		}
		return await fs.readFile(targetPath);
	}

	async readTextArtifact(relativePath: string): Promise<string> {
		return (await this.readArtifact(relativePath)).toString("utf8");
	}
}
