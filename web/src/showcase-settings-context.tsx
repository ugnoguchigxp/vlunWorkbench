import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type CSSProperties,
	type ReactNode,
} from "react";

const STORAGE_KEY = "hono-standard.showcase.settings.v1";
const ROOT_THEME_ATTRIBUTE = "data-showcase-page-theme";

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

type ShowcaseStyle = CSSProperties & Record<`--${string}`, string>;

type ShowcaseSettingsContextValue = {
	settings: ShowcaseSettings;
	setTheme: (theme: ShowcaseTheme) => void;
	setDensity: (density: ShowcaseDensity) => void;
	setRadius: (radius: ShowcaseRadius) => void;
	setFontSize: (fontSize: ShowcaseFontSize) => void;
	resetSettings: () => void;
	showcaseStyle: ShowcaseStyle;
};

const defaultSettings: ShowcaseSettings = {
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

const themeTokens: Record<
	ShowcaseTheme,
	{
		accent: string;
		accentStrong: string;
		accentSoft: string;
		accentSurface: string;
		accentBorder: string;
		accentText: string;
		focusRing: string;
		page: string;
		surface: string;
		surfaceMuted: string;
		border: string;
		borderStrong: string;
		ink: string;
		muted: string;
		mutedStrong: string;
		onAccent: string;
		shadow: string;
		danger: string;
		dangerSurface: string;
		dangerBorder: string;
		skeleton: string;
		backdrop: string;
	}
> = {
	emerald: {
		accent: "#1f7a6a",
		accentStrong: "#176456",
		accentSoft: "#e6f5ef",
		accentSurface: "#f6fffb",
		accentBorder: "#a9cfc3",
		accentText: "#176456",
		focusRing: "rgba(31, 122, 106, 0.12)",
		page: "#f6f7f9",
		surface: "#ffffff",
		surfaceMuted: "#eef7f4",
		border: "#dde3ea",
		borderStrong: "#cbd7e2",
		ink: "#17202a",
		muted: "#52606f",
		mutedStrong: "#3b4754",
		onAccent: "#ffffff",
		shadow: "rgba(23, 32, 42, 0.08)",
		danger: "#9f1d1d",
		dangerSurface: "#fff1f1",
		dangerBorder: "#efb5b5",
		skeleton: "linear-gradient(90deg, #e8edf4, #f7f9fb, #e8edf4)",
		backdrop: "rgba(23, 32, 42, 0.4)",
	},
	indigo: {
		accent: "#4f46e5",
		accentStrong: "#3730a3",
		accentSoft: "#eef2ff",
		accentSurface: "#f8f9ff",
		accentBorder: "#c7d2fe",
		accentText: "#3730a3",
		focusRing: "rgba(79, 70, 229, 0.14)",
		page: "#f6f7f9",
		surface: "#ffffff",
		surfaceMuted: "#eef3f8",
		border: "#dde3ea",
		borderStrong: "#cbd7e2",
		ink: "#17202a",
		muted: "#52606f",
		mutedStrong: "#3b4754",
		onAccent: "#ffffff",
		shadow: "rgba(23, 32, 42, 0.08)",
		danger: "#9f1d1d",
		dangerSurface: "#fff1f1",
		dangerBorder: "#efb5b5",
		skeleton: "linear-gradient(90deg, #e8edf4, #f7f9fb, #e8edf4)",
		backdrop: "rgba(23, 32, 42, 0.4)",
	},
	rose: {
		accent: "#be3455",
		accentStrong: "#9f2544",
		accentSoft: "#fff1f4",
		accentSurface: "#fff8fa",
		accentBorder: "#f5b5c5",
		accentText: "#9f2544",
		focusRing: "rgba(190, 52, 85, 0.14)",
		page: "#f6f7f9",
		surface: "#ffffff",
		surfaceMuted: "#f7eef3",
		border: "#dde3ea",
		borderStrong: "#cbd7e2",
		ink: "#17202a",
		muted: "#52606f",
		mutedStrong: "#3b4754",
		onAccent: "#ffffff",
		shadow: "rgba(23, 32, 42, 0.08)",
		danger: "#9f1d1d",
		dangerSurface: "#fff1f1",
		dangerBorder: "#efb5b5",
		skeleton: "linear-gradient(90deg, #e8edf4, #f7f9fb, #e8edf4)",
		backdrop: "rgba(23, 32, 42, 0.4)",
	},
	amber: {
		accent: "#b7791f",
		accentStrong: "#8f5f18",
		accentSoft: "#fff7e8",
		accentSurface: "#fffaf0",
		accentBorder: "#f0d19b",
		accentText: "#7c5418",
		focusRing: "rgba(183, 121, 31, 0.16)",
		page: "#f6f7f9",
		surface: "#ffffff",
		surfaceMuted: "#f7f0e3",
		border: "#dde3ea",
		borderStrong: "#cbd7e2",
		ink: "#17202a",
		muted: "#52606f",
		mutedStrong: "#3b4754",
		onAccent: "#ffffff",
		shadow: "rgba(23, 32, 42, 0.08)",
		danger: "#9f1d1d",
		dangerSurface: "#fff1f1",
		dangerBorder: "#efb5b5",
		skeleton: "linear-gradient(90deg, #e8edf4, #f7f9fb, #e8edf4)",
		backdrop: "rgba(23, 32, 42, 0.4)",
	},
	"tokyo-night": {
		accent: "#7aa2f7",
		accentStrong: "#9eceff",
		accentSoft: "#1a2542",
		accentSurface: "#111a2f",
		accentBorder: "#2f4270",
		accentText: "#b4c9ff",
		focusRing: "rgba(122, 162, 247, 0.28)",
		page: "#0b1020",
		surface: "#111827",
		surfaceMuted: "#17213a",
		border: "#263452",
		borderStrong: "#3d527c",
		ink: "#d9e2ff",
		muted: "#9aa8c7",
		mutedStrong: "#c0caf5",
		onAccent: "#08111f",
		shadow: "rgba(0, 0, 0, 0.34)",
		danger: "#ff9e9e",
		dangerSurface: "#351b25",
		dangerBorder: "#733044",
		skeleton: "linear-gradient(90deg, #17213a, #233253, #17213a)",
		backdrop: "rgba(3, 7, 18, 0.72)",
	},
	campfire: {
		accent: "#f97316",
		accentStrong: "#fb923c",
		accentSoft: "#3a2013",
		accentSurface: "#1c130f",
		accentBorder: "#7c3c1c",
		accentText: "#fed7aa",
		focusRing: "rgba(249, 115, 22, 0.28)",
		page: "#100c0a",
		surface: "#19110d",
		surfaceMuted: "#26170f",
		border: "#3b2619",
		borderStrong: "#8a4a24",
		ink: "#fff3e4",
		muted: "#c9a98f",
		mutedStrong: "#f4c899",
		onAccent: "#160a03",
		shadow: "rgba(0, 0, 0, 0.38)",
		danger: "#fca5a5",
		dangerSurface: "#361818",
		dangerBorder: "#7f2d2d",
		skeleton: "linear-gradient(90deg, #26170f, #3a2013, #26170f)",
		backdrop: "rgba(9, 5, 3, 0.74)",
	},
	terminal: {
		accent: "#39ff14",
		accentStrong: "#7cff5f",
		accentSoft: "#0d2f13",
		accentSurface: "#061608",
		accentBorder: "#1d7a2a",
		accentText: "#b9ffad",
		focusRing: "rgba(57, 255, 20, 0.28)",
		page: "#030703",
		surface: "#071107",
		surfaceMuted: "#0b1f0c",
		border: "#163a17",
		borderStrong: "#2f8a31",
		ink: "#d9ffd4",
		muted: "#82b879",
		mutedStrong: "#b2f5a5",
		onAccent: "#021802",
		shadow: "rgba(0, 0, 0, 0.46)",
		danger: "#ff6b6b",
		dangerSurface: "#2b1010",
		dangerBorder: "#7a2727",
		skeleton: "linear-gradient(90deg, #0b1f0c, #123a15, #0b1f0c)",
		backdrop: "rgba(0, 6, 0, 0.78)",
	},
};

const densityTokens: Record<
	ShowcaseDensity,
	{
		gap: string;
		gapTight: string;
		gapLoose: string;
		sectionGap: string;
		cardPadding: string;
		controlHeight: string;
		inputHeight: string;
		tablePadding: string;
	}
> = {
	compact: {
		gap: "10px",
		gapTight: "7px",
		gapLoose: "20px",
		sectionGap: "12px",
		cardPadding: "14px",
		controlHeight: "34px",
		inputHeight: "36px",
		tablePadding: "9px 11px",
	},
	comfortable: {
		gap: "16px",
		gapTight: "10px",
		gapLoose: "32px",
		sectionGap: "16px",
		cardPadding: "20px",
		controlHeight: "38px",
		inputHeight: "40px",
		tablePadding: "12px 14px",
	},
	spacious: {
		gap: "22px",
		gapTight: "14px",
		gapLoose: "44px",
		sectionGap: "22px",
		cardPadding: "24px",
		controlHeight: "44px",
		inputHeight: "46px",
		tablePadding: "15px 18px",
	},
};

const radiusTokens: Record<
	ShowcaseRadius,
	{
		controlRadius: string;
		cardRadius: string;
		panelRadius: string;
	}
> = {
	sharp: {
		controlRadius: "3px",
		cardRadius: "4px",
		panelRadius: "4px",
	},
	soft: {
		controlRadius: "8px",
		cardRadius: "8px",
		panelRadius: "8px",
	},
	round: {
		controlRadius: "8px",
		cardRadius: "8px",
		panelRadius: "8px",
	},
};

const fontSizeTokens: Record<
	ShowcaseFontSize,
	{
		base: string;
		small: string;
		heading: string;
		cardTitle: string;
	}
> = {
	small: {
		base: "14px",
		small: "12px",
		heading: "22px",
		cardTitle: "17px",
	},
	medium: {
		base: "16px",
		small: "13px",
		heading: "24px",
		cardTitle: "18px",
	},
	large: {
		base: "17px",
		small: "14px",
		heading: "27px",
		cardTitle: "20px",
	},
};

const ShowcaseSettingsContext =
	createContext<ShowcaseSettingsContextValue | null>(null);

export function ShowcaseSettingsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [settings, setSettings] =
		useState<ShowcaseSettings>(readStoredSettings);

	useEffect(() => {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	}, [settings]);

	const showcaseStyle = useMemo(() => getShowcaseStyle(settings), [settings]);

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
		root.setAttribute(ROOT_THEME_ATTRIBUTE, settings.theme);
		root.style.colorScheme = isDarkShowcaseTheme(settings.theme)
			? "dark"
			: "light";

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
	}, [settings.theme, showcaseStyle]);

	const value = useMemo<ShowcaseSettingsContextValue>(
		() => ({
			settings,
			setTheme: (theme) =>
				setSettings((current) => ({
					...current,
					theme,
				})),
			setDensity: (density) =>
				setSettings((current) => ({
					...current,
					density,
				})),
			setRadius: (radius) =>
				setSettings((current) => ({
					...current,
					radius,
				})),
			setFontSize: (fontSize) =>
				setSettings((current) => ({
					...current,
					fontSize,
				})),
			resetSettings: () => setSettings(defaultSettings),
			showcaseStyle,
		}),
		[settings, showcaseStyle],
	);

	return (
		<ShowcaseSettingsContext.Provider value={value}>
			{children}
		</ShowcaseSettingsContext.Provider>
	);
}

export function useShowcaseSettings() {
	const context = useContext(ShowcaseSettingsContext);
	if (!context) {
		throw new Error(
			"useShowcaseSettings must be used inside ShowcaseSettingsProvider",
		);
	}
	return context;
}

function readStoredSettings(): ShowcaseSettings {
	if (typeof window === "undefined") {
		return defaultSettings;
	}

	const rawSettings = window.localStorage.getItem(STORAGE_KEY);
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

function getShowcaseStyle(settings: ShowcaseSettings): ShowcaseStyle {
	const theme = themeTokens[settings.theme];
	const density = densityTokens[settings.density];
	const radius = radiusTokens[settings.radius];
	const fontSize = fontSizeTokens[settings.fontSize];

	return {
		"--showcase-accent": theme.accent,
		"--showcase-accent-strong": theme.accentStrong,
		"--showcase-accent-soft": theme.accentSoft,
		"--showcase-accent-surface": theme.accentSurface,
		"--showcase-accent-border": theme.accentBorder,
		"--showcase-accent-text": theme.accentText,
		"--showcase-focus-ring": theme.focusRing,
		"--showcase-page": theme.page,
		"--showcase-surface": theme.surface,
		"--showcase-surface-muted": theme.surfaceMuted,
		"--showcase-border": theme.border,
		"--showcase-border-strong": theme.borderStrong,
		"--showcase-ink": theme.ink,
		"--showcase-muted": theme.muted,
		"--showcase-muted-strong": theme.mutedStrong,
		"--showcase-on-accent": theme.onAccent,
		"--showcase-shadow": theme.shadow,
		"--showcase-danger": theme.danger,
		"--showcase-danger-surface": theme.dangerSurface,
		"--showcase-danger-border": theme.dangerBorder,
		"--showcase-skeleton": theme.skeleton,
		"--showcase-backdrop": theme.backdrop,
		"--showcase-gap": density.gap,
		"--showcase-gap-tight": density.gapTight,
		"--showcase-gap-loose": density.gapLoose,
		"--showcase-section-gap": density.sectionGap,
		"--showcase-card-padding": density.cardPadding,
		"--showcase-control-height": density.controlHeight,
		"--showcase-input-height": density.inputHeight,
		"--showcase-table-padding": density.tablePadding,
		"--showcase-control-radius": radius.controlRadius,
		"--showcase-card-radius": radius.cardRadius,
		"--showcase-panel-radius": radius.panelRadius,
		"--showcase-font-size": fontSize.base,
		"--showcase-font-size-small": fontSize.small,
		"--showcase-heading-size": fontSize.heading,
		"--showcase-card-title-size": fontSize.cardTitle,
	};
}

function isShowcaseTheme(value: unknown): value is ShowcaseTheme {
	return showcaseThemeOptions.some((option) => option.value === value);
}

function isDarkShowcaseTheme(theme: ShowcaseTheme) {
	return (
		theme === "tokyo-night" || theme === "campfire" || theme === "terminal"
	);
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
