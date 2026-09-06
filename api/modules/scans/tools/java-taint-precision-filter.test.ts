import { describe, expect, test } from "bun:test";
import { filterOwnedJavaTaintResults } from "./java-taint-precision-filter";

function finding(source: string, target: string, rule = "sql-injection") {
	const offset = source.indexOf(target),
		prefix = source.slice(0, offset);
	const line = prefix.split("\n").length,
		col = Buffer.byteLength(prefix.slice(prefix.lastIndexOf("\n") + 1)) + 1;
	return {
		check_id: `vuln-workbench.java.${rule}`,
		path: "Example.java",
		start: { line, col },
		end: { line, col: col + Buffer.byteLength(target) },
		extra: { metadata: { cwe: "CWE-89" } },
	};
}
async function filter(source: string, target: string, rule = "sql-injection") {
	const input = { results: [finding(source, target, rule)] };
	const result = await filterOwnedJavaTaintResults(input, {
		readSource: async () => source,
	});
	return { ...result, results: (result.output as typeof input).results };
}
const method = (body: string) =>
	`class Example { void run(String incoming, boolean condition) { ${body} } }`;
const suffix = "statement.execute(selected);";

describe("owned Java taint precision filter", () => {
	for (const [name, body] of [
		[
			"constant branch with renamed variables",
			'String selected; int threshold=40; if (threshold*3>100) selected="safe"; else selected=incoming;',
		],
		[
			"constant ternary",
			'int number=20; String selected=number/2==10?"safe":incoming;',
		],
		[
			"safe paths at a branch join",
			'String selected; if(condition) selected="one"; else selected="two";',
		],
		[
			"constant switch",
			'String selector="xyz"; char choice=selector.charAt(1); String selected; switch(choice){case \'y\': selected="safe";break;default:selected=incoming;}',
		],
		[
			"list overwrite",
			'java.util.List<String> values=new java.util.ArrayList<String>(); values.add("first");values.add(incoming);values.add("last");values.remove(0);String selected=values.get(1);',
		],
		[
			"map overwrite",
			'java.util.HashMap<String,Object> values=new java.util.HashMap<String,Object>(); values.put("key",incoming);values.put("key","constant");String selected=(String)values.get("key");',
		],
		[
			"safe collection read through an alias",
			'java.util.List<String> values=new java.util.ArrayList<String>(); values.add("constant");java.util.List<String> alias=values;String selected=alias.get(0);',
		],
	] as const)
		test(`proves ${name}`, async () => {
			// Use the actual argument range instead of a synthetic whole-method line.
			const input = finding(method(`${body}${suffix}`), "selected);");
			input.end.col -= 2;
			const checked = await filterOwnedJavaTaintResults(
				{ results: [input] },
				{ readSource: async () => method(`${body}${suffix}`) },
			);
			expect((checked.output as { results: unknown[] }).results).toHaveLength(
				0,
			);
			expect(checked.suppressions).toHaveLength(1);
		});
	test("binds the proof to the exact occurrence on a line", async () => {
		const source = method(
			'String selected=incoming;statement.execute(selected);selected="safe";statement.execute(selected);',
		);
		const first = finding(source, "statement.execute(selected)");
		const offset = source.lastIndexOf("statement.execute(selected)");
		const second = {
			...first,
			start: { line: 1, col: offset + 1 },
			end: { line: 1, col: offset + 1 + "statement.execute(selected)".length },
		};
		const result = await filterOwnedJavaTaintResults(
			{ results: [first, second] },
			{ readSource: async () => source },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(1);
		expect(result.suppressions).toHaveLength(1);
	});
	test("keeps unowned rules and hashes the source for every proof", async () => {
		const source = method(
			'String selected=incoming; selected="safe"; statement.execute(selected);',
		);
		const owned = finding(source, "statement.execute(selected)");
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					owned,
					{ ...owned, check_id: "community.java.sql-injection" },
				],
			},
			{ readSource: async () => source },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(1);
		expect(result.suppressions[0]).toEqual(
			expect.objectContaining({
				findingId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			}),
		);
	});
	test("follows a private helper in the correct class", async () => {
		const source =
			'class Example { void run(String incoming) { String selected=transform(incoming); statement.execute(selected); } private static String transform(String input) {int threshold=3; return threshold>2?"safe":input;} }';
		expect(
			(await filter(source, "statement.execute(selected)")).results,
		).toHaveLength(0);
	});
	test("does not resolve a same-named helper on an unrelated receiver", async () => {
		const source =
			'class Example { void run(String incoming) { String selected=remote.transform(incoming); statement.execute(selected); } private static String transform(String input) {return "safe";} }';
		expect(
			(await filter(source, "statement.execute(selected)")).results,
		).toHaveLength(1);
	});
	test("does not treat an unknown callee with a constant argument as pure", async () => {
		const source = method(
			'String selected=remote.transform("constant");statement.execute(selected);',
		);
		expect(
			(await filter(source, "statement.execute(selected)")).results,
		).toHaveLength(1);
	});
	test("requires an unambiguous helper overload", async () => {
		const source =
			'class Example { void run(String incoming) { String selected=transform(incoming); statement.execute(selected); } private static String transform(String input) {return "safe";} private static String transform(Object input) {return input.toString();} }';
		expect(
			(await filter(source, "statement.execute(selected)")).results,
		).toHaveLength(1);
	});
	test("keeps inherited overload dispatch ambiguous", async () => {
		const source =
			'class Example extends Parent { void run(Object incoming) { String selected=transform(incoming); statement.execute(selected); } private String transform(String input) {return "safe";} }';
		expect(
			(await filter(source, "statement.execute(selected)")).results,
		).toHaveLength(1);
		expect(
			(
				await filter(
					source.replace("run(Object incoming)", "run(String incoming)"),
					"statement.execute(selected)",
				)
			).results,
		).toHaveLength(0);
	});
	test("keeps output context unknown after a response or writer escapes", async () => {
		for (const prefix of [
			"render(response);",
			"java.io.PrintWriter writer=response.getWriter();render(writer);",
		]) {
			const source = method(
				'response.setContentType("text/html");' +
					prefix +
					"String selected=org.springframework.web.util.HtmlUtils.htmlEscape(incoming);response.getWriter().print(selected);",
			);
			expect(
				(
					await filter(
						source,
						"response.getWriter().print(selected)",
						"xss-response-writer",
					)
				).results,
			).toHaveLength(1);
		}
	});
	test("does not use another method as proof", async () => {
		const source =
			'class Example { void safe(String incoming) {String selected="safe";statement.execute(selected);} void unsafe(String incoming) {statement.execute(incoming);} }';
		expect(
			(await filter(source, "statement.execute(incoming)")).results,
		).toHaveLength(1);
	});
	test("uses HTML encoding only in a proven HTML text write", async () => {
		const source = method(
			'response.setContentType("text/html");String selected=org.springframework.web.util.HtmlUtils.htmlEscape(incoming);response.getWriter().print(selected);',
		);
		expect(
			(
				await filter(
					source,
					"response.getWriter().print(selected)",
					"xss-response-writer",
				)
			).results,
		).toHaveLength(0);
		expect(
			(
				await filter(
					source.replace(
						"response.getWriter().print(selected);",
						'response.getWriter().print("<script>");response.getWriter().print(selected);',
					),
					"response.getWriter().print(selected)",
					"xss-response-writer",
				)
			).results,
		).toHaveLength(1);
		expect(
			(
				await filter(
					source.replace('"text/html"', '"application/javascript"'),
					"response.getWriter().print(selected)",
					"xss-response-writer",
				)
			).results,
		).toHaveLength(1);
	});
	test("excludes only output paths that return before the sink", async () => {
		const source = method(
			'response.setContentType("text/html");if(condition){response.getWriter().print("<script>");return;}String selected=org.springframework.web.util.HtmlUtils.htmlEscape(incoming);response.getWriter().print(selected);',
		);
		expect(
			(
				await filter(
					source,
					"response.getWriter().print(selected)",
					"xss-response-writer",
				)
			).results,
		).toHaveLength(0);
		expect(
			(
				await filter(
					source.replace("return;", ""),
					"response.getWriter().print(selected)",
					"xss-response-writer",
				)
			).results,
		).toHaveLength(1);
	});
	test("checks every URI constructor component", async () => {
		const source = method(
			'java.net.URI uri=new java.net.URI("file",null,"/tmp/"+incoming,null,null);new java.io.File(uri);',
		);
		expect(
			(await filter(source, "new java.io.File(uri)", "path-traversal-file"))
				.results,
		).toHaveLength(1);
		expect(
			(
				await filter(
					source.replace('"/tmp/"+incoming', '"/tmp/fixed"'),
					"new java.io.File(uri)",
					"path-traversal-file",
				)
			).results,
		).toHaveLength(0);
	});
	test("keeps missing positions, invalid Java and Unicode preprocessing ambiguous", async () => {
		for (const source of [
			method("statement.execute(incoming);"),
			method('String selected="safe";statement.execute(selected);').replace(
				'"safe"',
				'"\\u0073afe"',
			),
			"invalid {",
		]) {
			const result = await filterOwnedJavaTaintResults(
				{
					results: [
						{
							check_id: "vuln-workbench.java.sql-injection",
							path: "Example.java",
							start: { line: 1, col: 1 },
						},
					],
				},
				{ readSource: async () => source },
			);
			expect(result.suppressions).toEqual([]);
		}
	});
	test("suppresses only a configured digest proven strong at this callsite", async () => {
		const source = method(
			'java.util.Properties properties=new java.util.Properties();properties.load(getClass().getClassLoader().getResourceAsStream("app.properties"));String algorithm=properties.getProperty("digest","SHA-256");java.security.MessageDigest.getInstance(algorithm);',
		);
		const item = finding(
			source,
			"java.security.MessageDigest.getInstance(algorithm)",
			"configured-weak-hash",
		);
		for (const value of ["MD5", "SHA-256", "unknown"]) {
			const result = await filterOwnedJavaTaintResults(
				{ results: [item] },
				{
					readSource: async () => source,
					projectRoot: "/nonexistent",
					resolveProjectProperty: async () => ({ status: "resolved", value }),
				},
			);
			expect((result.output as { results: unknown[] }).results).toHaveLength(
				value === "SHA-256" ? 0 : 1,
			);
		}
		for (const status of ["resource_missing", "ambiguous"] as const) {
			const result = await filterOwnedJavaTaintResults(
				{ results: [item] },
				{
					readSource: async () => source,
					projectRoot: "/nonexistent",
					resolveProjectProperty: async () => ({ status }),
				},
			);
			expect(result.suppressions).toEqual([]);
		}
		const result = await filterOwnedJavaTaintResults(
			{
				results: [{ ...item, check_id: "community.java.configured-weak-hash" }],
			},
			{
				readSource: async () => source,
				projectRoot: "/nonexistent",
				resolveProjectProperty: async () => ({
					status: "resolved",
					value: "SHA-256",
				}),
			},
		);
		expect(result.suppressions).toEqual([]);
	});
});
