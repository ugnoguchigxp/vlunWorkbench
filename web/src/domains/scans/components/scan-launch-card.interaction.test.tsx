// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScanProfile } from "../../../api";
import { ScanLaunchCard } from "./scan-launch-card";

const profiles: ScanProfile[] = [
	{
		id: "source-assurance",
		name: "ソースセキュリティ保証",
		description: "リポジトリ全体を確認します。",
		enabled: true,
		defaultTimeoutSec: 600,
		supportedTargets: ["full"],
		tools: [],
		steps: [],
		availability: "stable",
		safetyClass: "R0",
		experienceKind: "scanner_preset",
	},
];

describe("ScanLaunchCard profile help", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;

	beforeEach(async () => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				<ScanLaunchCard
					profiles={profiles}
					selectedProfileId="source-assurance"
					scanTargetKind="full"
					disabled={false}
					isScanning={false}
					onProfileChange={() => undefined}
					onTargetChange={() => undefined}
					onStart={() => undefined}
				/>,
			);
		});
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("opens and closes the complete scanner help dialog", async () => {
		const trigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="スキャンプロファイルと搭載スキャナーの説明を開く"]',
		);
		expect(trigger).not.toBeNull();

		await act(async () => trigger?.click());

		const dialog = document.body.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain(
			"搭載スキャナー・検証ツール（全10種）",
		);
		expect(dialog?.textContent).toContain("Semgrep");
		expect(dialog?.textContent).toContain("OWASP ZAP");
		expect(dialog?.textContent).toContain("Schemathesis");
		expect(dialog?.textContent).toContain("リポジトリ全体");

		const close = Array.from(
			dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
		).find((button) => button.textContent === "閉じる");
		await act(async () => close?.click());
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
	});
});
