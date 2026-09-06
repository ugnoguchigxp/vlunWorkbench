import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filterOwnedJavaTaintResults } from "./java-taint-precision-filter";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
const factory = `package example;
import java.io.InputStream; import java.util.Properties; import java.lang.reflect.Constructor;
class StrategyFactory {
 public static Transformer create() {
  Properties config=new Properties();
  try (InputStream stream=StrategyFactory.class.getClassLoader().getResourceAsStream("strategy.properties")) {
   if(stream==null)return new Fallback();
   config.load(stream);
   String className="example."+config.getProperty("implementation");
   Class selected=Class.forName(className);
   Constructor factoryConstructor=selected.getConstructor();
   Object instance=factoryConstructor.newInstance();
   return (Transformer)instance;
  } catch(Exception error) {return new Fallback();}
 }
}`;
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "java-project-proof-"));
	roots.push(root);
	const sources = path.join(root, "src/main/java/example");
	await mkdir(sources, { recursive: true });
	const resources = path.join(root, "src/main/resources");
	await mkdir(resources, { recursive: true });
	await writeFile(path.join(sources, "StrategyFactory.java"), factory);
	await writeFile(
		path.join(sources, "Chosen.java"),
		"package example; class Chosen { public String transform(String input) { return new StringBuilder(input).toString(); } }",
	);
	await writeFile(
		path.join(sources, "Fallback.java"),
		"package example; class Fallback { public String transform(String input) { return input; } }",
	);
	await writeFile(
		path.join(resources, "strategy.properties"),
		"implementation=Chosen\n",
	);
	return { root, sources, resources };
}
async function scan(root: string, argument = '"literal"') {
	const source = `class Example { void run(String param) {example.Transformer transformer=example.StrategyFactory.create();String value=transformer.transform(${argument});statement.execute(value);} }`;
	const target = "statement.execute(value)",
		offset = source.indexOf(target);
	const result = await filterOwnedJavaTaintResults(
		{
			results: [
				{
					check_id: "vuln-workbench.java.sql-injection",
					path: "Example.java",
					start: { line: 1, col: offset + 1 },
					end: { line: 1, col: offset + target.length + 1 },
				},
			],
		},
		{ readSource: async () => source, projectRoot: root },
	);
	return {
		...result,
		kept: (result.output as { results: unknown[] }).results.length,
	};
}
describe("source-backed Java project summaries", () => {
	test("checks both the configured implementation and the fallback", async () => {
		const { root } = await fixture();
		expect((await scan(root)).kept).toBe(0);
		expect((await scan(root, "param")).kept).toBe(1);
	});
	test("never assumes an implementation is pure because the argument is constant", async () => {
		const { root, sources } = await fixture();
		await writeFile(
			path.join(sources, "Chosen.java"),
			'package example; class Chosen { public String transform(String input) { return request.getParameter("q"); } }',
		);
		expect((await scan(root)).kept).toBe(1);
	});
	test("keeps an unsafe fallback even when the selected implementation is safe", async () => {
		const { root, sources } = await fixture();
		await writeFile(
			path.join(sources, "Fallback.java"),
			'package example; class Fallback { public String transform(String input) { return request.getParameter("q"); } }',
		);
		expect((await scan(root)).kept).toBe(1);
	});
	test("keeps unresolved, conflicting, and missing implementation resources", async () => {
		const { root, resources } = await fixture();
		await unlink(path.join(resources, "strategy.properties"));
		expect((await scan(root)).kept).toBe(1);
		await writeFile(
			path.join(resources, "strategy.properties"),
			"implementation=Unknown",
		);
		expect((await scan(root)).kept).toBe(1);
		await writeFile(
			path.join(resources, "strategy.properties"),
			"implementation=Chosen",
		);
		await writeFile(
			path.join(root, "strategy.properties"),
			"implementation=Unknown",
		);
		expect((await scan(root)).kept).toBe(1);
	});
	test("rejects aliased or mutated factory properties", async () => {
		const { root, sources } = await fixture();
		await writeFile(
			path.join(sources, "StrategyFactory.java"),
			factory.replace(
				"String className",
				'config.setProperty("implementation",request.getParameter("q"));String className',
			),
		);
		expect((await scan(root)).kept).toBe(1);
	});
	test("binds suppression evidence to helper and configuration inputs", async () => {
		const { root, sources, resources } = await fixture();
		const original = await scan(root);
		await writeFile(
			path.join(sources, "Chosen.java"),
			'package example; class Chosen { public String transform(String input) { return "fixed"; } }',
		);
		const changed = await scan(root);
		expect(original.suppressions[0]?.sourceHash).toBe(
			changed.suppressions[0]?.sourceHash,
		);
		expect(original.suppressions[0]?.proofInputHash).toMatch(
			/^sha256:[a-f0-9]{64}$/,
		);
		expect(original.suppressions[0]?.proofInputHash).not.toBe(
			changed.suppressions[0]?.proofInputHash,
		);
		await writeFile(
			path.join(resources, "strategy.properties"),
			"implementation=Fallback",
		);
		expect((await scan(root)).suppressions[0]?.proofInputHash).not.toBe(
			changed.suppressions[0]?.proofInputHash,
		);
	});
	test("rejects ambiguous source class definitions", async () => {
		const { root } = await fixture();
		await writeFile(
			path.join(root, "Chosen.java"),
			'package example; class Chosen { public String transform(String input) { return request.getParameter("q"); } }',
		);
		expect((await scan(root)).kept).toBe(1);
	});
});
