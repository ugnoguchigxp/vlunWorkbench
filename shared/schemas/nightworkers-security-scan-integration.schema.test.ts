import { describe, expect, it } from "vitest";
import {
	integrationCapabilitiesFixture,
	integrationCompletedScanFixture,
	integrationErrorFixture,
	integrationPreviewFixture,
	integrationStartReportFixture,
	integrationStartScanFixture,
} from "../fixtures/nightworkers-security-scan-integration-v1";
import {
	integrationCapabilitiesSchema,
	integrationEnvelopeSchema,
	integrationErrorEnvelopeSchema,
	integrationFindingPageSchema,
	integrationPreviewSchema,
	integrationScanRunDetailSchema,
	integrationStartReportResponseSchema,
	integrationStartScanResponseSchema,
	NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
} from "./nightworkers-security-scan-integration.schema";

describe("NightWorkers security scan integration v1 schema", () => {
	it("parses the canonical success fixtures", () => {
		expect(
			integrationEnvelopeSchema(integrationCapabilitiesSchema).parse({
				contractVersion: NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
				requestId: "request-1",
				data: integrationCapabilitiesFixture,
			}).data.provider.id,
		).toBe("vulnworkbench");
		expect(integrationPreviewSchema.parse(integrationPreviewFixture)).toEqual(
			integrationPreviewFixture,
		);
		expect(
			integrationStartScanResponseSchema.parse(integrationStartScanFixture),
		).toEqual(integrationStartScanFixture);
		expect(
			integrationScanRunDetailSchema.parse(integrationCompletedScanFixture),
		).toEqual(integrationCompletedScanFixture);
		expect(
			integrationStartReportResponseSchema.parse(
				integrationStartReportFixture,
			),
		).toEqual(integrationStartReportFixture);
	});

	it("parses the canonical structured error", () => {
		expect(integrationErrorEnvelopeSchema.parse(integrationErrorFixture)).toEqual(
			integrationErrorFixture,
		);
	});

	it("rejects unknown enum values and contract versions", () => {
		expect(() =>
			integrationScanRunDetailSchema.parse({
				...integrationCompletedScanFixture,
				status: "paused",
			}),
		).toThrow();
		expect(() =>
			integrationErrorEnvelopeSchema.parse({
				...integrationErrorFixture,
				contractVersion: 2,
			}),
		).toThrow();
	});

	it("rejects finding payloads beyond the bounded field contract", () => {
		expect(() =>
			integrationFindingPageSchema.parse({
				items: [
					{
						ref: "finding-1",
						severity: "high",
						title: "x".repeat(1_025),
						category: null,
						tool: "semgrep",
						ruleId: null,
						location: { path: null, startLine: null, endLine: null },
						description: null,
						evidence: null,
						recommendation: null,
						references: [],
					},
				],
				nextCursor: null,
			}),
		).toThrow();
	});
});
