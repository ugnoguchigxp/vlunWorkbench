import { useEffect } from "react";
import type { ShowcaseStyle } from "./showcase-settings-context";
import type { ShowcaseTheme } from "./showcase-settings-model";

const ROOT_THEME_ATTRIBUTE = "data-design-system-theme";

export function useShowcaseRootStyle(
	theme: ShowcaseTheme,
	showcaseStyle: ShowcaseStyle,
): void {
	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}

		const root = document.documentElement;
		const previousVariables = new Map(
			Object.keys(showcaseStyle).map((name) => [
				name,
				root.style.getPropertyValue(name),
			]),
		);
		const previousTheme = root.getAttribute(ROOT_THEME_ATTRIBUTE);
		const previousColorScheme = root.style.colorScheme;

		for (const [name, value] of Object.entries(showcaseStyle)) {
			root.style.setProperty(name, value);
		}
		root.setAttribute(ROOT_THEME_ATTRIBUTE, theme);
		root.style.colorScheme = isDarkShowcaseTheme(theme) ? "dark" : "light";

		return () => {
			for (const [name, value] of previousVariables) {
				if (value) {
					root.style.setProperty(name, value);
				} else {
					root.style.removeProperty(name);
				}
			}

			if (previousTheme) {
				root.setAttribute(ROOT_THEME_ATTRIBUTE, previousTheme);
			} else {
				root.removeAttribute(ROOT_THEME_ATTRIBUTE);
			}
			root.style.colorScheme = previousColorScheme;
		};
	}, [theme, showcaseStyle]);
}

function isDarkShowcaseTheme(theme: ShowcaseTheme): boolean {
	return (
		theme === "tokyo-night" || theme === "campfire" || theme === "terminal"
	);
}
