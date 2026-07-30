import { describe, expect, it } from "bun:test";
import { extractArtifactsFromText } from "./extract";

describe("extractArtifactsFromText", () => {
	it("keeps supported artifact types unchanged", () => {
		const result = extractArtifactsFromText(
			'before<artifact type="markdown" title="Notes"># Safe</artifact>after',
		);

		expect(result.cleanText).toBe("beforeafter");
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]).toMatchObject({
			type: "markdown",
			title: "Notes",
			content: "# Safe",
			metadata: {},
		});
	});

	it("normalizes removed Mermaid artifacts to inert code", () => {
		const result = extractArtifactsFromText(
			'<artifact type="mermaid">graph TD; A-->B</artifact>',
		);

		expect(result.cleanText).toBe("");
		expect(result.artifacts[0]).toMatchObject({
			type: "code",
			content: "graph TD; A-->B",
			metadata: { legacyArtifactType: "mermaid" },
		});
	});

	it("preserves unsupported artifact content as inert code", () => {
		const result = extractArtifactsFromText(
			'<artifact type="future-widget"><script>alert(1)</script></artifact>',
		);

		expect(result.artifacts[0]).toMatchObject({
			type: "code",
			content: "<script>alert(1)</script>",
			metadata: { legacyArtifactType: "future-widget" },
		});
	});
});
