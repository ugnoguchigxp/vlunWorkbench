import type {
	DiffPathStatus,
	DiffTargetErrorCode,
} from "../../../shared/schemas/scan-target.schema";

export const DIFF_SCAN_LIMITS = {
	maxFiles: 5_000,
	maxTotalBytes: 512 * 1024 * 1024,
	maxSingleFileBytes: 20 * 1024 * 1024,
} as const;

export type RawDiffEntry = {
	status: DiffPathStatus;
	path: string;
	oldPath?: string;
};

export type TreeEntry = {
	mode: string;
	type: string;
	objectId: string;
	size: number | null;
};

export class GitDiffResolutionError extends Error {
	constructor(
		readonly code: DiffTargetErrorCode,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "GitDiffResolutionError";
	}
}
