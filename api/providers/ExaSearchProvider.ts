import { HttpError, fetchJson } from "../utils/httpClient";
import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
import type {
	WebSearchOptions,
	WebSearchProvider,
	WebSearchResult,
} from "./types";

type ExaSearchResponse = {
	results?: Array<{
		title?: string;
		url?: string;
		text?: string;
		highlights?: string[];
		summary?: string;
	}>;
};

type ExaSearchProviderOptions = {
	baseUrl?: string;
	timeout?: number;
};

function compactSnippet(input?: string): string {
	const normalized = input?.replace(/\s+/g, " ").trim() ?? "";
	if (normalized.length <= 500) return normalized;
	return `${normalized.slice(0, 500)}...`;
}

/**
 * Exa Search API provider.
 */
export class ExaSearchProvider implements WebSearchProvider {
	readonly name = "exa";

	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly timeout: number;

	constructor(apiKey: string, options: ExaSearchProviderOptions = {}) {
		const trimmedApiKey = apiKey.trim();
		if (!trimmedApiKey) {
			throw new Error("EXA_API_KEY is required for ExaSearchProvider");
		}

		this.apiKey = trimmedApiKey;
		this.baseUrl = (
			options.baseUrl ?? APP_CONFIG_DEFAULTS.exaSearchBaseUrl
		).replace(/\/+$/, "");
		this.timeout = options.timeout ?? 10000;
	}

	static fromEnv(): ExaSearchProvider {
		const apiKey = process.env.EXA_API_KEY;
		if (!apiKey) {
			throw new Error("EXA_API_KEY environment variable is not set");
		}
		return new ExaSearchProvider(apiKey);
	}

	async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
		const { query, maxResults = 10, lang } = options;
		const body = {
			query,
			numResults: Math.min(Math.max(maxResults, 1), 100),
			type: "auto",
			...(lang === "ja" ? { userLocation: "JP" } : {}),
			contents: {
				highlights: true,
			},
		};

		try {
			const data = await fetchJson<ExaSearchResponse>(
				`${this.baseUrl}/search`,
				{
					method: "POST",
					timeout: this.timeout,
					headers: {
						"Content-Type": "application/json",
						"x-api-key": this.apiKey,
					},
					body: JSON.stringify(body),
				},
			);

			if (!Array.isArray(data.results)) {
				return [];
			}

			return data.results
				.filter((item) => item.url)
				.map((item, idx) => {
					const snippet =
						item.highlights?.find((highlight) => highlight.trim()) ??
						item.summary ??
						item.text ??
						"";
					return {
						title: item.title || item.url || "",
						url: item.url || "",
						snippet: compactSnippet(snippet),
						position: idx + 1,
					};
				});
		} catch (error) {
			if (error instanceof HttpError) {
				throw new Error(
					`Exa Search API error: ${error.status || "unknown"} ${error.message}`,
				);
			}
			throw error;
		}
	}
}
