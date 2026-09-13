import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { normalizeSearchTerms, SourceRepository } from "./source.repository";
import {
	chunkSourceDocument,
	finiteOrZero,
	minimumSearchTermMatches,
} from "./source-repository-support";

function migrate(connection: DbConnection): void {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		connection.sqlite.exec(
			readFileSync(path.join(migrationsDir, filename), "utf8"),
		);
	}
}

const embedding = (seed: number): number[] =>
	Array.from({ length: 1536 }, (_, index) => (index === seed % 1536 ? 1 : 0));

describe("normalizeSearchTerms", () => {
	it("keeps code-like tokens and removes filler words", () => {
		expect(
			normalizeSearchTerms(
				"Biome の package.json scripts について --write と tsc --noEmit",
			),
		).toEqual([
			"biome",
			"package.json",
			"scripts",
			"--write",
			"tsc",
			"--noemit",
		]);
	});

	it("splits mixed Japanese and latin text without spaces", () => {
		expect(normalizeSearchTerms("Biomeのpackage.json設定方法")).toEqual([
			"biome",
			"package.json",
			"設定方法",
		]);
	});

	it("deduplicates terms and caps the number of terms", () => {
		expect(
			normalizeSearchTerms(
				"one two three four five six seven eight nine ten eleven twelve thirteen one",
			),
		).toEqual([
			"one",
			"two",
			"three",
			"four",
			"five",
			"six",
			"seven",
			"eight",
			"nine",
			"ten",
			"eleven",
			"twelve",
		]);
	});
});

describe("source repository helpers", () => {
	it("chunks documents on headings and max length", () => {
		expect(chunkSourceDocument({ body: "   " })).toEqual([]);
		expect(chunkSourceDocument({ title: "Home", body: "hello" })).toEqual([
			{ locator: "chunk:0001", heading: "Home", content: "hello" },
		]);
		const chunked = chunkSourceDocument({
			title: "Doc",
			body: "# First\nalpha\n# Second\nbeta",
		});
		expect(chunked.map((chunk) => chunk.heading)).toEqual(["Doc", "Second"]);
		expect(minimumSearchTermMatches(0)).toBe(0);
		expect(minimumSearchTermMatches(1)).toBe(1);
		expect(minimumSearchTermMatches(3)).toBe(2);
		expect(finiteOrZero("not-a-number")).toBe(0);
		expect(finiteOrZero(4)).toBe(4);
	});
});

describe("SourceRepository", () => {
	let connection: DbConnection;
	let repository: SourceRepository;
	const createdEmbeddings: string[] = [];

	beforeEach(() => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		createdEmbeddings.length = 0;
		repository = new SourceRepository(connection.db, {
			createEmbedding: async (input) => {
				createdEmbeddings.push(input);
				return embedding(createdEmbeddings.length);
			},
		});
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("upserts, searches, and deletes wiki documents", async () => {
		const uri = "/tmp/wiki/pages/tech/auth.md";
		const id = await repository.upsertSourceDocument({
			sourceKind: "wiki",
			category: "tech",
			uri,
			title: "Auth",
			body: "# Auth\nBearer tokens live here.\n",
			metadata: { tags: ["auth"] },
		});
		const same = await repository.upsertSourceDocument({
			sourceKind: "wiki",
			category: "tech",
			uri,
			title: "Auth renamed",
			body: "# Auth\nBearer tokens live here.\n",
			metadata: { tags: ["auth"] },
		});
		expect(same).toBe(id);
		expect(await repository.getSourceByUri(uri)).toMatchObject({
			title: "Auth renamed",
			category: "tech",
		});
		expect(await repository.getSourceById(id)).toMatchObject({ uri });
		expect(await repository.listCategories()).toEqual(["tech"]);
		expect(await repository.listCategories([])).toEqual(["tech"]);

		const updated = await repository.upsertSourceDocument({
			sourceKind: "wiki",
			category: "ops",
			uri,
			title: "Auth",
			body: "# Sessions\nRotate cookies and sessions.\n",
			embedFragments: false,
		});
		expect(updated).toBe(id);
		expect(await repository.countPendingSourceFragmentEmbeddings()).toBeGreaterThan(
			0,
		);
		const pending = await repository.listPendingSourceFragmentEmbeddings({
			limit: 10,
		});
		expect(pending[0]?.sourceUri).toBe(uri);
		const later = await repository.listPendingSourceFragmentEmbeddings({
			limit: 10,
			after: { createdAt: pending[0]!.createdAt, id: pending[0]!.id },
		});
		expect(later.every((row) => row.id !== pending[0]?.id)).toBe(true);

		await repository.updateSourceFragmentEmbedding(
			pending[0]!.id,
			embedding(9),
		);
		expect(
			await repository.getFragmentById(pending[0]!.id),
		).toMatchObject({ id: pending[0]!.id });
		expect(await repository.searchSourceContent("", 5)).toEqual([]);
		expect(
			await repository.searchSourceContent("sessions", 5, ["wiki"], ["ops"]),
		).not.toEqual([]);
		try {
			expect(
				await repository.vectorSearchSourceContent(embedding(9), 5, ["wiki"], [
					"ops",
				]),
			).not.toEqual([]);
		} catch (error) {
			expect(String(error)).toMatch(/vec_|no such function/i);
		}

		const otherUri = "/tmp/wiki/pages/tech/stale.md";
		await repository.upsertSourceDocument({
			sourceKind: "wiki",
			category: "tech",
			uri: otherUri,
			title: "Stale",
			body: "obsolete",
			embedFragments: false,
		});
		expect(
			await repository.deleteStaleSourcesForRoot({
				rootPath: "/tmp/wiki",
				keepUris: [uri],
			}),
		).toBe(1);
		await repository.deleteSourceByUri(uri);
		expect(await repository.getSourceByUri(uri)).toBeNull();
		expect(await repository.getSourceById(id)).toBeNull();
		expect(await repository.getFragmentById(pending[0]!.id)).toBeNull();
	});

	it("skips embeddings when the provider fails and rejects malformed vectors", async () => {
		const failing = new SourceRepository(connection.db, {
			createEmbedding: async () => {
				throw new Error("offline");
			},
		});
		await failing.upsertSourceDocument({
			sourceKind: "wiki",
			category: "tech",
			uri: "/tmp/wiki/pages/tech/offline.md",
			title: "Offline",
			body: "body",
		});
		expect(await failing.countPendingSourceFragmentEmbeddings(["wiki"])).toBe(1);
		await expect(failing.createEmbeddingForContent("x")).rejects.toThrow(
			"offline",
		);
		await expect(
			repository.createEmbeddingForContent("ok"),
		).resolves.toHaveLength(1536);
		await expect(
			repository.updateSourceFragmentEmbedding("missing", [1, 2, 3]),
		).rejects.toThrow("Embedding dimension mismatch");
		await expect(
			repository.updateSourceFragmentEmbedding(
				"missing",
				Array.from({ length: 1536 }, () => Number.NaN),
			),
		).rejects.toThrow("Invalid embedding values.");
		await repository.upsertSourceDocument({
			sourceKind: "wiki",
			category: "tech",
			uri: "/tmp/wiki/pages/tech/empty.md",
			title: "Empty",
			body: "   ",
			embedFragments: false,
		});
	});
});
