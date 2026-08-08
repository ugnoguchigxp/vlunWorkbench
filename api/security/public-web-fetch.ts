import type {
	AddressLookup,
	OutboundUrlPolicyError,
} from "./outbound-url-policy";
import { fetchWithOutboundPolicy } from "./outbound-url-policy";

export type PublicWebFetchOptions = RequestInit & {
	timeoutMs?: number;
	lookup?: AddressLookup;
	fetchImpl?: typeof fetch;
	maxRedirects?: number;
};

export async function fetchPublicWebResource(
	url: string,
	options: PublicWebFetchOptions = {},
): Promise<Response> {
	const {
		timeoutMs = 15_000,
		lookup,
		fetchImpl,
		maxRedirects,
		...init
	} = options;
	const timeoutController = new AbortController();
	const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
	const signal = init.signal
		? AbortSignal.any([init.signal, timeoutController.signal])
		: timeoutController.signal;

	try {
		return await fetchWithOutboundPolicy({
			url,
			init: { ...init, signal },
			policy: {
				kind: "public-web",
				nodeEnv: "production",
				lookup,
			},
			fetchImpl,
			maxRedirects,
		});
	} finally {
		clearTimeout(timeoutId);
	}
}

export function isPublicWebPolicyError(
	error: unknown,
): error is OutboundUrlPolicyError {
	return (
		error instanceof Error &&
		error.name === "OutboundUrlPolicyError" &&
		"code" in error
	);
}
