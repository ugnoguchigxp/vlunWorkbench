import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const UNSAFE_MARKERS = [
	"SECRET_FIXTURE_SNIPPET_SHOULD_NOT_LEAK",
	"SECRET_FIXTURE_ARTIFACT_BODY_SHOULD_NOT_LEAK",
	"SECRET_FIXTURE_REVIEW_BODY_SHOULD_NOT_LEAK",
	"SECRET_FIXTURE_TOKEN_SHOULD_NOT_LEAK",
	"SECRET_FIXTURE_SCANNER_STDOUT_SHOULD_NOT_LEAK",
];

describe("Static Intelligence knowledge source fixture script", () => {
	it("runs the CLI-only fixture workflow with JSON stdout", () => {
		const result = runFixture(["--skip-mcp", "true"]);

		expect(result.status).toBe(0);
		expect(result.stdout.trim().startsWith("{")).toBe(true);
		expect(result.stdout.trim().endsWith("}")).toBe(true);
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
			outputs: { mcpSkipped: true },
		});
		expect(payload.outputs.manifestContentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(payload.outputs.guardrailMaterialIds.length).toBeGreaterThan(0);
		expect(
			payload.checks.every((check: { status: string }) => check.status === "passed"),
		).toBe(true);
		for (const marker of UNSAFE_MARKERS) {
			expect(result.stdout).not.toContain(marker);
		}
	});

	it("returns JSON failure with exit code 2 for invalid boolean options", () => {
		const result = runFixture(["--keep-temp", "maybe"]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: false,
			status: "failed",
			version: "v1",
		});
		expect(payload.message).toContain("--keep-temp must be true or false");
	});
});

function runFixture(args: string[]) {
	return spawnSync(
		process.execPath,
		["scripts/static-intelligence-knowledge-source-fixture.ts", ...args],
		{
			cwd: process.cwd(),
			env: { ...process.env },
			encoding: "utf8",
		},
	);
}
