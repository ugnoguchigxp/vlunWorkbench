import fs from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import type { AppEnv } from "../../../app/env";

type WikiBlobSyncDirection = "pull" | "push";

export type WikiBlobSyncResult = {
	enabled: boolean;
	direction: WikiBlobSyncDirection;
	container: string;
	prefix: string;
	downloadedFiles: number;
	uploadedFiles: number;
	deletedFiles: number;
	skippedFiles: number;
};

type WikiBlobSyncerOptions = {
	contentRoot: string;
	connectionString: string;
	containerName: string;
	prefix: string;
	pullIntervalMs: number;
};

const normalizeBlobPrefix = (prefix: string): string =>
	prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");

const toPosixPath = (value: string): string => value.split(path.sep).join("/");

const blobNameForRelativePath = (
	prefix: string,
	relativePath: string,
): string => (prefix ? `${prefix}/${relativePath}` : relativePath);

const contentTypeForPath = (relativePath: string): string | undefined => {
	if (relativePath.toLowerCase().endsWith(".md")) {
		return "text/markdown; charset=utf-8";
	}
	if (relativePath.toLowerCase().endsWith(".json")) {
		return "application/json; charset=utf-8";
	}
	return undefined;
};

const isNotFoundError = (error: unknown): boolean =>
	error instanceof Error &&
	"code" in error &&
	(error.code === "ENOENT" || error.code === "ENOTDIR");

function safeRelativePath(value: string): string | null {
	const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized || normalized.endsWith("/")) return null;
	const segments = normalized.split("/");
	if (
		segments.some((segment) => !segment || segment === "." || segment === "..")
	) {
		return null;
	}
	if (segments[0] === ".git") return null;
	return normalized;
}

function safeAbsolutePath(contentRoot: string, relativePath: string): string {
	const absoluteRoot = path.resolve(contentRoot);
	const absolute = path.resolve(absoluteRoot, relativePath);
	if (
		absolute !== absoluteRoot &&
		!absolute.startsWith(`${absoluteRoot}${path.sep}`)
	) {
		throw new Error(`Invalid wiki blob path: ${relativePath}`);
	}
	return absolute;
}

async function collectLocalFiles(
	contentRoot: string,
	dir = contentRoot,
): Promise<string[]> {
	let entries: Array<import("node:fs").Dirent>;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw error;
	}

	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === ".git") continue;
		const fullPath = path.resolve(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectLocalFiles(contentRoot, fullPath)));
			continue;
		}
		if (!entry.isFile()) continue;
		const relative = toPosixPath(path.relative(contentRoot, fullPath));
		if (safeRelativePath(relative)) {
			files.push(relative);
		}
	}
	return files.sort();
}

async function removeEmptyParents(contentRoot: string, filePath: string) {
	const root = path.resolve(contentRoot);
	let current = path.dirname(filePath);
	while (current !== root && current.startsWith(`${root}${path.sep}`)) {
		try {
			const entries = await fs.readdir(current);
			if (entries.length > 0) return;
			await fs.rmdir(current);
			current = path.dirname(current);
		} catch {
			return;
		}
	}
}

export class WikiBlobSyncer {
	private readonly containerClient: ContainerClient;
	private readonly prefix: string;
	private lastPullAt = 0;
	private pullTask: Promise<WikiBlobSyncResult> | null = null;

	constructor(private readonly options: WikiBlobSyncerOptions) {
		const serviceClient = BlobServiceClient.fromConnectionString(
			options.connectionString,
		);
		this.containerClient = serviceClient.getContainerClient(
			options.containerName,
		);
		this.prefix = normalizeBlobPrefix(options.prefix);
	}

	async pull(options: { force?: boolean } = {}): Promise<WikiBlobSyncResult> {
		const now = Date.now();
		if (
			!options.force &&
			this.lastPullAt > 0 &&
			now - this.lastPullAt < this.options.pullIntervalMs
		) {
			return this.emptyResult("pull");
		}
		if (this.pullTask) return this.pullTask;
		this.pullTask = this.doPull().finally(() => {
			this.pullTask = null;
		});
		return this.pullTask;
	}

	async push(): Promise<WikiBlobSyncResult> {
		await this.containerClient.createIfNotExists();
		await fs.mkdir(this.options.contentRoot, { recursive: true });
		const localFiles = await collectLocalFiles(this.options.contentRoot);
		const localFileSet = new Set(localFiles);
		let uploadedFiles = 0;
		let deletedFiles = 0;

		for (const relativePath of localFiles) {
			const absolutePath = safeAbsolutePath(
				this.options.contentRoot,
				relativePath,
			);
			const blobName = blobNameForRelativePath(this.prefix, relativePath);
			const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
			await blockBlobClient.uploadFile(absolutePath, {
				blobHTTPHeaders: {
					blobContentType: contentTypeForPath(relativePath),
				},
			});
			uploadedFiles += 1;
		}

		for await (const blob of this.containerClient.listBlobsFlat({
			prefix: this.blobListPrefix(),
		})) {
			const relativePath = this.relativePathFromBlobName(blob.name);
			if (!relativePath || localFileSet.has(relativePath)) continue;
			await this.containerClient.deleteBlob(blob.name);
			deletedFiles += 1;
		}

		return {
			...this.emptyResult("push"),
			uploadedFiles,
			deletedFiles,
		};
	}

	private async doPull(): Promise<WikiBlobSyncResult> {
		await this.containerClient.createIfNotExists();
		await fs.mkdir(this.options.contentRoot, { recursive: true });
		const remoteFileSet = new Set<string>();
		let downloadedFiles = 0;
		let skippedFiles = 0;
		let deletedFiles = 0;

		for await (const blob of this.containerClient.listBlobsFlat({
			prefix: this.blobListPrefix(),
		})) {
			const relativePath = this.relativePathFromBlobName(blob.name);
			if (!relativePath) {
				skippedFiles += 1;
				continue;
			}
			remoteFileSet.add(relativePath);
			const absolutePath = safeAbsolutePath(
				this.options.contentRoot,
				relativePath,
			);
			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await this.containerClient
				.getBlobClient(blob.name)
				.downloadToFile(absolutePath);
			downloadedFiles += 1;
		}

		if (remoteFileSet.size > 0) {
			const localFiles = await collectLocalFiles(this.options.contentRoot);
			for (const relativePath of localFiles) {
				if (remoteFileSet.has(relativePath)) continue;
				const absolutePath = safeAbsolutePath(
					this.options.contentRoot,
					relativePath,
				);
				await fs.rm(absolutePath, { force: true });
				await removeEmptyParents(this.options.contentRoot, absolutePath);
				deletedFiles += 1;
			}
		}

		this.lastPullAt = Date.now();
		return {
			...this.emptyResult("pull"),
			downloadedFiles,
			deletedFiles,
			skippedFiles,
		};
	}

	private emptyResult(direction: WikiBlobSyncDirection): WikiBlobSyncResult {
		return {
			enabled: true,
			direction,
			container: this.options.containerName,
			prefix: this.prefix,
			downloadedFiles: 0,
			uploadedFiles: 0,
			deletedFiles: 0,
			skippedFiles: 0,
		};
	}

	private blobListPrefix(): string {
		return this.prefix ? `${this.prefix}/` : "";
	}

	private relativePathFromBlobName(blobName: string): string | null {
		const prefix = this.blobListPrefix();
		const relativeName = prefix ? blobName.slice(prefix.length) : blobName;
		return safeRelativePath(relativeName);
	}
}

export function createWikiBlobSyncer(env: AppEnv): WikiBlobSyncer | null {
	if (env.wikiStorageBackend !== "azure-blob") return null;
	if (!env.azureStorageConnectionString) {
		throw new Error(
			"WIKI_STORAGE_BACKEND=azure-blob requires AZURE_STORAGE_CONNECTION_STRING.",
		);
	}
	return new WikiBlobSyncer({
		contentRoot: env.contentRoot,
		connectionString: env.azureStorageConnectionString,
		containerName: env.wikiBlobContainer,
		prefix: env.wikiBlobPrefix,
		pullIntervalMs: env.wikiBlobPullIntervalMs,
	});
}
