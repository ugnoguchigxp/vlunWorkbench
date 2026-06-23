import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceRepository } from "./source.repository";
import {
	categoryFromPageRelativePath,
	DEFAULT_WIKI_CATEGORY,
} from "./wiki/category";
import { filePathToSlug } from "./wiki/slug";

export type MarkdownImportResult = {
	importedFiles: number;
	skippedFiles: number;
	removedSources: number;
	files: Array<{ path: string; sourceId: string }>;
};

export type MarkdownImportProgressEvent =
	| {
			type: "legacy_index";
			action: "moved_to_category" | "deduplicated" | "moved_to_legacy_backup";
			from: string;
			to?: string;
	  }
	| {
			type: "scan_completed";
			totalFiles: number;
	  }
	| {
			type: "file_started";
			index: number;
			total: number;
			path: string;
			category: string;
	  }
	| {
			type: "file_imported";
			index: number;
			total: number;
			path: string;
			sourceId: string;
	  }
	| {
			type: "file_skipped_empty";
			index: number;
			total: number;
			path: string;
	  }
	| {
			type: "cleanup_started";
			keepUris: number;
	  }
	| {
			type: "cleanup_completed";
			removedSources: number;
	  };

type MarkdownProgressEmitter = (event: MarkdownImportProgressEvent) => void;

function firstMarkdownHeading(body: string): string | null {
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("#")) continue;
		const title = trimmed.replace(/^#+\s*/, "").trim();
		if (title) return title;
	}
	return null;
}

export async function collectMarkdownFiles(
	contentRoot: string,
): Promise<string[]> {
	const pagesRoot = path.resolve(contentRoot, "pages");
	const files: string[] = [];

	const walk = async (dir: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.resolve(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
				files.push(fullPath);
			}
		}
	};

	await walk(pagesRoot);
	return files.sort();
}

async function migrateLegacyTopLevelIndex(
	contentRoot: string,
	onProgress?: MarkdownProgressEmitter,
): Promise<void> {
	const pagesRoot = path.resolve(contentRoot, "pages");
	const legacyPath = path.resolve(pagesRoot, "index.md");
	const targetDir = path.resolve(pagesRoot, DEFAULT_WIKI_CATEGORY);
	const targetPath = path.resolve(targetDir, "index.md");

	try {
		const legacyStat = await stat(legacyPath);
		if (!legacyStat.isFile()) return;
	} catch {
		return;
	}

	await mkdir(targetDir, { recursive: true });

	const moveLegacyToFallback = async (): Promise<void> => {
		for (let i = 0; i < 1000; i += 1) {
			const suffix = i === 0 ? "" : `-${i}`;
			const candidate = path.resolve(targetDir, `index.legacy${suffix}.md`);
			try {
				await stat(candidate);
			} catch {
				await rename(legacyPath, candidate);
				onProgress?.({
					type: "legacy_index",
					action: "moved_to_legacy_backup",
					from: legacyPath,
					to: candidate,
				});
				return;
			}
		}
		throw new Error(
			"Failed to preserve legacy pages/index.md. Too many existing index.legacy*.md files.",
		);
	};
	let targetExists = false;
	try {
		const targetStat = await stat(targetPath);
		if (!targetStat.isFile()) {
			throw new Error("Target pages/tech/index.md exists but is not a file.");
		}
		targetExists = true;
	} catch {
		targetExists = false;
	}

	if (!targetExists) {
		try {
			await rename(legacyPath, targetPath);
			onProgress?.({
				type: "legacy_index",
				action: "moved_to_category",
				from: legacyPath,
				to: targetPath,
			});
			return;
		} catch {
			throw new Error(
				"Failed to migrate legacy pages/index.md. Move it to pages/tech/index.md manually.",
			);
		}
	}

	const [legacyContent, targetContent] = await Promise.all([
		readFile(legacyPath, "utf8"),
		readFile(targetPath, "utf8"),
	]);
	if (legacyContent.trim() === targetContent.trim()) {
		await rm(legacyPath);
		onProgress?.({
			type: "legacy_index",
			action: "deduplicated",
			from: legacyPath,
			to: targetPath,
		});
		return;
	}
	await moveLegacyToFallback();
}

export async function importMarkdownDirectory(params: {
	contentRoot: string;
	sourceRepository: SourceRepository;
	embedFragments?: boolean;
	onProgress?: MarkdownProgressEmitter;
}): Promise<MarkdownImportResult> {
	await migrateLegacyTopLevelIndex(params.contentRoot, params.onProgress);
	const markdownFiles = await collectMarkdownFiles(params.contentRoot);
	const pagesRoot = path.resolve(params.contentRoot, "pages");
	const embedFragments = params.embedFragments ?? true;
	params.onProgress?.({
		type: "scan_completed",
		totalFiles: markdownFiles.length,
	});
	const results: MarkdownImportResult = {
		importedFiles: 0,
		skippedFiles: 0,
		removedSources: 0,
		files: [],
	};

	for (const filePath of markdownFiles) {
		const index = results.importedFiles + results.skippedFiles + 1;
		const relativeFromPages = path.relative(pagesRoot, filePath);
		const category = categoryFromPageRelativePath(relativeFromPages);
		if (!category) {
			throw new Error(
				`Top-level markdown is not allowed under pages/: ${relativeFromPages}`,
			);
		}
		params.onProgress?.({
			type: "file_started",
			index,
			total: markdownFiles.length,
			path: filePath,
			category,
		});
		const content = await readFile(filePath, "utf8");
		if (!content.trim()) {
			results.skippedFiles += 1;
			params.onProgress?.({
				type: "file_skipped_empty",
				index,
				total: markdownFiles.length,
				path: filePath,
			});
			continue;
		}

		const hash = createHash("sha256").update(content).digest("hex");
		const wikiSlug = filePathToSlug(relativeFromPages);
		const title =
			firstMarkdownHeading(content) ?? path.basename(filePath, ".md");
		const sourceId = await params.sourceRepository.upsertSourceDocument({
			sourceKind: "wiki",
			uri: filePath,
			title,
			body: content,
			contentHash: hash,
			category,
			embedFragments,
			metadata: {
				relativePath: path.relative(params.contentRoot, filePath),
				wikiSlug,
				importedAt: new Date().toISOString(),
			},
		});

		results.importedFiles += 1;
		results.files.push({ path: filePath, sourceId });
		params.onProgress?.({
			type: "file_imported",
			index,
			total: markdownFiles.length,
			path: filePath,
			sourceId,
		});
	}

	params.onProgress?.({
		type: "cleanup_started",
		keepUris: results.files.length,
	});
	results.removedSources =
		await params.sourceRepository.deleteStaleSourcesForRoot({
			rootPath: params.contentRoot,
			keepUris: results.files.map((item) => item.path),
		});
	params.onProgress?.({
		type: "cleanup_completed",
		removedSources: results.removedSources,
	});

	return results;
}
