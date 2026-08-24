import { afterEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	loadMavenResolutionConfig,
	MavenResolutionConfigError,
} from "./maven-resolution-config";

const temporaryPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryPaths.splice(0).map((entry) =>
			fs.rm(entry, { recursive: true, force: true }),
		),
	);
});

async function repository() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "maven-config-test-"));
	temporaryPaths.push(root);
	await fs.writeFile(
		path.join(root, "pom.xml"),
		"<project><modules><module>module-a</module></modules></project>",
	);
	await fs.mkdir(path.join(root, "module-a"));
	await fs.writeFile(
		path.join(root, "module-a", "pom.xml"),
		"<project></project>",
	);
	return root;
}

describe("loadMavenResolutionConfig", () => {
	it("does not read Maven resolver configuration from the scan target", async () => {
		const root = await repository();
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "maven-resolution.v1.json"),
			JSON.stringify({
				schemaVersion: 1,
				modelEnvironment: { VERSION: "target-owned-value" },
			}),
		);

		await expect(loadMavenResolutionConfig(root)).resolves.toMatchObject({
			config: { modelEnvironment: {}, localArtifacts: [] },
		});
	});

	it("loads the validated repository config and hash-pinned local artifacts", async () => {
		const root = await repository();
		const jar = Buffer.from("local artifact");
		await fs.writeFile(path.join(root, "local.jar"), jar);
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		const config = {
			schemaVersion: 1 as const,
			modelEnvironment: { VERSION: "1.0.0-SNAPSHOT" },
			localArtifacts: [
				{
					groupId: "example",
					artifactId: "local",
					version: "1",
					path: "local.jar",
					sha256: sha256(jar),
				},
			],
		};
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "maven-resolution.v1.json"),
			JSON.stringify(config),
		);

		const loaded = await loadMavenResolutionConfig(root, config);
		expect(loaded.inspectedPomPaths).toHaveLength(2);
		expect(loaded.config.modelEnvironment).toEqual({
			VERSION: "1.0.0-SNAPSHOT",
		});
		expect(loaded.localArtifacts).toHaveLength(1);
		expect(loaded.localArtifacts[0]?.actualSha256).toBe(sha256(jar));
	});

	it("rejects a local artifact hash mismatch", async () => {
		const root = await repository();
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		const config = {
			schemaVersion: 1 as const,
			localArtifacts: [
				{
					groupId: "example", artifactId: "escaped", version: "1",
					path: "escaped.jar", sha256: `sha256:${"0".repeat(64)}`,
				},
			],
		};
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "maven-resolution.v1.json"),
			JSON.stringify(config),
		);

		await fs.writeFile(path.join(root, "escaped.jar"), "not the pinned bytes");
		await expect(loadMavenResolutionConfig(root, config)).rejects.toMatchObject({
			code: "maven_local_artifact_hash_mismatch",
		});
	});

	it("rejects a local artifact symlink that escapes the repository", async () => {
		const root = await repository();
		const outside = await fs.mkdtemp(
			path.join(os.tmpdir(), "maven-config-outside-"),
		);
		temporaryPaths.push(outside);
		const bytes = Buffer.from("outside artifact");
		const outsideJar = path.join(outside, "outside.jar");
		await fs.writeFile(outsideJar, bytes);
		await fs.symlink(outsideJar, path.join(root, "escaped.jar"));
		await fs.mkdir(path.join(root, ".vuln-workbench"));
		const config = {
			schemaVersion: 1 as const,
			localArtifacts: [{
				groupId: "example", artifactId: "escaped", version: "1",
				path: "escaped.jar", sha256: sha256(bytes),
			}],
		};
		await fs.writeFile(
			path.join(root, ".vuln-workbench", "maven-resolution.v1.json"),
			JSON.stringify(config),
		);

		await expect(loadMavenResolutionConfig(root, config)).rejects.toMatchObject({
			code: "maven_local_artifact_invalid",
		});
	});

	it("rejects unsupported Maven build extensions", async () => {
		const root = await repository();
		await fs.writeFile(
			path.join(root, "pom.xml"),
			"<project><build><extensions><extension/></extensions></build></project>",
		);
		await expect(loadMavenResolutionConfig(root)).rejects.toBeInstanceOf(
			MavenResolutionConfigError,
		);
		await expect(loadMavenResolutionConfig(root)).rejects.toMatchObject({
			code: "maven_project_extensions_unsupported",
		});
	});

	it("rejects project JVM configuration before Maven is started", async () => {
		const root = await repository();
		await fs.mkdir(path.join(root, ".mvn"));
		await fs.writeFile(path.join(root, ".mvn", "jvm.config"), "-javaagent:x");
		await expect(loadMavenResolutionConfig(root)).rejects.toMatchObject({
			code: "maven_project_extensions_unsupported",
		});
	});

	it("does not execute or interpret a project Maven wrapper", async () => {
		const root = await repository();
		await fs.writeFile(path.join(root, "mvnw"), "#!/bin/sh\nexit 1\n");
		await fs.mkdir(path.join(root, ".mvn", "wrapper"), { recursive: true });
		await fs.writeFile(
			path.join(root, ".mvn", "wrapper", "maven-wrapper.properties"),
			"distributionUrl=https://untrusted.invalid/maven.zip\n",
		);
		await expect(loadMavenResolutionConfig(root)).resolves.toMatchObject({
			config: { rootPom: "pom.xml" },
		});
	});

	it("rejects project overrides of the resolver's CycloneDX plugin", async () => {
		const root = await repository();
		await fs.writeFile(
			path.join(root, "pom.xml"),
			"<project><build><plugins><plugin><groupId>org.cyclonedx</groupId><artifactId>cyclonedx-maven-plugin</artifactId><dependencies><dependency><groupId>untrusted</groupId><artifactId>code</artifactId><version>1</version></dependency></dependencies></plugin></plugins></build></project>",
		);
		await expect(loadMavenResolutionConfig(root)).rejects.toMatchObject({
			code: "maven_cyclonedx_plugin_override_unsupported",
		});
	});

	it("rejects property-based plugin coordinates that could override CycloneDX", async () => {
		const repositoryPath = await repository();
		await fs.writeFile(
			path.join(repositoryPath, "pom.xml"),
			`<project><modelVersion>4.0.0</modelVersion><properties><resolver.group>org.cyclonedx</resolver.group></properties><build><plugins><plugin><groupId>\${resolver.group}</groupId><artifactId>cyclonedx-maven-plugin</artifactId></plugin></plugins></build></project>`,
		);

		await expect(loadMavenResolutionConfig(repositoryPath)).rejects.toThrow(
			"maven_cyclonedx_plugin_override_unsupported",
		);
	});

	it("rejects property-based module paths instead of leaving POMs unaudited", async () => {
		const root = await repository();
		await fs.writeFile(
			path.join(root, "pom.xml"),
			"<project><modules><module>${module.name}</module></modules></project>",
		);
		await expect(loadMavenResolutionConfig(root)).rejects.toMatchObject({
			code: "maven_dynamic_module_path_unsupported",
		});
	});

	it("rejects XML constructs that cannot be safely audited", async () => {
		const root = await repository();
		await fs.writeFile(
			path.join(root, "pom.xml"),
			"<!DOCTYPE project [<!ENTITY module 'module-a'>]><project><modules><module>&module;</module></modules></project>",
		);
		await expect(loadMavenResolutionConfig(root)).rejects.toMatchObject({
			code: "maven_pom_construct_unsupported",
		});
	});

	it("changes the bound source digest when a child POM changes", async () => {
		const root = await repository();
		const before = await loadMavenResolutionConfig(root);
		await fs.writeFile(
			path.join(root, "module-a", "pom.xml"),
			"<project><version>2</version></project>",
		);
		const after = await loadMavenResolutionConfig(root);
		expect(after.configDigest).toBe(before.configDigest);
		expect(after.sourceDigest).not.toBe(before.sourceDigest);
	});

	it("includes repository-local parent POMs outside the module list", async () => {
		const root = await repository();
		await fs.mkdir(path.join(root, "parents"));
		await fs.writeFile(path.join(root, "parents", "pom.xml"), "<project />");
		await fs.writeFile(
			path.join(root, "module-a", "pom.xml"),
			"<project><parent><groupId>example</groupId><artifactId>parent</artifactId><version>1</version><relativePath>../parents/pom.xml</relativePath></parent></project>",
		);
		const loaded = await loadMavenResolutionConfig(root);
		expect(loaded.inspectedPomPaths).toHaveLength(3);
		expect(loaded.inspectedPomPaths).toContain(
			await fs.realpath(path.join(root, "parents", "pom.xml")),
		);
	});
});

function sha256(value: crypto.BinaryLike): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
