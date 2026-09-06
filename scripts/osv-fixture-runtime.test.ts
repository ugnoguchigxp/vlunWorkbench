import { describe, expect, test } from "bun:test";
import { buildOsvFixtureCommand } from "./osv-fixture-runtime";

const input = { fixturePath: "/workspace/fixture", databaseRoot: "/workspace/db", outputPath: "/workspace/out/result.json", image: `example/toolbox@sha256:${"a".repeat(64)}` };

describe("isolated OSV fixture invocation", () => {
	test("disables container networking and mounts pinned data read-only", () => {
		const command = buildOsvFixtureCommand(input);
		expect(command.slice(0, 6)).toEqual(["docker", "run", "--rm", "--network", "none", "--cap-drop"]);
		expect(command).toContain("type=bind,src=/workspace/db,dst=/database,readonly");
		expect(command).toContain("--offline");
		expect(command).toContain("--no-resolve");
	});
	test("rejects tags and mount option injection", () => {
		expect(() => buildOsvFixtureCommand({ ...input, image: "example/toolbox:latest" })).toThrow("digest_pinned");
		expect(() => buildOsvFixtureCommand({ ...input, fixturePath: "/fixture,readonly=false" })).toThrow("mount_path_invalid");
	});
});
