export const settingsSectionIds = [
	"overview",
	"ai-models",
	"task-routing",
	"scan-execution",
	"system-context",
	"security",
	"advanced",
] as const;

export type SettingsSectionId = (typeof settingsSectionIds)[number];
export type SettingsSearch = {
	section?: Exclude<SettingsSectionId, "overview">;
};

const nonOverviewSections = new Set<SettingsSearch["section"]>([
	"ai-models",
	"task-routing",
	"scan-execution",
	"system-context",
	"security",
	"advanced",
]);

export function parseSettingsSearch(
	search: Record<string, unknown>,
): SettingsSearch {
	return typeof search.section === "string" &&
		nonOverviewSections.has(search.section as SettingsSearch["section"])
		? { section: search.section as SettingsSearch["section"] }
		: {};
}

export const resolveSettingsSection = (
	search: SettingsSearch,
): SettingsSectionId => search.section ?? "overview";

export const buildSettingsSectionSearch = (
	section: SettingsSectionId,
): SettingsSearch => (section === "overview" ? {} : { section });
