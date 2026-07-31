import { describe, expect, it } from "bun:test";
import { parsePythonRequirements } from "../../../api/plugins/builtin/python/requirements";

describe("Python dependency capability", () => {
	it("materializes only exact pinned requirements as verified OSV inputs", () => {
		const entries = parsePythonRequirements([
			"requests==2.19.0",
			"wildcard==1.2.*",
			"arbitrary===1.0",
			"fastapi>=0.100",
			"-r requirements/dev.txt",
			"package @ https://example.invalid/package.whl",
			'uvicorn==0.35.0 ; python_version >= "3.11"',
		].join("\n"));
		expect(entries.filter((entry) => entry.status === "pinned")).toEqual([
			expect.objectContaining({ name: "requests", version: "2.19.0" }),
		]);
		expect(entries.map((entry) => entry.limitationCode)).toEqual(
			expect.arrayContaining([
				"python_requirement_version_not_concrete",
				"python_requirement_not_exactly_pinned",
				"python_requirement_include_unsupported",
				"python_requirement_url_or_path_unsupported",
				"python_requirement_environment_marker_unsupported",
			]),
		);
	});
});
