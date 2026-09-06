import { describe, expect, test } from "bun:test";
import { parseJavaProperties } from "./java-properties";

describe("Java properties syntax", () => {
	for (const [source, key, value] of [
		["digest MD5", "digest", "MD5"],
		["digest:MD5", "digest", "MD5"],
		["digest\\u002ealgorithm=\\u004dD5", "digest.algorithm", "MD5"],
		["digest=M\\\n   D5", "digest", "MD5"],
		["digest=M\\\r\n\tD5", "digest", "MD5"],
		["key\\ with\\ spaces\\:=value", "key with spaces:", "value"],
		["! ignored\ndigest=SHA-256\ndigest=MD5", "digest", "MD5"],
		["digest=MD5  ", "digest", "MD5  "],
		["digest=SHA\\-256", "digest", "SHA-256"],
		["key", "key", ""],
		["key=\\\\u004dD5", "key", "\\u004dD5"],
	] as const)
		test(JSON.stringify(source), () =>
			expect(parseJavaProperties(source)?.get(key)).toBe(value),
		);
	test("rejects malformed Unicode escapes instead of using a fallback", () => {
		expect(parseJavaProperties("digest=\\u12Q4")).toBeNull();
	});
});
