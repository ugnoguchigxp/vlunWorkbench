import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nightworkersSecurityIntelligencePilotEvidenceSchema } from "./nightworkers-security-intelligence-pilot.schema";

const templatePath = path.resolve(
	process.cwd(),
	"spec/evidence/security-intelligence-nightworkers-pilot-template.json",
);

describe("NightWorkers Security Intelligence pilot evidence", () => {
	it("keeps the checked-in template explicitly not started", () => {
		const template = nightworkersSecurityIntelligencePilotEvidenceSchema.parse(
			JSON.parse(readFileSync(templatePath, "utf8")),
		);
		expect(template.status).toBe("not_started");
		expect(template.sample.pairs).toEqual([]);
		expect(template.configuration).toMatchObject({
			vulnWorkbenchEndpointDefaultEnabled: false,
			nightWorkersConsumerDefaultEnabled: false,
			authorizationShadowDefaultEnabled: false,
		});
	});

	it("does not allow an incomplete template to claim completion", () => {
		const template = JSON.parse(readFileSync(templatePath, "utf8"));
		expect(() =>
			nightworkersSecurityIntelligencePilotEvidenceSchema.parse({
				...template,
				status: "completed",
			}),
		).toThrow("security_intelligence:pilot_sample_incomplete");
	});

	it("requires integrity incidents to stop rather than complete", () => {
		const completed = completedEvidence();
		expect(() =>
			nightworkersSecurityIntelligencePilotEvidenceSchema.parse({
				...completed,
				metrics: {
					...completed.metrics,
					wrongProjectOrRevisionBindingCount: 1,
				},
			}),
		).toThrow(
			"security_intelligence:pilot_integrity_incident_requires_stop",
		);
	});

	it("accepts a complete ten-pair artifact with verified privacy and rollback", () => {
		expect(
			nightworkersSecurityIntelligencePilotEvidenceSchema.parse(
				completedEvidence(),
			).status,
		).toBe("completed");
	});
});

function completedEvidence() {
	const template = JSON.parse(readFileSync(templatePath, "utf8"));
	return {
		...template,
		status: "completed",
		generatedAt: "2026-08-15T08:00:00.000Z",
		sample: {
			...template.sample,
			pairs: Array.from({ length: 10 }, (_, index) => ({
				taskRef: `task:${index}`,
				baselineRunRef: `run:baseline:${index}`,
				assessmentRunRef: `run:assessment:${index}`,
				projectRef: "project:fixture",
				sourceRevision: "a".repeat(40),
				targetDigest: `sha256:${"b".repeat(64)}`,
				selectedVerificationRefs: ["verification:dependency"],
				evidenceResolution: "resolved",
				outcome: "no_findings_observed",
				operatorAction: "investigated",
				baselineTimeToEvidenceSeconds: 20,
				assessmentTimeToEvidenceSeconds: 10,
				limitationCodes: [],
			})),
		},
		metrics: Object.fromEntries(
			Object.keys(template.metrics).map((key) => [key, 0]),
		),
		privacyAssertions: {
			noSourceBody: true,
			noSecret: true,
			noAbsoluteFilesystemPath: true,
		},
		rollbackDrill: {
			nightWorkersConsumerDisabled: true,
			vulnWorkbenchEndpointDisabled: true,
			existingScanApiUnaffected: true,
		},
	};
}
