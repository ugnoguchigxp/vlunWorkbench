import { describe, expect, test } from "vitest";
import {
	buildNucleiSafeCommand,
	buildSchemathesisReadonlyCommand,
	buildTrivyImageCommand,
	buildTrivySbomCommand,
	buildZapBaselineCommand,
} from "./command-contracts";

describe("phase 41 scanner command contracts", () => {
	test("keeps Nuclei in safe loopback mode", () => {
		const args = buildNucleiSafeCommand("http://127.0.0.1:3000", "/out/nuclei.jsonl", "/tools/templates");
		expect(args).toContain("-no-interactsh");
		expect(args).toContain("-disable-update-check");
		expect(args).not.toContain("-headless");
		expect(() => buildNucleiSafeCommand("https://example.com", "out", "templates")).toThrow();
	});

	test("keeps ZAP baseline passive and Schemathesis read-only", () => {
		const zap = buildZapBaselineCommand("http://127.0.0.1:3000", "/out/zap.json");
		expect(zap).toContain("zap-baseline.py");
		expect(zap).not.toContain("zap-full-scan.py");
		const schema = buildSchemathesisReadonlyCommand("/out/openapi.json", "http://127.0.0.1:3000", "/out/api.ndjson");
		expect(schema.filter((arg) => arg === "--include-method")).toHaveLength(3);
		expect(schema).not.toContain("POST");
	});

	test("builds Trivy inventory/image commands without implicit build", () => {
		expect(buildTrivySbomCommand("/out/sbom.json", "/repo")).toEqual(["fs", "--format", "cyclonedx", "--output", "/out/sbom.json", "/repo"]);
		expect(buildTrivyImageCommand({ imageRef: "local/app:latest" }, "/out/image.json")).toContain("local/app:latest");
		expect(() => buildTrivyImageCommand({}, "/out/image.json")).toThrow();
		expect(() => buildTrivyImageCommand({ imageRef: "a", imageTar: "/tmp/a.tar" }, "/out/image.json")).toThrow();
	});
});
