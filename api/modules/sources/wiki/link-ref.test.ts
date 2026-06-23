import { describe, expect, it } from "vitest";
import { resolveWikiLinkRef } from "./link-ref";

describe("resolveWikiLinkRef", () => {
	it("resolves wiki slug and links from absolute source uri", () => {
		const result = resolveWikiLinkRef({
			sourceUri: "/tmp/wiki/pages/tech/hono/routing/index.md",
		});
		expect(result).toEqual({
			pagePath: "tech/hono/routing/index.md",
			wikiSlug: "tech/hono/routing",
			wikiApiPath: "/api/sources/pages/tech/hono/routing",
			wikiRawPath: "/api/sources/pages/tech/hono/routing/raw",
		});
	});

	it("supports file-style markdown path and encodes link segments", () => {
		const result = resolveWikiLinkRef({
			sourceUri: "/tmp/wiki/pages/tech/my page.md",
		});
		expect(result).toEqual({
			pagePath: "tech/my page.md",
			wikiSlug: "tech/my page",
			wikiApiPath: "/api/sources/pages/tech/my%20page",
			wikiRawPath: "/api/sources/pages/tech/my%20page/raw",
		});
	});

	it("falls back to metadata relativePath when uri is not a file path", () => {
		const result = resolveWikiLinkRef({
			sourceUri: "wiki://fragment/abc",
			sourceMetadata: {
				relativePath: "pages/tech/rag/chunking.md",
			},
		});
		expect(result).toEqual({
			pagePath: "tech/rag/chunking.md",
			wikiSlug: "tech/rag/chunking",
			wikiApiPath: "/api/sources/pages/tech/rag/chunking",
			wikiRawPath: "/api/sources/pages/tech/rag/chunking/raw",
		});
	});

	it("uses metadata wikiSlug when present", () => {
		const result = resolveWikiLinkRef({
			sourceUri: "wiki://fragment/xyz",
			sourceMetadata: {
				wikiSlug: "tech/platform/design",
			},
		});
		expect(result).toEqual({
			pagePath: "tech/platform/design.md",
			wikiSlug: "tech/platform/design",
			wikiApiPath: "/api/sources/pages/tech/platform/design",
			wikiRawPath: "/api/sources/pages/tech/platform/design/raw",
		});
	});

	it("falls back to sourceCategory + file name when uri has no /pages/ marker", () => {
		const result = resolveWikiLinkRef({
			sourceUri: "wiki://legacy-storage/notes/routing-guide.md",
			sourceCategory: "tech",
		});
		expect(result).toEqual({
			pagePath: "tech/routing-guide.md",
			wikiSlug: "tech/routing-guide",
			wikiApiPath: "/api/sources/pages/tech/routing-guide",
			wikiRawPath: "/api/sources/pages/tech/routing-guide/raw",
		});
	});

	it("returns null for top-level or invalid wiki paths", () => {
		expect(
			resolveWikiLinkRef({
				sourceUri: "/tmp/wiki/pages/index.md",
			}),
		).toBeNull();
		expect(
			resolveWikiLinkRef({
				sourceUri: "/tmp/wiki/pages/tech/../secret.md",
			}),
		).toBeNull();
	});
});
