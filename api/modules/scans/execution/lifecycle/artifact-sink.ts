import path from "node:path";
import {
	type ScanArtifactKind,
	scanArtifactKindSchema,
} from "../../../../../shared/schemas/scan.schema";
import type { ArtifactRepository } from "./artifact-repository";
import type { ArtifactOwner, ArtifactStorage } from "./artifact-storage";

export type ScanArtifactRole = ScanArtifactKind;

export type PersistedScanArtifact = {
	id: string;
	path: string;
	storageKey: string;
	sha256: string;
	sizeBytes: number;
	kind: ScanArtifactKind;
};

type StoredArtifact = {
	path: string;
	sha256: string;
	sizeBytes: number;
};

const ROLE_LOCATION: Record<
	ScanArtifactRole,
	{ subDir: string; extension: string }
> = {
	raw_result: { subDir: "raw", extension: "json" },
	stdout: { subDir: "logs", extension: "log" },
	stderr: { subDir: "logs", extension: "log" },
	log: { subDir: "logs", extension: "log" },
	normalized_result: { subDir: "normalized", extension: "json" },
	source_snippet: { subDir: "source", extension: "txt" },
	report: { subDir: "reports", extension: "md" },
	diff_manifest: { subDir: "diff", extension: "json" },
	sbom: { subDir: "sbom", extension: "json" },
	dast_raw_result: { subDir: "dast", extension: "json" },
	diagnostic_report: { subDir: "diagnostic", extension: "md" },
	runtime_diagnostic: { subDir: "runtime", extension: "json" },
};

/**
 * The only production boundary that is allowed to both write a scan artifact
 * and register it.  A storage key is deterministic inside an owner namespace,
 * so duplicate writes fail closed; a failed insert removes the just-created
 * file before the error reaches a runner.
 */
export class ScanArtifactSink {
	private readonly storage: ArtifactStorage;

	constructor(
		storage: ArtifactStorage,
		private readonly repository: ArtifactRepository,
		private readonly owner: ArtifactOwner,
	) {
		this.storage = storage.forOwner(owner);
	}

	async saveFile(input: {
		role: ScanArtifactRole;
		format: string;
		sourcePath: string;
		metadata?: Record<string, unknown>;
	}): Promise<PersistedScanArtifact> {
		const location = this.location(input.role, input.format);
		const saved = await this.storage.saveFileArtifact(
			this.owner.scanRunId,
			location.subDir,
			input.sourcePath,
			location.filename,
		);
		return await this.registerSaved({
			role: input.role,
			format: input.format,
			saved,
			metadata: input.metadata,
		});
	}

	async saveText(input: {
		role: ScanArtifactRole;
		format: string;
		content: string;
		metadata?: Record<string, unknown>;
	}): Promise<PersistedScanArtifact> {
		const location = this.location(input.role, input.format);
		const saved = await this.storage.saveTextArtifact(
			this.owner.scanRunId,
			location.subDir,
			input.content,
			location.filename,
		);
		return await this.registerSaved({
			role: input.role,
			format: input.format,
			saved,
			metadata: input.metadata,
		});
	}

	/** Registers a file already written by a scanner and removes it if the insert fails. */
	async registerSaved(input: {
		role: ScanArtifactRole;
		format: string;
		saved: StoredArtifact;
		metadata?: Record<string, unknown>;
	}): Promise<PersistedScanArtifact> {
		const ownerPrefix = path.join(
			this.owner.scanRunId,
			"owners",
			this.owner.kind,
			this.owner.id,
		);
		if (
			input.saved.path === ownerPrefix ||
			!input.saved.path.startsWith(`${ownerPrefix}${path.sep}`)
		) {
			throw new Error("Artifact does not belong to its declared owner.");
		}
		return await this.register(
			input.saved,
			input.role,
			input.format,
			input.metadata,
		);
	}

	private location(role: ScanArtifactRole, format: string) {
		const base = ROLE_LOCATION[role];
		const extension = extensionForFormat(format) ?? base.extension;
		return { subDir: base.subDir, filename: `${role}.${extension}` };
	}

	private async register(
		saved: StoredArtifact,
		role: ScanArtifactRole,
		format: string,
		metadata?: Record<string, unknown>,
	): Promise<PersistedScanArtifact> {
		const kind = scanArtifactKindSchema.parse(role);
		try {
			const artifact = await this.repository.createArtifact({
				scanRunId: this.owner.scanRunId,
				toolRunId: this.owner.kind === "tool-run" ? this.owner.id : null,
				kind,
				format,
				path: saved.path,
				storageKey: saved.path,
				sha256: saved.sha256,
				sizeBytes: saved.sizeBytes,
				metadata,
			});
			return {
				id: artifact.id,
				path: artifact.path,
				storageKey: artifact.storageKey ?? saved.path,
				sha256: artifact.sha256,
				sizeBytes: artifact.sizeBytes,
				kind,
			};
		} catch (error) {
			await this.storage.removeArtifacts([saved.path]).catch(() => undefined);
			throw error;
		}
	}
}

function extensionForFormat(format: string): string | null {
	if (format === "json" || format === "cyclonedx-json") return "json";
	if (format === "jsonl") return "jsonl";
	if (format === "markdown") return "md";
	if (format === "text") return "log";
	if (!/^[a-z0-9]+(?:[-+][a-z0-9]+)*$/i.test(format)) return null;
	return null;
}
