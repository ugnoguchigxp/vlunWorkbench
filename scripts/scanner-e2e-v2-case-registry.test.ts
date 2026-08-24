import { describe, expect, test } from "bun:test";
import { loadScannerE2ECaseRegistryV2 } from "./scanner-e2e-v2-case-registry";

describe("scanner E2E v2 case registry", () => {
	test("keeps every v2 work and assertion contract bound to the production v1 inventory", async () => {
		const { registry, contractHash } = await loadScannerE2ECaseRegistryV2();
		expect(registry.cases).toHaveLength(13);
		expect(registry.cases.every((entry) => entry.requiredAssertionIds.includes("FAIL-01"))).toBe(true);
		expect(registry.cases.find((entry) => entry.id === "schemathesis-not-applicable")?.workCounters).toEqual({});
		expect(contractHash).toMatch(/^sha256:[a-f0-9]{64}$/);
	});
});
