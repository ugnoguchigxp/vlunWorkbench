import { describe, expect, test } from "bun:test";
import { probeDependency } from "./dependency-registry";

describe("dependency registry", () => {
	test("reports a missing pinned scanner image before execution", async () => {
		const result = await probeDependency({
			id: "scanner.nuclei",
			settings: { VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE: `registry.example/nuclei@sha256:${"a".repeat(64)}` },
			run: async () => ({ exitCode: 1 }),
		});
		expect(result).toEqual({ id: "scanner.nuclei", ready: false, reasonCode: "docker_image_unavailable" });
	});

	test("does not invoke Docker when an image setting is absent", async () => {
		let calls = 0;
		const result = await probeDependency({ id: "scanner.schemathesis", run: async () => { calls += 1; return { exitCode: 0 }; } });
		expect(result.reasonCode).toBe("docker_image_unavailable");
		expect(calls).toBe(0);
	});
});
