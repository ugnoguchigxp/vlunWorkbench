import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanLaunchCard } from "./scan-launch-card";

function render(isScanning: boolean) {
	return renderToStaticMarkup(
		createElement(ScanLaunchCard, {
			profiles: [],
			selectedProfileId: "baseline",
			scanTargetKind: "full",
			disabled: false,
			isScanning,
			onProfileChange: () => undefined,
			onTargetChange: () => undefined,
			onStart: () => undefined,
		}),
	);
}

describe("ScanLaunchCard", () => {
	it("disables the start button and labels it as scanning while active", () => {
		const markup = render(true);

		expect(markup).toContain("<button");
		expect(markup).toContain("disabled");
		expect(markup).toContain("スキャン中");
		expect(markup).not.toContain("スキャンを開始</button>");
	});

	it("restores the start action after scanning finishes", () => {
		const markup = render(false);

		expect(markup).toContain("スキャンを開始");
		expect(markup).not.toContain("スキャン中");
	});

	it("shows an accessible help action beside the profile selector", () => {
		const markup = render(false);

		expect(markup).toContain(
			'aria-label="スキャンプロファイルと搭載スキャナーの説明を開く"',
		);
	});
});
