import { describe, expect, test } from "bun:test";
import { filterOwnedJavaTaintResults } from "./java-taint-precision-filter";

async function retained(
	body: string,
	target = "statement.execute(value)",
	rule = "sql-injection",
) {
	const source = `class Example { void run(String input, boolean condition) { ${body} ${target}; } }`;
	const offset = source.indexOf(target);
	const result = await filterOwnedJavaTaintResults(
		{
			results: [
				{
					check_id: `vuln-workbench.java.${rule}`,
					path: "Example.java",
					start: { line: 1, col: offset + 1 },
					end: { line: 1, col: offset + target.length + 1 },
				},
			],
		},
		{ readSource: async () => source },
	);
	return (result.output as { results: unknown[] }).results.length;
}
describe("Java standard mutable value models", () => {
	for (const [name, body, expected] of [
		[
			"clean builder append",
			'StringBuilder builder=new StringBuilder("fixed");String value=builder.append("suffix").toString();',
			0,
		],
		[
			"tainted builder append",
			'StringBuilder builder=new StringBuilder("fixed");String value=builder.append(input).toString();',
			1,
		],
		[
			"tainted initial builder",
			'StringBuilder builder=new StringBuilder(input);String value=builder.append("suffix").toString();',
			1,
		],
		[
			"clean builder replace",
			'StringBuilder builder=new StringBuilder("fixed");String value=builder.replace(0,builder.length(),"literal").toString();',
			0,
		],
		[
			"tainted builder replace",
			'StringBuilder builder=new StringBuilder("fixed");String value=builder.replace(0,builder.length(),input).toString();',
			1,
		],
		[
			"mutation through builder alias",
			'StringBuilder builder=new StringBuilder("fixed");StringBuilder alias=builder;alias.append(input);String value=builder.toString();',
			1,
		],
		[
			"unknown builder escape",
			'StringBuilder builder=new StringBuilder("fixed");mutate(builder,input);String value=builder.toString();',
			1,
		],
		[
			"conditional builder mutation",
			'StringBuilder builder=new StringBuilder("fixed");if(condition)builder.append(input);String value=builder.toString();',
			1,
		],
		["clean split element", 'String value="fixed text".split(" ")[0];', 0],
		["tainted split element", 'String value=input.split(" ")[0];', 1],
		[
			"split array mutation",
			'String[] values="fixed text".split(" ");values[0]=input;String value=values[0];',
			1,
		],
		[
			"split array escape",
			'String[] values="fixed text".split(" ");mutate(values,input);String value=values[0];',
			1,
		],
		[
			"unequal clean branch arrays",
			'String[] values;if(condition)values=new String[]{"a"};else values=new String[]{"b","c"};String value=values[0];',
			0,
		],
		[
			"unequal tainted branch arrays",
			'String[] values;if(condition)values=new String[]{input};else values=new String[]{"b","c"};String value=values[0];',
			1,
		],
		[
			"mutation after unknown array length",
			'String[] values;if(condition)values=new String[]{};else values=new String[]{"b","c"};values[0]=input;String value=values[0];',
			1,
		],
		[
			"collection insertion after unknown length",
			'java.util.List<String> values=new java.util.ArrayList<String>();if(condition)values.add("fixed");values.add(input);String value=values.get(0);',
			1,
		],
	] as const)
		test(name, async () => {
			expect(await retained(body)).toBe(expected);
		});
	test("does not confuse a clean but unknown format with HTML text context", async () => {
		const body =
			'response.setContentType("text/html");StringBuilder format=new StringBuilder("<script>");format.append("%s</script>");String value=org.springframework.web.util.HtmlUtils.htmlEscape(input);';
		expect(
			await retained(
				body,
				"response.getWriter().printf(format.toString(),value)",
				"xss-response-writer",
			),
		).toBe(1);
	});
	test("rejects format conversions that can create markup characters", async () => {
		const body =
			'response.setContentType("text/html");String value=org.springframework.web.util.HtmlUtils.htmlEscape(input);';
		expect(
			await retained(
				body,
				'response.getWriter().printf("%cscript>%s%c/script>",60,value,60)',
				"xss-response-writer",
			),
		).toBe(1);
		expect(
			await retained(
				body,
				'response.getWriter().printf(java.util.Locale.US,"%1$s",value)',
				"xss-response-writer",
			),
		).toBe(0);
	});
	test("HTML character counts do not carry markup", async () => {
		expect(
			await retained(
				'response.setContentType("text/html");String value=org.springframework.web.util.HtmlUtils.htmlEscape(input);',
				"response.getWriter().write(value.toCharArray(),0,value.length())",
				"xss-response-writer",
			),
		).toBe(0);
	});
});
