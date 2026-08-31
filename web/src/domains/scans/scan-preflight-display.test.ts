import { describe, expect, it } from "vitest";
import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import {
	describeScanPreflightReason,
	formatScanPreflightFailure,
	readScanPreflightDisplay,
} from "./scan-preflight-display";

const digest = `sha256:${"a".repeat(64)}`;

describe("scan preflight display", () => {
	it("does not prescribe unrelated runtime scanners for an unavailable image", () => {
		expect(describeScanPreflightReason("docker_image_unavailable")).toMatchObject({
			heading: expect.stringContaining("コンテナイメージ"),
			nextAction: expect.stringContaining("対象イメージ"),
		});
		expect(
			describeScanPreflightReason("docker_image_unavailable").nextAction,
		).not.toMatch(/Nuclei|ZAP|Schemathesis/);
	});

	it("gives a source scanner image action when the blocked check identifies it", () => {
		const display = describeScanPreflightReason(
			"docker_image_unavailable",
			"build_toolbox_image",
		);
		expect(display.nextAction).toContain("スキャナー用コンテナイメージ");
		expect(display.nextAction).not.toContain("ローカルRuntimeを自動設定");
	});

	it("does not tell an unsupported Maven or WAR target to add package.json", () => {
		const display = describeScanPreflightReason(
			"runtime_dependency_adapter_unqualified",
		);
		expect(display.heading).toContain("隔離実行方式");
		expect(display.nextAction).toContain("Maven");
		expect(display.nextAction).toContain("WAR");
		expect(display.nextAction).toContain("package.json を追加せず");
		expect(display.nextAction).toContain("ソースセキュリティ保証");
		expect(display.nextAction).toContain("診断用DB");
	});

	it("prefers a specific runtime blocker over a generic target-plan failure", () => {
		const message = formatScanPreflightFailure({
			checks: [
				{
					required: true,
					status: "blocked",
					reasonCode: "target_start_plan_unavailable",
					action: "configure_target_start_plan",
				},
				{
					required: true,
					status: "blocked",
					reasonCode: "runtime_dependency_adapter_unqualified",
					action: "create_runtime_recipe",
				},
			],
			limitationCodes: [
				"runtime_dependency_adapter_unqualified",
				"target_start_plan_unavailable",
			],
		} as ScanPreflightResult);

		expect(message).toContain("Maven");
		expect(message).toContain("ソースセキュリティ保証");
		expect(message).toContain("runtime_dependency_adapter_unqualified");
		expect(message).not.toContain("target_start_plan_unavailable");
	});

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
		const message = formatScanPreflightFailure(result!);
		expect(message).toContain("スキャンを開始できませんでした");
		expect(message).toContain("脆弱性データが見つかりません");
		expect(message).toContain("スキャナーデータを準備または更新");
		expect(message).toContain("scanner_data_missing");
		expect(message).not.toContain("expected digest");
	});

	it("rejects a UI-only or malformed readiness guess", () => {
		expect(
			readScanPreflightDisplay({ scanPreflight: { status: "ready" } }),
		).toBeNull();
	});
});
