import { describe, expect, it } from "vitest";
import {
	formatScanPreflightFailure,
	readScanPreflightDisplay,
} from "./scan-preflight-display";

const digest = `sha256:${"a".repeat(64)}`;

describe("scan preflight display", () => {
	it("reads the persisted server-owned preflight result", () => {
		const result = readScanPreflightDisplay({
			scanPreflight: {
				schemaVersion: 1,
				projectId: "project-1",
				profileId: "baseline",
				sourceRevision: null,
				sourceState: "unknown",
				mode: "enforced",
				status: "blocked",
				createdAt: "2026-08-16T00:00:00.000Z",
				checks: [
					{
						id: "osv:scanner-data",
						stepId: "osv",
						kind: "scanner_data",
						required: true,
						status: "blocked",
						reasonCode: "scanner_data_missing",
						action: "prepare_scanner_database",
						scannerId: "osv",
						observedVersion: null,
						expectedVersion: "2.4.0",
						expectedDigest: digest,
						observedDigest: null,
						dataState: "missing",
						dataGeneratedAt: null,
						evidenceRefs: [],
					},
				],
				summary: {
					ready: 0,
					blockedRequired: 1,
					blockedOptional: 0,
					notApplicable: 0,
				},
				limitationCodes: ["scanner_data_missing"],
				binding: {
					resolvedProfileHash: digest,
					executionHash: digest,
					scannerManifestHash: digest,
					scannerVersionsHash: digest,
					dockerImagesHash: null,
					targetPlanHash: null,
					sourceRevisionHash: null,
				},
				bindingHash: digest,
				preflightHash: digest,
			},
		});
		expect(result).toMatchObject({
			status: "blocked",
			checks: [
				expect.objectContaining({
					reasonCode: "scanner_data_missing",
					action: "prepare_scanner_database",
				}),
			],
		});
		expect(formatScanPreflightFailure(result!)).toBe(
			"scan preflight failed: osv [osv]: scanner_data_missing (expected version 2.4.0, observed unavailable, expected digest sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, observed digest unavailable, action prepare_scanner_database)",
		);
	});

	it("rejects a UI-only or malformed readiness guess", () => {
		expect(
			readScanPreflightDisplay({ scanPreflight: { status: "ready" } }),
		).toBeNull();
	});
});
