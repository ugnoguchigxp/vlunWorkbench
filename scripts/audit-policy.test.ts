import { describe, expect, test } from "bun:test";
import { npmAuditPayload, parseAuditReport } from "./audit-policy";
import { runAuditCommand } from "./check-audit-policy";

describe("audit policy", () => {
	test("terminates a stalled audit process", async () => {
		await expect(runAuditCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"], 100)).rejects.toThrow("timed out");
	});
	test("drains stderr while collecting the report", async () => {
		const result = await runAuditCommand([process.execPath, "-e", 'await Promise.all([Bun.write(Bun.stderr, "x".repeat(1_000_000)), Bun.write(Bun.stdout, "{}")]);'], 3000);
		expect(result.exitCode).toBe(0);
		expect(parseAuditReport(result.stdout, result.exitCode).ok).toBe(true);
	});
	test("accepts an empty successful response but rejects errors and malformed data", () => {
		expect(parseAuditReport("{}", 0).ok).toBe(true);
		for (const [text, code] of [["{}", 1], ["{}", 2], ["", 0], ["null", 0], ['{"error":"unavailable"}', 0]] as const) {
			expect(() => parseAuditReport(text, code)).toThrow();
		}
	});
	test("blocks moderate or higher and preserves nonblocking findings", () => {
		for (const severity of ["low", "moderate", "high", "critical"]) {
			const report = parseAuditReport(JSON.stringify({ pkg: [{ id: 1, title: "issue", severity }] }), 1);
			expect(report.total).toBe(1);
			expect(report.ok).toBe(severity === "low");
		}
		expect(() => parseAuditReport('{"pkg":[{"id":1,"title":"issue","severity":"unknown"}]}', 0)).toThrow();
	});
	test("includes scoped, nested and multiple locked versions without duplicates", () => {
		expect(npmAuditPayload({ packages: {
			pkg: ["pkg@1.0.0", ""],
			"parent/pkg": ["pkg@2.0.0", ""],
			"other/pkg": ["pkg@1.0.0", ""],
			"@scope/pkg": ["@scope/pkg@1.0.0-beta.1", ""],
		} })).toEqual({ pkg: ["1.0.0", "2.0.0"], "@scope/pkg": ["1.0.0-beta.1"] });
	});
	test("rejects incomplete or unsupported lockfiles", () => {
		for (const lock of [{}, { packages: {} }, { packages: { pkg: ["pkg@file:../pkg", ""] } }, { packages: { pkg: ["pkg@1.0.0", "https://private.example/pkg"] } }]) {
			expect(() => npmAuditPayload(lock)).toThrow();
		}
	});
});
