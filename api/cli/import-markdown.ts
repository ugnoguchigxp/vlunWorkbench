import { mkdir } from "node:fs/promises";
import path from "node:path";
import { connectDb, createDbConnection } from "../db";
import { importMarkdownDirectory } from "../modules/sources/markdown-importer.service";
import { SourceRepository } from "../modules/sources/source.repository";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import type { EmbeddingProvider } from "../providers/types";
import { readAppEnv } from "../app/env";

class UnconfiguredEmbeddingProvider implements EmbeddingProvider {
	constructor(private readonly reason: string) {}

	async createEmbedding(): Promise<never> {
		throw new Error(this.reason);
	}
}

async function main() {
	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	try {
		await connectDb(dbConnection.sqlite);
		await mkdir(path.resolve(env.contentRoot, "pages"), { recursive: true });

		let embeddingProvider: EmbeddingProvider;
		try {
			embeddingProvider = createAzureOpenAiProviderFromAppEnv(env);
		} catch (error) {
			embeddingProvider = new UnconfiguredEmbeddingProvider(
				error instanceof Error
					? error.message
					: "Azure OpenAI embedding configuration is missing.",
			);
		}

		const sourceRepository = new SourceRepository(
			dbConnection.db,
			embeddingProvider,
		);
		const result = await importMarkdownDirectory({
			contentRoot: env.contentRoot,
			sourceRepository,
		});

		console.log(
			JSON.stringify(
				{
					ok: true,
					contentRoot: env.contentRoot,
					...result,
				},
				null,
				2,
			),
		);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
