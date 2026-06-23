/**
 * HTTP クライアントユーティリティ (fetch API ベース)
 */

export class HttpError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly statusText?: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export interface FetchOptions extends RequestInit {
	timeout?: number;
	params?: Record<string, string | number>;
}

/**
 * タイムアウト付き fetch リクエスト
 */
export async function fetchWithTimeout(
	url: string,
	options: FetchOptions = {},
): Promise<Response> {
	const { timeout = 10000, params, ...fetchOptions } = options;

	// クエリパラメータの追加
	let finalUrl = url;
	if (params) {
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			searchParams.append(key, String(value));
		}
		finalUrl = `${url}?${searchParams.toString()}`;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	try {
		const response = await fetch(finalUrl, {
			...fetchOptions,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new HttpError(
				`HTTP error: ${response.status} ${response.statusText}`,
				response.status,
				response.statusText,
			);
		}

		return response;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new HttpError(`Request timeout after ${timeout}ms`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * JSON レスポンスを取得
 */
export async function fetchJson<T = unknown>(
	url: string,
	options: FetchOptions = {},
): Promise<T> {
	const response = await fetchWithTimeout(url, {
		...options,
		headers: {
			Accept: "application/json",
			...options.headers,
		},
	});

	return await response.json();
}
