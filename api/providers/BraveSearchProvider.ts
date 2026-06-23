import { HttpError, fetchJson } from "../utils/httpClient";
import type {
	WebSearchOptions,
	WebSearchProvider,
	WebSearchResult,
} from "./types";

type BraveSearchResponse = {
	web?: {
		results?: Array<{
			title?: string;
			url?: string;
			description?: string;
			snippet?: string;
		}>;
	};
};

/**
 * Brave Search API プロバイダー
 */
export class BraveSearchProvider implements WebSearchProvider {
	readonly name = "brave";

	private readonly baseURL = "https://api.search.brave.com/res/v1";
	private readonly apiKey: string;
	private readonly timeout = 10000;

	constructor(apiKey: string) {
		if (!apiKey) {
			throw new Error(
				"BRAVE_SEARCH_API_KEY is required for BraveSearchProvider",
			);
		}

		this.apiKey = apiKey;
	}

	/**
	 * 環境変数から BraveSearchProvider を作成する
	 */
	static fromEnv(): BraveSearchProvider {
		const apiKey = process.env.BRAVE_SEARCH_API_KEY;
		if (!apiKey) {
			throw new Error("BRAVE_SEARCH_API_KEY environment variable is not set");
		}
		return new BraveSearchProvider(apiKey);
	}

	/**
	 * Web 検索を実行する
	 */
	async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
		const { query, maxResults = 10 } = options;

		const params = {
			q: query,
			count: String(maxResults),
			safesearch: "off",
			country: "jp",
			source: "web",
		};

		try {
			const data = await fetchJson<BraveSearchResponse>(
				`${this.baseURL}/web/search`,
				{
					params,
					timeout: this.timeout,
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "gzip, deflate",
						"X-Subscription-Token": this.apiKey,
					},
				},
			);

			if (!data.web || !Array.isArray(data.web.results)) {
				return [];
			}

			return data.web.results.map((item, idx: number) => ({
				title: item.title || "",
				url: item.url || "",
				snippet: item.description || item.snippet || "",
				position: idx + 1,
			}));
		} catch (error) {
			if (error instanceof HttpError) {
				throw new Error(
					`Brave Search API error: ${error.status || "unknown"} ${error.message}`,
				);
			}
			throw error;
		}
	}
}
