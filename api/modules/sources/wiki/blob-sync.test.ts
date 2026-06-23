import { describe, expect, it } from "vitest";
import { readAppEnv } from "../../../app/env";
import { createWikiBlobSyncer } from "./blob-sync";

describe("createWikiBlobSyncer", () => {
	it("is disabled for local wiki storage", () => {
		const env = readAppEnv({ WIKI_STORAGE_BACKEND: "local" });
		expect(createWikiBlobSyncer(env)).toBeNull();
	});

	it("requires an Azure Storage connection string when Blob storage is enabled", () => {
		const env = readAppEnv({ WIKI_STORAGE_BACKEND: "azure-blob" });
		expect(() => createWikiBlobSyncer(env)).toThrow(
			"WIKI_STORAGE_BACKEND=azure-blob requires AZURE_STORAGE_CONNECTION_STRING.",
		);
	});
});
