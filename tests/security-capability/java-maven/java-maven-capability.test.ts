import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { analyzeProjectCapabilities } from "../../../api/modules/project-capabilities/plugin-detector";
import { DEPENDENCY_MANIFEST_SCOPE } from "../../../api/modules/scans/profiles";
import { createScopedWorkspace } from "../../../api/modules/scans/target-scope";

describe("Java Maven capability fixture", () => {
	it("detects Maven while preserving direct-only coverage semantics", async () => {
		const fixtureRoot = path.resolve(
			"tests/security-capability/osv/Maven/vulnerable",
		);
		const root = await fs.mkdtemp(
			path.join(process.env.TMPDIR ?? "/tmp", "vwb-maven-analysis-"),
		);
		try {
			await fs.copyFile(
				path.join(fixtureRoot, "pom.xml"),
				path.join(root, "pom.xml"),
			);
			await fs.writeFile(path.join(root, "Fixture.java"), "class Fixture {}");
			const analysis = await analyzeProjectCapabilities(root);
			expect(analysis.capabilityPlan.activePluginIds).toContain("build.maven");
			expect(
				analysis.capabilityPlan.steps.find(
					(step) => step.stepId === "dependency:dependency.maven",
				),
			).toMatchObject({
				coverageEffect: "partial",
				reasonCode: "maven_direct_dependencies_only",
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("materializes pom.xml in the normal dependency workspace", async () => {
		const fixtureRoot = path.resolve(
			"tests/security-capability/osv/Maven/vulnerable",
		);
		const workspace = await createScopedWorkspace({
			repoPath: fixtureRoot,
			scope: DEPENDENCY_MANIFEST_SCOPE,
			prefix: path.join(
				process.env.TMPDIR ?? "/tmp",
				"vwb-maven-capability-",
			),
		});
		try {
			expect(workspace.copiedFiles).toBe(1);
			await fs.access(path.join(workspace.path, "pom.xml"));
		} finally {
			await fs.rm(workspace.path, { recursive: true, force: true });
		}
	});
});
