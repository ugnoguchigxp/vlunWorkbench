import { HttpError, fetchWithTimeout } from "../utils/httpClient";
import { load } from "cheerio";
import { JSDOM } from "jsdom";
import type {
	WebSearchOptions,
	WebSearchProvider,
	WebSearchResult,
} from "../providers/types";

export interface PageContent {
	url: string;
	title: string;
	cleanText: string;
	extractedAt: Date;
}

export interface WebSearchServiceOptions {
	maxContentLength?: number;
}

/**
 * Web 検索およびコンテンツ取得サービス
 */
export class WebSearchService {
	private readonly provider: WebSearchProvider;
	private readonly maxContentLength: number;

	constructor(
		provider: WebSearchProvider,
		options: WebSearchServiceOptions = {},
	) {
		this.provider = provider;
		this.maxContentLength = options.maxContentLength || 5000;
	}

	/**
	 * Web 検索を実行する
	 */
	async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
		return await this.provider.search(options);
	}

	/**
	 * 指定された URL のページコンテンツを取得・パースする
	 */
	async fetchPageContent(url: string): Promise<PageContent> {
		try {
			const response = await fetchWithTimeout(url, {
				timeout: 10000,
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; RegularRagBot/1.0)",
					Accept: "text/html,text/plain",
				},
			});

			const contentType = response.headers.get("content-type") || "";
			if (
				!contentType.includes("text/html") &&
				!contentType.includes("text/plain")
			) {
				throw new Error(`Unsupported content type: ${contentType}`);
			}

			const html = await response.text();
			const $ = load(html);
			const title = $("title").text().trim();

			// クリーンテキストの抽出（JSDOMを使用）
			const cleanText = this.extractCleanText(html, url);

			return {
				url,
				title,
				cleanText: this.truncateText(cleanText, this.maxContentLength),
				extractedAt: new Date(),
			};
		} catch (error) {
			if (error instanceof HttpError) {
				throw new Error(`Failed to fetch page: ${error.message}`);
			}
			throw error;
		}
	}

	/**
	 * HTML から不要な要素を除去し、テキストを抽出する
	 */
	private extractCleanText(html: string, url: string): string {
		try {
			const dom = new JSDOM(html, { url });
			const document = dom.window.document;

			// 不要な要素を削除
			const elementsToRemove = document.querySelectorAll(
				"script, style, nav, header, footer, aside, iframe, noscript",
			);
			for (const el of Array.from(elementsToRemove)) {
				el.remove();
			}

			// メインコンテンツ領域を優先的に取得
			const main =
				document.querySelector("main") ||
				document.querySelector("article") ||
				document.body;
			const text = main?.textContent || "";

			// 空白の正規化
			return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
		} catch (_error) {
			// JSDOM パース失敗時のフォールバック (cheerio を直接使用)
			const $ = load(html);
			$("script, style, nav, header, footer, aside, iframe, noscript").remove();
			return $("body").text().replace(/\s+/g, " ").trim();
		}
	}

	/**
	 * テキストを指定した長さで切り詰める
	 */
	private truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return `${text.substring(0, maxLength)}...`;
	}
}
