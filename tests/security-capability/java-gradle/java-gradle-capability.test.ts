import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { analyzeProjectCapabilities } from "../../../api/modules/project-capabilities/plugin-detector";
import {
	DEPENDENCY_MANIFEST_SCOPE,
} from "../../../api/modules/scans/profiles";
import { createScopedWorkspace } from "../../../api/modules/scans/target-scope";

const fixtures = path.resolve("tests/security-capability/osv/Gradle");

describe("Java Gradle capability fixture", () => {
	it("distinguishes vulnerable and fixed locked versions", async () => {
		const vulnerable = await fs.readFile(
			path.join(fixtures, "vulnerable/gradle.lockfile"),
			"utf8",
		);
		const fixed = await fs.readFile(
			path.join(fixtures, "fixed/gradle.lockfile"),
			"utf8",
		);
		expect(vulnerable).toContain("2.14.1");
		expect(fixed).toContain("2.25.1");
		expect(fixed).not.toContain("2.14.1");
	});

	it("materializes Gradle locks without executing the build", async () => {
		const workspace = await createScopedWorkspace({
			repoPath: path.join(fixtures, "vulnerable"),
			scope: DEPENDENCY_MANIFEST_SCOPE,
			prefix: path.join(
				process.env.TMPDIR ?? "/tmp",
				"vwb-gradle-capability-",
			),
		});
		try {
			expect(workspace.copiedFiles).toBe(1);
			await fs.access(path.join(workspace.path, "gradle.lockfile"));
		} finally {
			await fs.rm(workspace.path, { recursive: true, force: true });
		}
	});

	it("reports locked dependency coverage when Java source is present", async () => {
		const root = await fs.mkdtemp(
			path.join(process.env.TMPDIR ?? "/tmp", "vwb-gradle-analysis-"),
		);
		try {
			await fs.copyFile(
				path.join(fixtures, "vulnerable/gradle.lockfile"),
				path.join(root, "gradle.lockfile"),
			);
			await fs.writeFile(path.join(root, "Fixture.java"), "class Fixture {}");
			const analysis = await analyzeProjectCapabilities(root);
			expect(
				analysis.capabilityPlan.steps.find(
					(step) => step.stepId === "dependency:dependency.gradle",
				),
			).toMatchObject({
				coverageEffect: "covered",
				reasonCode: null,
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("accepts buildscript locks as resolved dependency evidence", async () => {
		const root = await fs.mkdtemp(
			path.join(process.env.TMPDIR ?? "/tmp", "vwb-gradle-buildscript-"),
		);
		try {
			await fs.writeFile(
				path.join(root, "buildscript-gradle.lockfile"),
				"org.springframework.boot:spring-boot-gradle-plugin:3.4.0=classpath\n",
			);
			await fs.writeFile(path.join(root, "Fixture.java"), "class Fixture {}");

			const analysis = await analyzeProjectCapabilities(root);

			expect(
				analysis.capabilityPlan.steps.find(
					(step) => step.stepId === "dependency:dependency.gradle",
				),
			).toMatchObject({
				coverageEffect: "covered",
				reasonCode: null,
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("labels verification metadata without a lockfile as partial", async () => {
		const root = await fs.mkdtemp(
			path.join(process.env.TMPDIR ?? "/tmp", "vwb-gradle-verification-"),
		);
		try {
			await fs.mkdir(path.join(root, "gradle"), { recursive: true });
			await fs.writeFile(
				path.join(root, "gradle", "verification-metadata.xml"),
				"<verification-metadata />\n",
			);
			await fs.writeFile(path.join(root, "Fixture.java"), "class Fixture {}");

			const analysis = await analyzeProjectCapabilities(root);

			expect(
				analysis.capabilityPlan.steps.find(
					(step) => step.stepId === "dependency:dependency.gradle",
				),
			).toMatchObject({
				coverageEffect: "partial",
				reasonCode: "gradle_verification_metadata_only",
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
