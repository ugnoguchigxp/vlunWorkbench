import { describe, expect, it } from "vitest";
import { sanitizeMarkdownBody } from "./sanitize";

describe("sanitizeMarkdownBody", () => {
	it("removes SVG animation and its URI list", () => {
		const input = `<svg><a><animate attributeName="href" values="#safe;javascript:alert(1)" dur=".01s" fill="freeze"></animate><text>Open</text></a></svg>`;

		const output = sanitizeMarkdownBody(input);

		expect(output).not.toContain("<svg");
		expect(output).not.toContain("<animate");
		expect(output).not.toContain("javascript:");
		expect(output).toContain("Open");
	});
});
