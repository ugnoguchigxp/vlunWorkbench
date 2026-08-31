import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScanEvent, ScanProfile, ScanRun } from "../../../api";
import { ScanProgressPanel } from "./scan-progress-panel";

const scan: ScanRun = {
	id: "scan-1",
	projectId: "project-1",
	profile: "basic-security",
	status: "running",
	startedAt: "2026-08-21T08:04:00.000Z",
	completedAt: null,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: "2026-08-21T08:04:00.000Z",
	updatedAt: "2026-08-21T08:04:00.000Z",
};

const profile: ScanProfile = {
	id: "basic-security",
	name: "基本セキュリティスキャン",
	description: "basic",
	enabled: true,
	defaultTimeoutSec: 600,
	tools: [],
	steps: [
		{
			stepId: "trivy",
			kind: "static_tool",
			adapter: "trivy",
			displayName: "Trivy Filesystem Scanner",
			required: true,
			failurePolicy: "fail_profile",
		},
	],
};

const event: ScanEvent = {
	id: "event-1",
	scanRunId: "scan-1",
	seq: 1,
	level: "info",
	eventType: "scan.step.started",
	message: "started",
	createdAt: "2026-08-21T08:04:01.000Z",
	data: {
		schemaVersion: 1,
		stepId: "trivy",
		kind: "static_tool",
		adapter: "trivy",
		displayName: "Trivy Filesystem Scanner",
		position: 1,
		totalSteps: 1,
		required: true,
		planHash: "sha256:test",
	},
};

describe("ScanProgressPanel", () => {
	it("shows the current scanner purpose and lifecycle-derived state", () => {
		const markup = renderToStaticMarkup(
			<ScanProgressPanel scan={scan} profile={profile} events={[event]} />,
		);
		expect(markup).toContain('aria-label="スキャン進捗"');
		expect(markup).toContain("現在の工程内容");
		expect(markup).toContain("依存ライブラリ・OS パッケージの既知の脆弱性");
		expect(markup).toContain("実行中");
		expect(markup).toContain("実行前チェックと隔離環境の準備");
		expect(markup).toContain("結果の集計と完了処理");
	});

	it("keeps completed scan progress visible", () => {
		const markup = renderToStaticMarkup(
			<ScanProgressPanel
				scan={{ ...scan, status: "completed", completedAt: scan.createdAt }}
				profile={profile}
				events={[]}
			/>,
		);
		expect(markup).toContain('aria-label="スキャン進捗"');
		expect(markup).toContain("完了");
		expect(markup).toContain("スキャンの進捗");
	});

	it("explains the first planned scanner while the scan is queued", () => {
		const markup = renderToStaticMarkup(
			<ScanProgressPanel
				scan={{ ...scan, status: "queued", startedAt: null }}
				profile={profile}
				events={[]}
			/>,
		);
		expect(markup).toContain("次の工程内容");
		expect(markup).toContain("実行前チェックと隔離環境の準備");
		expect(markup).toContain("Trivy");
		expect(markup).toContain("Docker・スキャナーイメージ・隔離設定");
	});

	it("keeps preparation visible while scanner steps are being resolved", () => {
		const markup = renderToStaticMarkup(
			<ScanProgressPanel scan={scan} profile={null} events={[]} />,
		);
		expect(markup).toContain("終了した工程 0 / 2");
		expect(markup).toContain("実行前チェックと隔離環境の準備");
		expect(markup).toContain("実行計画を確定しています");
		expect(markup).not.toContain("工程情報を読み込み中です");
	});
});
