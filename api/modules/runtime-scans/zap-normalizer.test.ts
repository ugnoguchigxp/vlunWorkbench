import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeZap } from "./zap-normalizer";
import { parseZapReport } from "./zap-report-schema";

const fixturePath = path.join(import.meta.dirname, "fixtures", "zap-report-2.17.0.json");

describe("ZAP report schema and normalizer", () => {
	it("validates the real fixture and emits one finding per instance", async () => {
		const report = parseZapReport(JSON.parse(await fs.readFile(fixturePath, "utf8")));
		const findings = normalizeZap(report, {
			upstreamOrigin: "http://127.0.0.1:3000",
			gatewayOrigin: "http://host.docker.internal:3000",
		});
		expect(findings).toHaveLength(2);
		expect(findings.every((finding) => finding.primaryLocation.path !== "unknown")).toBe(true);
		expect(findings[0]?.primaryLocation.path).toContain("http://127.0.0.1:3000");
		expect(findings[0]?.metadata).toMatchObject({ zapConfidenceCode: "2", cweId: "693", wascId: "15" });
		expect(findings[0]?.severity).toBe("low");
		expect(findings[0]?.fingerprint).not.toBe(findings[1]?.fingerprint);
	});

	it("rejects structurally invalid zero-content reports", () => {
		expect(() => parseZapReport({})).toThrow();
		expect(() => parseZapReport([])).toThrow();
		expect(parseZapReport({ "@programName": "ZAP", "@version": "2.17.0", site: [] }).site).toEqual([]);
	});

	it("creates a fallback finding for an alert without instances", () => {
		const report = parseZapReport({
			"@programName": "ZAP",
			"@version": "2.17.0",
			site: [{ "@host": "127.0.0.1", "@port": "3000", alerts: [{ pluginid: "1", riskcode: "3", confidence: "1" }] }],
		});
		const findings = normalizeZap(report, { upstreamOrigin: "http://127.0.0.1:3000", gatewayOrigin: "http://host.docker.internal:3000" });
		expect(findings).toHaveLength(1);
		expect(findings[0]?.severity).toBe("high");
	});
});
