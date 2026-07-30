import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";

const assignment = /^[A-Z][A-Z0-9_]{1,63}\s*=\s*\S+/m;
const sensitiveName =
	/(secret|token|password|passwd|api[_-]?key|database_url|private[_-]?key)/i;

function matchesOwnedEnvTemplate(response: {
	status: number;
	body: string;
}): boolean {
	return (
		response.status === 200 &&
		response.body.length >= 8 &&
		response.body.length <= 65_536 &&
		assignment.test(response.body) &&
		sensitiveName.test(response.body)
	);
}

describe("owned Nuclei exposed-env matcher", () => {
	it("detects the vulnerable fixture and rejects a generic HTTP 200 page", async () => {
		const vulnerable = JSON.parse(
			await fs.readFile(
				"tests/security-capability/fixtures/nuclei/exposed-env.json",
				"utf8",
			),
		);
		const fixed = JSON.parse(
			await fs.readFile(
				"tests/security-capability/fixtures/nuclei/generic-200.json",
				"utf8",
			),
		);
		expect(matchesOwnedEnvTemplate(vulnerable)).toBe(true);
		expect(matchesOwnedEnvTemplate(fixed)).toBe(false);
		const template = await fs.readFile(
			"docker/toolbox/nuclei-safe-templates/http/exposed-env.yaml",
			"utf8",
		);
		expect(template).toContain("contains_any");
		expect(template).toContain("regex(");
	});
});
