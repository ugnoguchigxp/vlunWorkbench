const STORAGE_KEY = "vuln-workbench.design-system.settings.v1";
const LEGACY_STORAGE_KEY = "hono-standard.showcase.settings.v1";

export type ShowcaseTheme =
	| "emerald"
	| "indigo"
	| "rose"
	| "amber"
	| "tokyo-night"
	| "campfire"
	| "terminal";
export type ShowcaseDensity = "compact" | "comfortable" | "spacious";
export type ShowcaseRadius = "sharp" | "soft" | "round";
export type ShowcaseFontSize = "small" | "medium" | "large";

export type ShowcaseSettings = {
	theme: ShowcaseTheme;
	density: ShowcaseDensity;
	radius: ShowcaseRadius;
	fontSize: ShowcaseFontSize;
};

export const defaultSettings: ShowcaseSettings = {
	theme: "emerald",
	density: "comfortable",
	radius: "soft",
	fontSize: "medium",
};

export const showcaseThemeOptions: Array<{
	value: ShowcaseTheme;
	label: string;
	swatch: string;
}> = [
	{ value: "emerald", label: "Emerald", swatch: "#1f7a6a" },
	{ value: "indigo", label: "Indigo", swatch: "#4f46e5" },
	{ value: "rose", label: "Rose", swatch: "#be3455" },
	{ value: "amber", label: "Amber", swatch: "#b7791f" },
	{ value: "tokyo-night", label: "Tokyo Night", swatch: "#7aa2f7" },
	{
		value: "campfire",
		label: "Campfire",
		swatch: "linear-gradient(135deg, #120d0a 0%, #f97316 100%)",
	},
	{ value: "terminal", label: "Terminal", swatch: "#39ff14" },
];

export const showcaseDensityOptions: Array<{
	value: ShowcaseDensity;
	label: string;
}> = [
	{ value: "compact", label: "Compact" },
	{ value: "comfortable", label: "Comfortable" },
	{ value: "spacious", label: "Spacious" },
];

export const showcaseRadiusOptions: Array<{
	value: ShowcaseRadius;
	label: string;
}> = [
	{ value: "sharp", label: "Sharp" },
	{ value: "soft", label: "Soft" },
	{ value: "round", label: "Round" },
];

export const showcaseFontSizeOptions: Array<{
	value: ShowcaseFontSize;
	label: string;
}> = [
	{ value: "small", label: "Small" },
	{ value: "medium", label: "Medium" },
	{ value: "large", label: "Large" },
];

export function persistShowcaseSettings(settings: ShowcaseSettings): void {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function readStoredSettings(): ShowcaseSettings {
	if (typeof window === "undefined") {
		return defaultSettings;
	}

	const rawSettings =
		window.localStorage.getItem(STORAGE_KEY) ??
		window.localStorage.getItem(LEGACY_STORAGE_KEY);
	if (!rawSettings) {
		return defaultSettings;
	}

	try {
		const parsed = JSON.parse(rawSettings) as Partial<ShowcaseSettings>;
		return {
			theme: isShowcaseTheme(parsed.theme)
				? parsed.theme
				: defaultSettings.theme,
			density: isShowcaseDensity(parsed.density)
				? parsed.density
				: defaultSettings.density,
			radius: isShowcaseRadius(parsed.radius)
				? parsed.radius
				: defaultSettings.radius,
			fontSize: isShowcaseFontSize(parsed.fontSize)
				? parsed.fontSize
				: defaultSettings.fontSize,
		};
	} catch {
		return defaultSettings;
	}
}

function isShowcaseTheme(value: unknown): value is ShowcaseTheme {
	return showcaseThemeOptions.some((option) => option.value === value);
}

function isShowcaseDensity(value: unknown): value is ShowcaseDensity {
	return showcaseDensityOptions.some((option) => option.value === value);
}

function isShowcaseRadius(value: unknown): value is ShowcaseRadius {
	return showcaseRadiusOptions.some((option) => option.value === value);
}

function isShowcaseFontSize(value: unknown): value is ShowcaseFontSize {
	return showcaseFontSizeOptions.some((option) => option.value === value);
}
