export const showcaseTableSortFields = [
	"component",
	"category",
	"status",
] as const;

export const showcaseTablePageSizes = [5, 10, 20, 50] as const;

export type ShowcaseTableSortField = (typeof showcaseTableSortFields)[number];
export type ShowcaseTableSortDirection = "asc" | "desc";

export type ShowcaseTableSearch = {
	page: number;
	pageSize: number;
	sortBy?: ShowcaseTableSortField;
	sortDir?: ShowcaseTableSortDirection;
};

export const defaultShowcaseTableSearch = {
	page: 1,
	pageSize: 10,
} satisfies ShowcaseTableSearch;

export function parseShowcaseTableSearch(
	search: Record<string, unknown>,
): ShowcaseTableSearch {
	const page = parsePositiveInteger(
		search.page,
		defaultShowcaseTableSearch.page,
	);
	const pageSize = isShowcasePageSize(search.pageSize)
		? Number(search.pageSize)
		: defaultShowcaseTableSearch.pageSize;
	const sortBy = isShowcaseSortField(search.sortBy) ? search.sortBy : undefined;
	const sortDir = isShowcaseSortDirection(search.sortDir)
		? search.sortDir
		: undefined;

	return {
		page,
		pageSize,
		sortBy,
		sortDir: sortBy ? (sortDir ?? "asc") : undefined,
	};
}

export function isShowcaseSortField(
	value: unknown,
): value is ShowcaseTableSortField {
	return showcaseTableSortFields.some((field) => field === value);
}

function isShowcasePageSize(value: unknown) {
	const parsed = Number(value);
	return showcaseTablePageSizes.some((pageSize) => pageSize === parsed);
}

function isShowcaseSortDirection(
	value: unknown,
): value is ShowcaseTableSortDirection {
	return value === "asc" || value === "desc";
}

function parsePositiveInteger(value: unknown, fallback: number) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		return fallback;
	}
	return parsed;
}
