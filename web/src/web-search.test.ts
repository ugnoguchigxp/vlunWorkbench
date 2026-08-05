import { describe, expect, it } from "vitest";
import { parseLoginSearch } from "./routes/login-search";
import {
	defaultShowcaseTableSearch,
	isShowcaseSortField,
	parseShowcaseTableSearch,
} from "./showcase-table-search";

describe("login search", () => {
	it("accepts local redirects and rejects external or invalid values", () => {
		expect(parseLoginSearch({ redirect: "/protected" })).toEqual({
			redirect: "/protected",
		});
		expect(parseLoginSearch({ redirect: "//example.com" })).toEqual({
			redirect: undefined,
		});
		expect(parseLoginSearch({ redirect: "https://example.com" })).toEqual({
			redirect: undefined,
		});
		expect(parseLoginSearch({ redirect: 42 })).toEqual({
			redirect: undefined,
		});
	});
});

describe("showcase table search", () => {
	it("uses defaults for missing or invalid values", () => {
		expect(parseShowcaseTableSearch({})).toEqual({
			...defaultShowcaseTableSearch,
			sortBy: undefined,
			sortDir: undefined,
		});
		expect(
			parseShowcaseTableSearch({
				page: 0,
				pageSize: 12,
				sortBy: "unknown",
				sortDir: "sideways",
			}),
		).toEqual({
			...defaultShowcaseTableSearch,
			sortBy: undefined,
			sortDir: undefined,
		});
	});

	it("parses valid pagination and sorting values", () => {
		expect(
			parseShowcaseTableSearch({
				page: "3",
				pageSize: "20",
				sortBy: "category",
			}),
		).toEqual({
			page: 3,
			pageSize: 20,
			sortBy: "category",
			sortDir: "asc",
		});
		expect(
			parseShowcaseTableSearch({
				page: 2,
				pageSize: 50,
				sortBy: "status",
				sortDir: "desc",
			}),
		).toEqual({
			page: 2,
			pageSize: 50,
			sortBy: "status",
			sortDir: "desc",
		});
	});

	it("recognizes only supported sort fields", () => {
		expect(isShowcaseSortField("component")).toBe(true);
		expect(isShowcaseSortField("category")).toBe(true);
		expect(isShowcaseSortField("status")).toBe(true);
		expect(isShowcaseSortField("createdAt")).toBe(false);
		expect(isShowcaseSortField(null)).toBe(false);
	});
});
