import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import {
	showcaseDensityOptions,
	showcaseFontSizeOptions,
	showcaseRadiusOptions,
	showcaseThemeOptions,
	ShowcaseSettingsProvider,
	useShowcaseSettings,
} from "./showcase-settings-context";

const storageKey = "hono-standard.showcase.settings.v1";

function wrapper({ children }: { children: ReactNode }) {
	return <ShowcaseSettingsProvider>{children}</ShowcaseSettingsProvider>;
}

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-showcase-page-theme");
	document.documentElement.removeAttribute("style");
});

afterEach(() => {
	window.localStorage.clear();
	document.documentElement.removeAttribute("data-showcase-page-theme");
	document.documentElement.removeAttribute("style");
});

describe("ShowcaseSettingsProvider", () => {
	it("requires the provider", () => {
		expect(() => renderHook(() => useShowcaseSettings())).toThrow(
			"useShowcaseSettings must be used inside ShowcaseSettingsProvider",
		);
	});

	it("uses defaults, updates every option, persists values, and resets", () => {
		const { result } = renderHook(() => useShowcaseSettings(), { wrapper });

		expect(result.current.settings).toEqual({
			theme: "emerald",
			density: "comfortable",
			radius: "soft",
			fontSize: "medium",
		});
		expect(document.documentElement).toHaveAttribute(
			"data-showcase-page-theme",
			"emerald",
		);
		expect(document.documentElement.style.colorScheme).toBe("light");

		for (const option of showcaseThemeOptions) {
			act(() => result.current.setTheme(option.value));
			expect(result.current.settings.theme).toBe(option.value);
		}
		for (const option of showcaseDensityOptions) {
			act(() => result.current.setDensity(option.value));
			expect(result.current.settings.density).toBe(option.value);
		}
		for (const option of showcaseRadiusOptions) {
			act(() => result.current.setRadius(option.value));
			expect(result.current.settings.radius).toBe(option.value);
		}
		for (const option of showcaseFontSizeOptions) {
			act(() => result.current.setFontSize(option.value));
			expect(result.current.settings.fontSize).toBe(option.value);
		}

		expect(result.current.showcaseStyle["--showcase-accent"]).toBe("#39ff14");
		expect(result.current.showcaseStyle["--showcase-gap"]).toBe("22px");
		expect(result.current.showcaseStyle["--showcase-card-radius"]).toBe("8px");
		expect(result.current.showcaseStyle["--showcase-font-size"]).toBe("17px");
		expect(document.documentElement.style.colorScheme).toBe("dark");
		expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
			result.current.settings,
		);

		act(() => result.current.resetSettings());
		expect(result.current.settings).toEqual({
			theme: "emerald",
			density: "comfortable",
			radius: "soft",
			fontSize: "medium",
		});
	});

	it("restores valid stored settings", () => {
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				theme: "campfire",
				density: "compact",
				radius: "sharp",
				fontSize: "small",
			}),
		);

		const { result } = renderHook(() => useShowcaseSettings(), { wrapper });

		expect(result.current.settings).toEqual({
			theme: "campfire",
			density: "compact",
			radius: "sharp",
			fontSize: "small",
		});
	});

	it("falls back for malformed and unsupported stored settings", () => {
		window.localStorage.setItem(storageKey, "not-json");
		const malformed = renderHook(() => useShowcaseSettings(), { wrapper });
		expect(malformed.result.current.settings.theme).toBe("emerald");
		malformed.unmount();

		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				theme: "unknown",
				density: "unknown",
				radius: "unknown",
				fontSize: "unknown",
			}),
		);
		const unsupported = renderHook(() => useShowcaseSettings(), { wrapper });
		expect(unsupported.result.current.settings).toEqual({
			theme: "emerald",
			density: "comfortable",
			radius: "soft",
			fontSize: "medium",
		});
	});

	it("restores document theme variables after unmount", () => {
		const root = document.documentElement;
		root.style.setProperty("--showcase-accent", "rebeccapurple");
		root.style.colorScheme = "normal";
		root.setAttribute("data-showcase-page-theme", "existing");
		window.localStorage.setItem(
			storageKey,
			JSON.stringify({
				theme: "tokyo-night",
				density: "comfortable",
				radius: "round",
				fontSize: "large",
			}),
		);

		const { unmount } = renderHook(() => useShowcaseSettings(), { wrapper });
		expect(root.style.getPropertyValue("--showcase-accent")).toBe("#7aa2f7");
		expect(root.getAttribute("data-showcase-page-theme")).toBe("tokyo-night");

		unmount();
		expect(root.style.getPropertyValue("--showcase-accent")).toBe(
			"rebeccapurple",
		);
		expect(root.getAttribute("data-showcase-page-theme")).toBe("existing");
		expect(root.style.colorScheme).toBe("normal");
	});
});
