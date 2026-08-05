type LoginSearch = {
	redirect?: string;
};

const isSafeRedirect = (value: unknown): value is string =>
	typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
	return {
		redirect: isSafeRedirect(search.redirect) ? search.redirect : undefined,
	};
}
