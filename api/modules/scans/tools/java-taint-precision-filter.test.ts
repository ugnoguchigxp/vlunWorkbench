import { describe, expect, test } from "bun:test";
import {
	filterOwnedJavaTaintResults,
	proveOwnedJavaTaintFindingSafe,
} from "./java-taint-precision-filter";

describe("owned Java taint precision filter", () => {
	test("proves only the reachable side of constant branches safe", () => {
		const safeIf = `
			String bar;
			int num = 86;
			if ((7 * 42) - num > 200) bar = "safe"; else bar = param;
		`;
		const unsafeIf = safeIf.replace("86", "106");
		const safeTernary = `
			String bar;
			int num = 106;
			bar = (7 * 18) + num > 200 ? "safe" : param;
		`;
		const unsafeTernary = safeTernary.replace("106", "10");
		expect(proveOwnedJavaTaintFindingSafe(safeIf, "sql-injection")).toBe(
			"constant_branch",
		);
		expect(proveOwnedJavaTaintFindingSafe(unsafeIf, "sql-injection")).toBeNull();
		expect(
			proveOwnedJavaTaintFindingSafe(
				`${safeIf}\nbar = param;`,
				"sql-injection",
			),
		).toBeNull();
		expect(proveOwnedJavaTaintFindingSafe(safeTernary, "sql-injection")).toBe(
			"constant_branch",
		);
		expect(
			proveOwnedJavaTaintFindingSafe(unsafeTernary, "sql-injection"),
		).toBeNull();
	});

	test("simulates constant switch and collection overwrite flows", () => {
		const safeSwitch = `
			String bar;
			String guess = "ABC";
			char switchTarget = guess.charAt(1);
			switch (switchTarget) {
				case 'A': bar = param; break;
				case 'B': bar = "safe"; break;
				default: bar = param;
			}
		`;
		expect(
			proveOwnedJavaTaintFindingSafe(safeSwitch, "path-traversal-file"),
		).toBe("constant_switch");
		expect(
			proveOwnedJavaTaintFindingSafe(
				safeSwitch.replace('"ABC"', '"AAC"'),
				"path-traversal-file",
			),
		).toBeNull();

		const safeList = `
			String bar = "safe";
			java.util.List<String> values = new java.util.ArrayList<String>();
			values.add("first");
			values.add(param);
			values.add("last");
			values.remove(0);
			bar = values.get(1);
		`;
		expect(
			proveOwnedJavaTaintFindingSafe(safeList, "command-injection"),
		).toBe("collection_overwrite");
		expect(
			proveOwnedJavaTaintFindingSafe(
				safeList.replace("get(1)", "get(0)"),
				"command-injection",
			),
		).toBeNull();
		expect(
			proveOwnedJavaTaintFindingSafe(
				`java.util.List<String> values = new java.util.ArrayList<String>();
				values.add(param);
				String bar = values.get(0);
				values.remove(0);
				values.add("safe-after-read");`,
				"command-injection",
			),
		).toBeNull();

		const safeMap = `
			String bar = "safe";
			java.util.HashMap<String,Object> values = new java.util.HashMap<String,Object>();
			values.put("tainted", param);
			values.put("safe", "constant");
			bar = (String)values.get("tainted");
			bar = (String)values.get("safe");
		`;
		expect(proveOwnedJavaTaintFindingSafe(safeMap, "ldap-injection")).toBe(
			"collection_overwrite",
		);
		expect(
			proveOwnedJavaTaintFindingSafe(
				safeMap.replace(
					'bar = (String)values.get("safe");',
					"",
				),
				"ldap-injection",
			),
		).toBeNull();
		expect(
			proveOwnedJavaTaintFindingSafe(
				`java.util.HashMap<String,Object> values = new java.util.HashMap<String,Object>();
				values.put("selected", param);
				String bar = (String)values.get("selected");
				values.put("selected", "safe-after-read");`,
				"ldap-injection",
			),
		).toBeNull();
	});

	test("keeps contextual encoding specific to XSS and static callees generic", () => {
		const encoded =
			"String bar = org.springframework.web.util.HtmlUtils.htmlEscape(param);";
		expect(
			proveOwnedJavaTaintFindingSafe(encoded, "xss-response-writer"),
		).toBe("contextual_output_encoding");
		expect(
			proveOwnedJavaTaintFindingSafe(encoded, "trust-boundary"),
		).toBeNull();
		expect(
			proveOwnedJavaTaintFindingSafe(
				`${encoded}\nbar = param;`,
				"xss-response-writer",
			),
		).toBeNull();
		const staticCall = `
			String ignored = param;
			String g123 = "constant";
			String bar = thing.doSomething(g123);
			return bar;
		`;
		expect(
			proveOwnedJavaTaintFindingSafe(staticCall, "xpath-injection"),
		).toBe("constant_interprocedural_flow");
		expect(
			proveOwnedJavaTaintFindingSafe(
				staticCall.replace("g123);", "param);"),
				"xpath-injection",
			),
		).toBeNull();
	});

	test("filters only owned Java taint findings and records audit data", async () => {
		const safeSource = `class Safe {
			void run(String param) {
				String bar;
				int num = 86;
				if ((7 * 42) - num > 200) bar = "safe"; else bar = param;
				sink(bar);
			}
		}`;
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					finding("vuln-workbench.java.sql-injection", "Safe.java"),
					finding("community.java.sql-injection", "Safe.java"),
					finding("vuln-workbench.java.weak-hash", "Safe.java"),
				],
			},
			{ readSource: async () => safeSource },
		);
		expect(
			(result.output as { results: unknown[] }).results,
		).toHaveLength(2);
		expect(result.suppressions).toEqual([
			expect.objectContaining({
				findingId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				checkId: "vuln-workbench.java.sql-injection",
				reason: "constant_branch",
				sourceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			}),
		]);
		const repeated = await filterOwnedJavaTaintResults(
			{
				results: [
					finding("vuln-workbench.java.sql-injection", "Safe.java"),
				],
			},
			{ readSource: async () => safeSource },
		);
		expect(repeated.suppressions[0]?.findingId).toBe(
			result.suppressions[0]?.findingId,
		);
		expect(repeated.suppressions[0]?.sourceHash).toBe(
			result.suppressions[0]?.sourceHash,
		);
	});

	test("does not suppress an unsafe finding because another method is safe", async () => {
		const mixedSource = `class Mixed {
			void safe(String param) {
				String bar = org.springframework.web.util.HtmlUtils.htmlEscape(param);
				sink(bar);
			}
			void unsafe(String param) {
				sink(param);
			}
		}`;
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					finding("vuln-workbench.java.xss-response-writer", "Mixed.java", 4),
					finding("vuln-workbench.java.xss-response-writer", "Mixed.java", 7),
				],
			},
			{ readSource: async () => mixedSource },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(1);
		expect(result.suppressions).toHaveLength(1);
		expect(result.suppressions[0]?.line).toBe(4);
	});

	test("suppresses a finding only when its unique in-file helper proves safe", async () => {
		const helperSource = `class HelperFlow {
			void run(String param) {
				String bar = new Helper().transform(param);
				sink(bar);
			}
			String transform(String param) {
				String bar;
				int num = 86;
				if ((7 * 42) - num > 200) bar = "safe"; else bar = param;
				return bar;
			}
		}`;
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					finding("vuln-workbench.java.sql-injection", "HelperFlow.java", 4),
				],
			},
			{ readSource: async () => helperSource },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(0);
		expect(result.suppressions[0]?.reason).toBe("constant_branch");
	});

	test("does not use an unrelated safe helper to suppress the value reaching the sink", async () => {
		const helperSource = `class MixedHelperFlow {
			void run(String param) {
				safeTransform(param);
				String bar = unsafeTransform(param);
				sink(bar);
			}
			String safeTransform(String param) {
				String bar;
				int num = 86;
				if ((7 * 42) - num > 200) bar = "safe"; else bar = param;
				return bar;
			}
			String unsafeTransform(String param) {
				String bar = param;
				return bar;
			}
		}`;
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					finding(
						"vuln-workbench.java.sql-injection",
						"MixedHelperFlow.java",
						5,
					),
				],
			},
			{ readSource: async () => helperSource },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(1);
		expect(result.suppressions).toEqual([]);
	});

	test("keeps only configured digest findings resolved to a weak algorithm", async () => {
		const configuredSource = `class ConfiguredHash {
			void run() throws Exception {
				java.util.Properties properties = new java.util.Properties();
				properties.load(getClass().getClassLoader().getResourceAsStream("application.properties"));
				String algorithm = properties.getProperty("security.digest", "SHA-256");
				java.security.MessageDigest.getInstance(algorithm);
			}
		}`;
		const input = {
			results: [
				finding(
					"vuln-workbench.java.configured-weak-hash",
					"ConfiguredHash.java",
					6,
				),
			],
		};
		const strong = await filterOwnedJavaTaintResults(input, {
			readSource: async () => configuredSource,
			projectRoot: "/repo",
			resolveProjectProperty: async () => ({
				status: "resolved",
				value: "SHA-256",
			}),
		});
		expect((strong.output as { results: unknown[] }).results).toHaveLength(0);
		expect(strong.suppressions[0]?.reason).toBe(
			"configured_algorithm_strong",
		);
		const weak = await filterOwnedJavaTaintResults(input, {
			readSource: async () => configuredSource,
			projectRoot: "/repo",
			resolveProjectProperty: async () => ({
				status: "resolved",
				value: "MD5",
			}),
		});
		expect((weak.output as { results: unknown[] }).results).toHaveLength(1);
		expect(weak.suppressions).toEqual([]);
		const unresolved = await filterOwnedJavaTaintResults(input, {
			readSource: async () => configuredSource,
		});
		expect((unresolved.output as { results: unknown[] }).results).toHaveLength(0);
		expect(unresolved.suppressions[0]?.reason).toBe(
			"configured_algorithm_unresolved",
		);
	});

	test("applies XSS safety proofs to the parameter-name output variant", async () => {
		const safeSource = `class ParameterNameOutput {
			void run(String param) {
				String bar;
				int num = 86;
				if ((7 * 42) - num > 200) bar = "safe"; else bar = param;
				sink(bar);
			}
		}`;
		const result = await filterOwnedJavaTaintResults(
			{
				results: [
					finding(
						"vuln-workbench.java.xss-parameter-name-output",
						"ParameterNameOutput.java",
						6,
					),
				],
			},
			{ readSource: async () => safeSource },
		);
		expect((result.output as { results: unknown[] }).results).toHaveLength(0);
		expect(result.suppressions[0]).toEqual(
			expect.objectContaining({
				checkId: "vuln-workbench.java.xss-parameter-name-output",
				reason: "constant_branch",
			}),
		);
	});
});

function finding(checkId: string, path: string, line = 5) {
	return {
		check_id: checkId,
		path,
		start: { line, col: 1 },
		end: { line, col: 2 },
		extra: { metadata: { cwe: "CWE-89" } },
	};
}
