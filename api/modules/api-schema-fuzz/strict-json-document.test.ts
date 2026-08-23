import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_STRICT_JSON_BYTES, parseStrictJsonDocument, readStrictJsonDocument } from "./strict-json-document";

let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; });

describe("strict JSON document", () => {
	it("parses JSON while rejecting duplicate, prototype, surrogate, and trailing input", () => {
		expect(parseStrictJsonDocument('{"a":1,"nested":[true,null]}')).toEqual({ a: 1, nested: [true, null] });
		for (const source of ['{"a":1,"a":2}', '{"__proto__":{}}', '"\\ud800"', '{} trailing'])
			expect(() => parseStrictJsonDocument(source)).toThrow(/strict_json_/);
	});

	it("accepts only bounded regular files inside the immutable snapshot", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "strict-json-"));
		const documentPath = path.join(root, "openapi.json");
		await fs.writeFile(documentPath, "{}");
		await expect(readStrictJsonDocument(documentPath, root)).resolves.toEqual({});
		const linkPath = path.join(root, "link.json");
		await fs.symlink(documentPath, linkPath);
		await expect(readStrictJsonDocument(linkPath, root)).rejects.toThrow("strict_json_regular_file_required");
		expect(() => parseStrictJsonDocument(new Uint8Array(MAX_STRICT_JSON_BYTES + 1))).toThrow("strict_json_size_exceeded");
	});
});
