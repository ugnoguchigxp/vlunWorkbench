import { load } from "cheerio";
import { z } from "zod";
import { fetchWithTimeout } from "../../../utils/httpClient";
import { clampText, isSafeHttpUrl, normalizeWhitespace } from "../utils";
import type { AgenticToolDefinition } from "./types";

const FetchArgsSchema = z.object({
	url: z.string().trim().min(1),
	maxChars: z.number().int().min(200).max(50000).optional(),
});

export const fetchTool: AgenticToolDefinition = {
	name: "fetch",
	description:
		"Fetch a web page and return a cleaned text excerpt for evidence extraction.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			url: { type: "string", minLength: 1 },
			maxChars: { type: "integer", minimum: 200, maximum: 50000 },
		},
		required: ["url"],
	},
	async execute(rawArgs, _deps, runtime) {
		const args = FetchArgsSchema.parse(rawArgs);
		if (!isSafeHttpUrl(args.url)) {
			return {
				output: {
					url: args.url,
					fetched: false,
					message: "URL is not allowed for fetch.",
				},
				resultCount: 0,
			};
		}

		const response = await fetchWithTimeout(args.url, {
			timeout: 15000,
			headers: {
				"User-Agent": "vuln-workbench-agentic-search/1.0",
				Accept: "text/html, text/plain;q=0.9",
			},
		});
		const contentType = response.headers.get("content-type") || "";
		const rawBody = await response.text();
		let title = args.url;
		let text = rawBody;

		if (contentType.includes("text/html")) {
			const $ = load(rawBody);
			$("script,style,noscript,header,footer,nav,aside,iframe,svg").remove();
			title = normalizeWhitespace($("title").first().text()) || args.url;
			text = normalizeWhitespace(
				$("main").text() || $("article").text() || $("body").text(),
			);
		} else {
			text = normalizeWhitespace(rawBody);
		}

		const maxChars = Math.min(
			args.maxChars ?? runtime.maxContextChars,
			runtime.maxContextChars,
		);
		const trimmed = clampText(text, maxChars);
		return {
			output: {
				url: args.url,
				title,
				contentType,
				text: trimmed,
				textLength: text.length,
				truncated: text.length > trimmed.length,
				fetched: true,
			},
			resultCount: trimmed.length > 0 ? 1 : 0,
			citations: [
				{
					kind: "web_page",
					title,
					url: args.url,
				},
			],
		};
	},
};
