import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type FixtureResponse = {
	status: number;
	body: string;
	headers?: Record<string, string>;
};

const matchers: Record<string, (response: FixtureResponse) => boolean> = {
	"exposed-env-file": (response) =>
		response.status === 200 &&
		/^[A-Z][A-Z0-9_]{1,63}\s*=\s*\S+/m.test(response.body) &&
		/(secret|token|password|api[_-]?key|database_url)/i.test(response.body),
	"exposed-git-config": (response) =>
		response.status === 200 &&
		response.body.toLowerCase().includes("[core]") &&
		response.body.toLowerCase().includes("repositoryformatversion"),
	"exposed-openapi-document": (response) =>
		response.status === 200 &&
		/"(?:openapi|swagger)"/i.test(response.body) &&
		/"paths"/i.test(response.body),
	"exposed-actuator-environment": (response) =>
		response.status === 200 &&
		/"(?:propertySources|activeProfiles)"/i.test(response.body),
	"directory-listing": (response) =>
		response.status === 200 &&
		/<(?:title|h1)>\s*index of\b/i.test(response.body),
	"credentialed-cors-origin-reflection": (response) =>
		response.status >= 200 &&
		response.status < 400 &&
		response.headers?.["access-control-allow-origin"] ===
			"https://attacker.invalid" &&
		response.headers?.["access-control-allow-credentials"] === "true",
	"exposed-backup-archive": (response) =>
		response.status === 200 && response.body.startsWith("PK"),
	"framework-debug-error": (response) =>
		response.status >= 200 &&
		response.status < 500 &&
		/(stack trace|traceback \(most recent call last\)|debug mode|typeerror at|referenceerror at)/i.test(
			response.body,
		),
};

describe("owned Nuclei safe families", () => {
	it("has a vulnerable/fixed pair for every owned safe template", async () => {
		const root = "docker/toolbox/nuclei-safe-templates/http";
		const templateFiles = (await readdir(root))
			.filter((file) => file.endsWith(".yaml"))
			.sort();
		const templateIds = await Promise.all(
			templateFiles.map(async (file) => {
				const content = await readFile(path.join(root, file), "utf8");
				return content.match(/^id:\s*(\S+)/m)?.[1] ?? "";
			}),
		);
		const fixtures = JSON.parse(
			await readFile(
				"tests/security-capability/fixtures/nuclei/safe-family-pairs.json",
				"utf8",
			),
		) as Record<
			string,
			{ vulnerable: FixtureResponse; fixed: FixtureResponse }
		>;

		expect(templateIds).toHaveLength(8);
		expect(Object.keys(fixtures).sort()).toEqual([...templateIds].sort());
		for (const templateId of templateIds) {
			const matcher = matchers[templateId];
			const pair = fixtures[templateId];
			expect(matcher, `${templateId} matcher`).toBeDefined();
			expect(pair, `${templateId} pair`).toBeDefined();
			expect(matcher(pair.vulnerable), `${templateId} vulnerable`).toBe(
				true,
			);
			expect(matcher(pair.fixed), `${templateId} fixed`).toBe(false);
		}
	});
});
