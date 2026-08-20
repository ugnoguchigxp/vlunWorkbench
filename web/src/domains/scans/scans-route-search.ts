export const scanWorkspaceTabs = [
	"overview",
	"findings",
	"coverage",
	"report",
	"history",
] as const;

export type ScanWorkspaceTab = (typeof scanWorkspaceTabs)[number];

export type ScanWorkspaceSearch = {
	projectId?: string;
	scanRunId?: string;
	tab?: ScanWorkspaceTab;
	findingId?: string;
	reportId?: string;
};

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

export const parseOptionalScanWorkspaceTab = (
	value: unknown,
): ScanWorkspaceTab | undefined =>
	typeof value === "string" &&
	(scanWorkspaceTabs as readonly string[]).includes(value)
		? (value as ScanWorkspaceTab)
		: undefined;

/** Parses untrusted TanStack Router search input without coercing identifiers. */
export const parseScansSearch = (
	search: Record<string, unknown>,
): ScanWorkspaceSearch =>
	normalizeScansSearch({
		...(isNonEmptyString(search.projectId)
			? { projectId: search.projectId }
			: {}),
		...(isNonEmptyString(search.scanRunId)
			? { scanRunId: search.scanRunId }
			: {}),
		...(parseOptionalScanWorkspaceTab(search.tab)
			? { tab: parseOptionalScanWorkspaceTab(search.tab) }
			: {}),
		...(isNonEmptyString(search.findingId)
			? { findingId: search.findingId }
			: {}),
		...(isNonEmptyString(search.reportId) ? { reportId: search.reportId } : {}),
	});

/**
 * Produces the canonical URL form. Finding and report identifiers never leak
 * into a different tab, so shared links cannot reopen stale detail panels.
 */
export const normalizeScansSearch = (
	search: ScanWorkspaceSearch,
): ScanWorkspaceSearch => {
	const tab = search.tab ?? "overview";
	const base: ScanWorkspaceSearch = {
		...(search.projectId ? { projectId: search.projectId } : {}),
		...(search.scanRunId ? { scanRunId: search.scanRunId } : {}),
		...(tab === "overview" ? {} : { tab }),
	};
	if (tab === "findings" && search.findingId) {
		return { ...base, findingId: search.findingId };
	}
	if (tab === "report" && search.reportId) {
		return { ...base, reportId: search.reportId };
	}
	return base;
};
