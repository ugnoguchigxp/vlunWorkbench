import { describe, expect, test } from "bun:test";
import type { ScanProfileStep } from "../shared/schemas/scan-profile.schema";
import {
	CANONICAL_SCANNER_E2E_CASE_IDS,
	caseIdsForProductionStep,
  loadScannerE2ECaseRegistry,
  productionScannerE2ECaseIds,
} from "./scanner-e2e-case-registry";

describe("scanner E2E case registry", () => {
  test("pins every required scanner capability in canonical order", async () => {
    const { registry, contractHash } = await loadScannerE2ECaseRegistry();

    expect(registry.cases.map((entry) => entry.id)).toEqual(
      [...CANONICAL_SCANNER_E2E_CASE_IDS],
    );
    expect(contractHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(productionScannerE2ECaseIds()).toEqual([
      ...CANONICAL_SCANNER_E2E_CASE_IDS,
    ]);
	});

	test("rejects an enabled scanner step that has no reviewed E2E case", () => {
		expect(() =>
			caseIdsForProductionStep({
				kind: "runtime_scanner",
				adapter: "unreviewed-runtime-scanner",
			} as unknown as ScanProfileStep),
		).toThrow("scanner_e2e_runtime_step_unmapped:unreviewed-runtime-scanner");
	});
});
