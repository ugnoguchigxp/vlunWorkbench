import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

export type SourceKind = "wiki";

export type UpsertSourceParams = {
	sourceKind: SourceKind;
	category: string;
	uri: string;
	title?: string;
	body: string;
	contentHash?: string;
	embedFragments?: boolean;
	metadata?: Record<string, unknown>;
};

export type SourceSearchResult = {
	id: string;
	sourceId: string;
	sourceUri: string;
	sourceTitle: string | null;
	sourceCategory: string;
	sourceMetadata: unknown;
	locator: string;
	heading: string | null;
	content: string;
	score: number;
};

export type PendingSourceFragmentEmbedding = {
	id: string;
	sourceId: string;
	sourceUri: string;
	sourceCategory: string;
	sourceMetadata: unknown;
	locator: string;
	content: string;
	createdAt: Date;
};

export function defaultSourceHash(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

export function finiteOrZero(value: unknown): number {
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
}

export function embeddingToBlob(embedding: number[]): Buffer {
	return Buffer.from(new Float32Array(embedding).buffer);
}

export function lowerLike(
	column: SQL | SQL.Aliased | unknown,
	pattern: string,
) {
	return sql<boolean>`lower(coalesce(${column}, '')) like lower(${pattern})`;
}

const SEARCH_STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"for",
	"in",
	"is",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
	"この",
	"その",
	"あの",
	"これ",
	"それ",
	"について",
	"とは",
	"では",
	"です",
	"ます",
	"する",
	"した",
	"して",
	"ください",
	"教えて",
]);

export function normalizeSearchTerms(query: string): string[] {
	const normalized = query.normalize("NFKC").toLowerCase();
	const tokens =
		normalized.match(
			/(?:--?)?[a-z0-9][a-z0-9._:/@+-]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/giu,
		) ?? [];
	const result: string[] = [];
	for (const token of tokens) {
		const value = token.trim();
		if (!value || SEARCH_STOP_WORDS.has(value)) continue;
		if (value.length < 2 && !value.startsWith("-")) continue;
		if (!result.includes(value)) result.push(value);
	}
	return result.slice(0, 12);
}

export function minimumSearchTermMatches(termCount: number): number {
	if (termCount >= 3) return 2;
	return termCount > 0 ? 1 : 0;
}

export function sumSql(parts: SQL<number>[]): SQL<number> {
	return parts.reduce(
		(acc, part) => sql<number>`(${acc} + ${part})`,
		sql<number>`0`,
	);
}

export function chunkSourceDocument(params: {
	title?: string | null;
	body: string;
	maxChars?: number;
}): Array<{ locator: string; heading: string | null; content: string }> {
	const maxChars = params.maxChars ?? 2500;
	const lines = params.body.split("\n");
	const chunks: Array<{
		locator: string;
		heading: string | null;
		content: string;
	}> = [];
	let heading = params.title ?? null;
	let buffer: string[] = [];
	let index = 1;

	const flush = () => {
		const content = buffer.join("\n").trim();
		if (!content) return;
		chunks.push({
			locator: `chunk:${String(index).padStart(4, "0")}`,
			heading,
			content,
		});
		index += 1;
		buffer = [];
	};

	for (const line of lines) {
		const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
		if (headingMatch && buffer.join("\n").trim().length > 0) {
			flush();
			heading = headingMatch[2]?.trim() || heading;
		}
		buffer.push(line);
		if (buffer.join("\n").length >= maxChars) flush();
	}
	flush();

	if (chunks.length === 0) {
		const content = params.body.trim();
		return content
			? [{ locator: "full", heading: params.title ?? null, content }]
			: [];
	}
	return chunks;
}
