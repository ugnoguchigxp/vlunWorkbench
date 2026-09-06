import { describe, expect, test } from "bun:test";
import { filterOwnedJavaTaintResults } from "./java-taint-precision-filter";

export async function keptFindings(
	body: string,
	sink: string,
	rule = "sql-injection",
) {
	const source = `class Example {\n void run(String param, boolean condition) {\n${body}\n }\n}`;
	const offset = source.indexOf(sink);
	const prefix = source.slice(0, offset);
	const line = prefix.split("\n").length;
	const col = offset - prefix.lastIndexOf("\n");
	const input = {
		results: [
			{
				check_id: `vuln-workbench.java.${rule}`,
				path: "Example.java",
				start: { line, col, offset },
				end: {
					line,
					col: col + sink.replace(/\);$/, "").length,
					offset: offset + sink.replace(/\);$/, "").length,
				},
			},
		],
	};
	const result = await filterOwnedJavaTaintResults(input, {
		readSource: async () => source,
	});
	return (result.output as typeof input).results.length;
}

const safeBranch = `String bar; int num = 86;
if ((7 * 42) - num > 200) bar = "safe"; else bar = param;`;

describe("Java suppression adversarial holdouts", () => {
	for (const [name, body, sink] of [
		[
			"a different sink argument",
			`${safeBranch}\nstatement.execute(param);`,
			"param);",
		],
		[
			"a sink before the safe assignment",
			`String bar = param;\nstatement.execute(bar);\nint num = 86; if ((7 * 42) - num > 200) bar = "safe"; else bar = param;`,
			"bar);",
		],
		[
			"a second tainted operand",
			`${safeBranch}\nstatement.execute(bar + param);`,
			"bar + param",
		],
		[
			"compound reassignment",
			`${safeBranch}\nbar += param;\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a changed branch selector",
			`int num = 86; num = 106; String bar; if ((7 * 42) - num > 200) bar = "safe"; else bar = param;\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a proof in a comment",
			`String bar = param; /* int num = 86; if ((7 * 42) - num > 200) bar = "safe"; else bar = param; */\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a conditional list mutation",
			`java.util.List<String> values = new java.util.ArrayList<String>(); values.add("safe"); if (condition) values.add(param); values.add("last"); String bar = values.get(1);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an unmodeled list mutation",
			`java.util.List<String> values = new java.util.ArrayList<String>(); values.add("safe"); values.set(0, param); String bar = values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an aliased list mutation",
			`java.util.List<String> values = new java.util.ArrayList<String>(); values.add("safe"); java.util.List<String> alias = values; alias.set(0, param); String bar = values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an escaped collection",
			`java.util.List<String> values = new java.util.ArrayList<String>(); values.add("safe"); mutate(values, param); String bar = values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an unmodeled map mutation",
			`java.util.HashMap<String,Object> values = new java.util.HashMap<String,Object>(); values.put("key", "safe"); values.replace("key", param); String bar = (String)values.get("key");\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"switch fallthrough",
			`String bar; String guess = "ABC"; char switchTarget = guess.charAt(1); switch(switchTarget) {\ncase 'B': bar = "safe";\ncase 'C': bar = param; break;\ndefault: bar = param;\n}\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a reassigned long selector",
			`long selector; selector=2147483647; String bar=param; if(selector+1<0)bar="safe";\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an integer cast that changes a branch",
			`int selector=256; String bar=param; if((byte)selector>0)bar="safe";\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a short-circuited assignment",
			`String bar=param; boolean ignored=false && ((bar="safe")!=null);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a mutation through a collection view",
			`java.util.List<String> values=new java.util.ArrayList<String>();values.add("safe");values.subList(0,1).set(0,param);String bar=values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a mutated character array",
			`char[] values="safe".toCharArray(); values[0]=param.charAt(0);String bar=new String(values);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"an assignment in a shadowing scope",
			`String bar=param; {String bar="first";bar="second";}\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"boxed integer identity",
			`Integer left=256;Integer right=256;String bar=param;if(left==right)bar="safe";\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"boxed list removal overload",
			`java.util.List<String> values=new java.util.ArrayList<String>();values.add(param);values.add("safe");Integer index=0;values.remove(index);String bar=values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
		[
			"a list escaping through a constructor",
			`java.util.List<String> values=new java.util.ArrayList<String>();values.add("safe");Object worker=new Worker(values,param);String bar=values.get(0);\nstatement.execute(bar);`,
			"bar);",
		],
	] as const) {
		test(`retains ${name}`, async () => {
			expect(await keptFindings(body, sink)).toBe(1);
		});
	}
	test("still removes a proven constant reaching the actual sink", async () => {
		expect(
			await keptFindings(`${safeBranch}\nstatement.execute(bar);`, "bar);"),
		).toBe(0);
	});
});
