import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateConfiguredHashFlow } from "./java-configured-hash-evaluator";

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("configured Java hash evaluator", () => {
	test("joins a digest callsite to bounded Java properties resources", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "java-hash-config-"));
		roots.push(root);
		const resources = path.join(root, "src/main/resources");
		await mkdir(resources, { recursive: true });
		await writeFile(
			path.join(resources, "benchmark.properties"),
			"hashAlg1=MD5\nhashAlg2=SHA-256\n",
		);
		expect(
			await evaluateConfiguredHashFlow({
				methodSource: configuredMethod("hashAlg1", "SHA512"),
				projectRoot: root,
			}),
		).toBe("weak");
		expect(
			await evaluateConfiguredHashFlow({
				methodSource: configuredMethod("hashAlg2", "SHA512"),
				projectRoot: root,
			}),
		).toBe("strong");
		expect(
			await evaluateConfiguredHashFlow({
				methodSource: configuredMethod("missing", "SHA-512"),
				projectRoot: root,
			}),
		).toBe("strong");
	});

	test("fails closed on unresolved and conflicting resource values", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "java-hash-conflict-"));
		roots.push(root);
		expect(
			await evaluateConfiguredHashFlow({
				methodSource: configuredMethod("hashAlg1", "SHA512"),
				projectRoot: root,
			}),
		).toBe("unresolved");
		for (const [moduleName, value] of [
			["first", "MD5"],
			["second", "SHA-256"],
		] as const) {
			const resources = path.join(moduleName, "src/main/resources");
			await mkdir(path.join(root, resources), { recursive: true });
			await writeFile(
				path.join(root, resources, "benchmark.properties"),
				`hashAlg1=${value}\n`,
			);
		}
		expect(
			await evaluateConfiguredHashFlow({
				methodSource: configuredMethod("hashAlg1", "SHA512"),
				projectRoot: root,
			}),
		).toBe("ambiguous");
	});

	test("does not classify an unrelated dynamic digest call", async () => {
		expect(
			await evaluateConfiguredHashFlow({
				methodSource:
					'String algorithm = request.getParameter("algorithm"); MessageDigest.getInstance(algorithm);',
			}),
		).toBeNull();
	});
});

function configuredMethod(key: string, fallback: string): string {
	return `
		java.util.Properties benchmarkprops = new java.util.Properties();
		benchmarkprops.load(this.getClass().getClassLoader().getResourceAsStream("benchmark.properties"));
		String algorithm = benchmarkprops.getProperty("${key}", "${fallback}");
		java.security.MessageDigest.getInstance(algorithm);
	`;
}
