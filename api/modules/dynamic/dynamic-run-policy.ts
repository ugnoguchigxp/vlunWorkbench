import fs from "node:fs/promises";
import path from "node:path";
import { MAX_DYNAMIC_TIMEOUT_SEC } from "../../../shared/schemas/dynamic.schema";
import type { ProcessOutputLimits } from "../scans/tools/tool-process-runner";
import {
	DEFAULT_DYNAMIC_ARTIFACT_DIRECTORY_DEPTH_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_ENTRY_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES,
	DEFAULT_DYNAMIC_ARTIFACT_TOTAL_LIMIT_BYTES,
	type DynamicArtifactStorage,
} from "./dynamic-artifact-storage";

export type DynamicArtifactCollectionLimits = {
	maxFiles: number;
	maxTotalBytes: number;
	maxFileBytes: number;
	maxDepth: number;
	maxEntries: number;
};

export type DynamicRunnerOptions = {
	outputLimits?: Partial<ProcessOutputLimits>;
	dockerDefaults?: {
		memory?: string;
		cpus?: string;
		pidsLimit?: number;
	};
	artifactLimits?: Partial<DynamicArtifactCollectionLimits>;
	storage?: DynamicArtifactStorage;
};

export function getDynamicRunMetadata(
	recordMetadata: unknown,
): Record<string, unknown> {
	return recordMetadata && typeof recordMetadata === "object"
		? (recordMetadata as Record<string, unknown>)
		: {};
}

export function classifyDynamicExecutionFailure(input: {
	error?: string;
	stderr?: string;
	exitCode?: number | null;
}): {
	status: "failed" | "timed_out";
	failureKind: string;
} {
	const text = `${input.error ?? ""}\n${input.stderr ?? ""}`.toLowerCase();
	if (text.includes("timed out") || text.includes("timeout")) {
		return { status: "timed_out", failureKind: "dynamic_timeout" };
	}
	if (text.includes("dynamic_output_limit_exceeded")) {
		return {
			status: "failed",
			failureKind: "dynamic_output_limit_exceeded",
		};
	}
	if (
		text.includes("no such image") ||
		text.includes("unable to find image") ||
		text.includes("pull access denied") ||
		text.includes("manifest unknown")
	) {
		return { status: "failed", failureKind: "docker_image_missing" };
	}
	if (
		input.exitCode === 125 ||
		input.exitCode === 127 ||
		text.includes("docker process error") ||
		text.includes("enoent") ||
		text.includes("cannot connect to the docker daemon") ||
		text.includes("is the docker daemon running")
	) {
		return { status: "failed", failureKind: "docker_unavailable" };
	}
	return { status: "failed", failureKind: "unknown_error" };
}

export function resolveDynamicTimeoutSec(
	profileTimeoutSec: number,
	requested?: number,
): number {
	if (
		!Number.isInteger(profileTimeoutSec) ||
		profileTimeoutSec <= 0 ||
		profileTimeoutSec > MAX_DYNAMIC_TIMEOUT_SEC
	) {
		throw new Error(
			`Profile timeout_sec must be a positive integer no greater than ${MAX_DYNAMIC_TIMEOUT_SEC}.`,
		);
	}
	if (requested === undefined) return profileTimeoutSec;
	if (
		!Number.isInteger(requested) ||
		requested <= 0 ||
		requested > MAX_DYNAMIC_TIMEOUT_SEC
	) {
		throw new Error(
			`Requested timeout_sec must be a positive integer no greater than ${MAX_DYNAMIC_TIMEOUT_SEC}.`,
		);
	}
	if (requested > profileTimeoutSec) {
		throw new Error("Requested timeout_sec exceeds the profile timeout_sec.");
	}
	return requested;
}

export function resolveDynamicNetworkMode(
	profileNetwork: string,
	requested?: "none" | "default",
): "none" | "default" {
	const normalizedProfile =
		profileNetwork === "default" ? "default" : ("none" as const);
	if (!requested) return normalizedProfile;
	if (requested === "default" && normalizedProfile !== "default") {
		throw new Error(
			"Requested network mode exceeds the profile network policy.",
		);
	}
	return requested;
}

export function resolveDynamicArtifactLimits(
	overrides?: Partial<DynamicArtifactCollectionLimits>,
): DynamicArtifactCollectionLimits {
	const limits = {
		maxFiles: overrides?.maxFiles ?? DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT,
		maxTotalBytes:
			overrides?.maxTotalBytes ?? DEFAULT_DYNAMIC_ARTIFACT_TOTAL_LIMIT_BYTES,
		maxFileBytes:
			overrides?.maxFileBytes ?? DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES,
		maxDepth:
			overrides?.maxDepth ?? DEFAULT_DYNAMIC_ARTIFACT_DIRECTORY_DEPTH_LIMIT,
		maxEntries: overrides?.maxEntries ?? DEFAULT_DYNAMIC_ARTIFACT_ENTRY_LIMIT,
	};
	for (const [label, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${label} must be a positive integer.`);
		}
	}
	return limits;
}

export async function walkDynamicArtifactFiles(
	dir: string,
	limits: DynamicArtifactCollectionLimits,
): Promise<string[]> {
	const files: string[] = [];
	let totalBytes = 0;
	let entriesSeen = 0;

	const walk = async (
		currentDirectory: string,
		depth: number,
	): Promise<void> => {
		if (depth > limits.maxDepth) {
			throw new Error(
				`dynamic_artifact_depth_limit_exceeded:${limits.maxDepth}`,
			);
		}
		const directory = await fs.opendir(currentDirectory);
		for await (const entry of directory) {
			entriesSeen += 1;
			if (entriesSeen > limits.maxEntries) {
				throw new Error(
					`dynamic_artifact_entry_limit_exceeded:${limits.maxEntries}`,
				);
			}
			const fullPath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			const fileStat = await fs.stat(fullPath);
			if (fileStat.size > limits.maxFileBytes) {
				throw new Error(
					`dynamic_artifact_file_limit_exceeded:${fileStat.size}:${limits.maxFileBytes}`,
				);
			}
			totalBytes += fileStat.size;
			if (totalBytes > limits.maxTotalBytes) {
				throw new Error(
					`dynamic_artifact_total_limit_exceeded:${totalBytes}:${limits.maxTotalBytes}`,
				);
			}
			files.push(path.relative(dir, fullPath));
			if (files.length > limits.maxFiles) {
				throw new Error(
					`dynamic_artifact_count_limit_exceeded:${limits.maxFiles}`,
				);
			}
		}
	};

	await walk(dir, 0);
	return files;
}
