import { describe, expect, it } from "vitest";
import { mavenResolutionConfigSchema } from "./maven-resolution.schema";

describe("mavenResolutionConfigSchema", () => {
	it("rejects absolute, traversal, and platform-ambiguous repository paths", () => {
		for (const rootPom of ["/tmp/pom.xml", "../pom.xml", "module\\pom.xml"]) {
			expect(
				mavenResolutionConfigSchema.safeParse({ schemaVersion: 1, rootPom }),
			).toMatchObject({ success: false });
		}
	});

	it("rejects control characters in repository paths and model values", () => {
		expect(
			mavenResolutionConfigSchema.safeParse({
				schemaVersion: 1,
				rootPom: "pom.xml\n-Dexec.mainClass=Bad",
			}),
		).toMatchObject({ success: false });
		expect(
			mavenResolutionConfigSchema.safeParse({
				schemaVersion: 1,
				modelEnvironment: { VERSION: "1\n-DskipTests=false" },
			}),
		).toMatchObject({ success: false });
	});

	it("rejects secret-like model environment names", () => {
		for (const name of [
			"TOKEN",
			"AUTHORIZATION",
			"CLIENT_SECRET",
			"DB_PASSWORD",
			"AWS_CREDENTIALS",
		]) {
			expect(
				mavenResolutionConfigSchema.safeParse({
					schemaVersion: 1,
					modelEnvironment: { [name]: "value" },
				}),
			).toMatchObject({ success: false });
		}
	});

	it("accepts non-secret model properties used during POM interpolation", () => {
		expect(
			mavenResolutionConfigSchema.parse({
				schemaVersion: 1,
				modelEnvironment: { VERSION: "1.0.0-SNAPSHOT" },
			}),
		).toMatchObject({
			modelEnvironment: { VERSION: "1.0.0-SNAPSHOT" },
		});
	});

	it("rejects duplicate local artifact coordinates", () => {
		const artifact = {
			groupId: "example",
			artifactId: "local",
			version: "1",
			path: "lib/local.jar",
			sha256: `sha256:${"a".repeat(64)}`,
		};
		expect(
			mavenResolutionConfigSchema.safeParse({
				schemaVersion: 1,
				localArtifacts: [artifact, { ...artifact, path: "lib/other.jar" }],
			}),
		).toMatchObject({ success: false });
	});
});
