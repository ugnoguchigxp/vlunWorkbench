import { describe, expect, it } from "vitest";
import { coverageLedgerSchema } from "./scan-coverage-ledger.schema";

const DIGEST = `sha256:${"a".repeat(64)}`;

function validLedger() {
	return {
		schemaVersion: 1,
		planHash: DIGEST,
		derivedAt: "2026-08-21T00:00:00.000Z",
		entries: [
			{
				capabilityId: "api_schema_contract",
				requirement: "required_if_applicable",
				applicability: "not_applicable",
				execution: "not_executed",
				coverageEffect: "covered",
				reasonCodes: ["schema_not_found"],
				evidenceRefs: ["schema-discovery:none"],
				limitations: [],
			},
		],
		summary: { covered: 1, partial: 0, gap: 0 },
		ledgerHash: DIGEST,
	};
}

describe("coverage ledger schema", () => {
	it("accepts evidence-backed not-applicable entries", () => {
		expect(coverageLedgerSchema.safeParse(validLedger()).success).toBe(true);
	});

	it("rejects evidence-less not-applicable entries and duplicate capabilities", () => {
		const withoutEvidence = validLedger();
		withoutEvidence.entries[0]!.evidenceRefs = [];
		expect(coverageLedgerSchema.safeParse(withoutEvidence).success).toBe(false);

		const duplicate = validLedger();
		duplicate.entries.push({ ...duplicate.entries[0]! });
		expect(coverageLedgerSchema.safeParse(duplicate).success).toBe(false);
	});
});
