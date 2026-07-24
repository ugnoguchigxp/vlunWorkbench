import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export type OutboundProviderKind =
	| "azure"
	| "openai"
	| "openai-compatible"
	| "local";

export type OutboundUrlPolicyErrorCode =
	| "OUTBOUND_URL_INVALID"
	| "OUTBOUND_URL_SCHEME_NOT_ALLOWED"
	| "OUTBOUND_URL_CREDENTIALS_NOT_ALLOWED"
	| "OUTBOUND_URL_FRAGMENT_NOT_ALLOWED"
	| "OUTBOUND_HOST_NOT_ALLOWED"
	| "OUTBOUND_ADDRESS_NOT_ALLOWED"
	| "OUTBOUND_DNS_FAILED"
	| "OUTBOUND_RESPONSE_TOO_LARGE"
	| "OUTBOUND_REDIRECT_LIMIT";

export class OutboundUrlPolicyError extends Error {
	constructor(
		readonly code: OutboundUrlPolicyErrorCode,
		message: string,
	) {
		super(message);
		this.name = "OutboundUrlPolicyError";
	}
}

export type AddressLookup = (
	hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export type OutboundUrlPolicy = {
	kind: OutboundProviderKind;
	nodeEnv: "development" | "test" | "production";
	allowedHosts?: readonly string[];
	lookup?: AddressLookup;
};

const normalizeHost = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");

const forbiddenIpv6Ranges = new BlockList();
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	forbiddenIpv6Ranges.addSubnet(network, prefix, "ipv6");
}

function parseIpv4(address: string): number[] | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const bytes = parts.map((part) => Number(part));
	return bytes.every(
		(byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
	)
		? bytes
		: null;
}

function isForbiddenIpv4(address: string): boolean {
	const bytes = parseIpv4(address);
	if (!bytes) return true;
	const [a, b] = bytes;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && bytes[2] === 2) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && bytes[2] === 100) ||
		(a === 203 && b === 0 && bytes[2] === 113) ||
		a >= 224
	);
}

function mappedIpv4(address: string): string | null {
	const normalized = address.toLowerCase();
	const match = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return match?.[1] ?? null;
}

function isForbiddenAddress(address: string): boolean {
	const mapped = mappedIpv4(address);
	if (mapped) return isForbiddenIpv4(mapped);
	const family = isIP(address);
	if (family === 4) return isForbiddenIpv4(address);
	if (family !== 6) return true;
	const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
	return forbiddenIpv6Ranges.check(normalized, "ipv6");
}

function isLoopbackAddress(address: string): boolean {
	const mapped = mappedIpv4(address);
	if (mapped) return mapped.startsWith("127.");
	if (isIP(address) === 4) return address.startsWith("127.");
	return address.toLowerCase().replace(/^\[|\]$/g, "") === "::1";
}

function parseUrl(rawUrl: string): URL {
	try {
		return new URL(rawUrl);
	} catch {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_URL_INVALID",
			"Provider URL is invalid.",
		);
	}
}

export function validateOutboundUrlSyntax(
	rawUrl: string,
	policy: Omit<OutboundUrlPolicy, "lookup">,
): URL {
	const url = parseUrl(rawUrl);
	if (url.username || url.password) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_URL_CREDENTIALS_NOT_ALLOWED",
			"Provider URL must not include user information.",
		);
	}
	if (url.hash) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_URL_FRAGMENT_NOT_ALLOWED",
			"Provider URL must not include a fragment.",
		);
	}
	const host = normalizeHost(url.hostname);
	const allowedHosts = new Set(
		(policy.allowedHosts ?? []).map(normalizeHost).filter(Boolean),
	);

	if (policy.kind === "local") {
		if (!["http:", "https:"].includes(url.protocol)) {
			throw new OutboundUrlPolicyError(
				"OUTBOUND_URL_SCHEME_NOT_ALLOWED",
				"Local provider URLs must use HTTP or HTTPS.",
			);
		}
		if (
			host !== "localhost" &&
			host !== "127.0.0.1" &&
			host !== "::1" &&
			host !== "[::1]"
		) {
			throw new OutboundUrlPolicyError(
				"OUTBOUND_HOST_NOT_ALLOWED",
				"Local providers must use a loopback host.",
			);
		}
		return url;
	}

	if (url.protocol !== "https:") {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_URL_SCHEME_NOT_ALLOWED",
			"Remote provider URLs must use HTTPS.",
		);
	}
	if (policy.kind === "openai" && host !== "api.openai.com") {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_HOST_NOT_ALLOWED",
			"OpenAI providers must use api.openai.com.",
		);
	}
	if (
		(policy.kind === "azure" || policy.kind === "openai-compatible") &&
		!allowedHosts.has(host)
	) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_HOST_NOT_ALLOWED",
			"Provider host is not in LLM_PROVIDER_ALLOWED_HOSTS.",
		);
	}
	return url;
}

async function resolveOutboundUrl(
	rawUrl: string,
	policy: OutboundUrlPolicy,
): Promise<{
	url: URL;
	addresses: Array<{ address: string; family: number }>;
}> {
	const url = validateOutboundUrlSyntax(rawUrl, policy);
	const lookup =
		policy.lookup ??
		(async (hostname: string) => {
			return await dnsLookup(hostname, { all: true, verbatim: true });
		});
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(normalizeHost(url.hostname));
	} catch {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_DNS_FAILED",
			"Provider hostname could not be resolved.",
		);
	}
	if (addresses.length === 0) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_DNS_FAILED",
			"Provider hostname resolved to no addresses.",
		);
	}
	const invalidAddress =
		policy.kind === "local"
			? addresses.some((entry) => !isLoopbackAddress(entry.address))
			: addresses.some((entry) => isForbiddenAddress(entry.address));
	if (invalidAddress) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_ADDRESS_NOT_ALLOWED",
			"Provider hostname resolves to a disallowed address range.",
		);
	}
	return { url, addresses };
}

export async function validateOutboundUrl(
	rawUrl: string,
	policy: OutboundUrlPolicy,
): Promise<URL> {
	return (await resolveOutboundUrl(rawUrl, policy)).url;
}

async function fetchPinnedToValidatedAddress(
	url: string,
	init: RequestInit,
	addresses: Array<{ address: string; family: number }>,
): Promise<Response> {
	const selected = addresses[0];
	if (!selected) {
		throw new OutboundUrlPolicyError(
			"OUTBOUND_DNS_FAILED",
			"Provider hostname resolved to no addresses.",
		);
	}
	const target = new URL(url);
	const requestBody = await requestBodyBytes(init.body);
	const response = await new Promise<Response>((resolve, reject) => {
		const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
		const headers = Object.fromEntries(new Headers(init.headers).entries());
		const request = requestFn(
			target,
			{
				method: init.method ?? "GET",
				headers,
				lookup: (_hostname, _options, callback) => {
					callback(null, selected.address, selected.family === 6 ? 6 : 4);
				},
				signal: init.signal ?? undefined,
			},
			(incoming) => {
				const chunks: Uint8Array[] = [];
				let receivedBytes = 0;
				incoming.on("data", (chunk: Uint8Array) => {
					receivedBytes += chunk.byteLength;
					if (receivedBytes > MAX_OUTBOUND_RESPONSE_BYTES) {
						incoming.destroy(
							new OutboundUrlPolicyError(
								"OUTBOUND_RESPONSE_TOO_LARGE",
								"Provider response exceeded the allowed size.",
							),
						);
						return;
					}
					chunks.push(chunk);
				});
				incoming.on("error", reject);
				incoming.on("end", () => {
					const body = new Uint8Array(receivedBytes);
					let offset = 0;
					for (const chunk of chunks) {
						body.set(chunk, offset);
						offset += chunk.byteLength;
					}
					const responseHeaders = new Headers();
					for (const [name, value] of Object.entries(incoming.headers)) {
						if (Array.isArray(value)) {
							for (const item of value) responseHeaders.append(name, item);
						} else if (value !== undefined) {
							responseHeaders.set(name, value);
						}
					}
					const status = incoming.statusCode ?? 500;
					resolve(
						new Response(BODYLESS_RESPONSE_STATUSES.has(status) ? null : body, {
							status,
							statusText: incoming.statusMessage,
							headers: responseHeaders,
						}),
					);
				});
			},
		);
		request.on("error", reject);
		if (requestBody) request.write(requestBody);
		request.end();
	});
	return await bufferOutboundResponse(response);
}

async function requestBodyBytes(
	body: RequestInit["body"],
): Promise<Uint8Array | undefined> {
	if (body === null || body === undefined) return undefined;
	if (typeof body === "string") return new TextEncoder().encode(body);
	if (body instanceof URLSearchParams) {
		return new TextEncoder().encode(body.toString());
	}
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	}
	if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
	throw new OutboundUrlPolicyError(
		"OUTBOUND_URL_INVALID",
		"Provider request body type is not supported.",
	);
}

const MAX_OUTBOUND_RESPONSE_BYTES = 16 * 1024 * 1024;
const BODYLESS_RESPONSE_STATUSES = new Set([101, 204, 205, 304]);

export async function bufferOutboundResponse(
	response: Response,
): Promise<Response> {
	const declaredLength = Number(response.headers.get("content-length") ?? "0");
	if (
		Number.isFinite(declaredLength) &&
		declaredLength > MAX_OUTBOUND_RESPONSE_BYTES
	) {
		await response.body?.cancel();
		throw new OutboundUrlPolicyError(
			"OUTBOUND_RESPONSE_TOO_LARGE",
			"Provider response exceeded the allowed size.",
		);
	}

	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;
	const reader = response.body?.getReader();
	if (reader) {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				receivedBytes += value.byteLength;
				if (receivedBytes > MAX_OUTBOUND_RESPONSE_BYTES) {
					await reader.cancel();
					throw new OutboundUrlPolicyError(
						"OUTBOUND_RESPONSE_TOO_LARGE",
						"Provider response exceeded the allowed size.",
					);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
	}

	const body =
		BODYLESS_RESPONSE_STATUSES.has(response.status) || receivedBytes === 0
			? null
			: (() => {
					const joined = new Uint8Array(receivedBytes);
					let offset = 0;
					for (const chunk of chunks) {
						joined.set(chunk, offset);
						offset += chunk.byteLength;
					}
					return joined;
				})();
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: [...response.headers.entries()],
	});
}

export async function fetchWithOutboundPolicy(params: {
	url: string;
	init: RequestInit;
	policy: OutboundUrlPolicy;
	fetchImpl?: typeof fetch;
	maxRedirects?: number;
}): Promise<Response> {
	let url = params.url;
	let init = { ...params.init, redirect: "manual" as const };
	const maxRedirects = params.maxRedirects ?? 3;
	let credentialBoundaryOrigin: string | undefined;
	for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
		const resolved = await resolveOutboundUrl(url, params.policy);
		const resolvedOrigin = resolved.url.origin;
		credentialBoundaryOrigin ??= resolvedOrigin;
		if (resolvedOrigin !== credentialBoundaryOrigin) {
			throw new OutboundUrlPolicyError(
				"OUTBOUND_HOST_NOT_ALLOWED",
				"Provider redirects must remain on the configured origin.",
			);
		}
		const response = params.fetchImpl
			? await bufferOutboundResponse(await params.fetchImpl(url, init))
			: await fetchPinnedToValidatedAddress(url, init, resolved.addresses);
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;
		if (redirectCount === maxRedirects) {
			throw new OutboundUrlPolicyError(
				"OUTBOUND_REDIRECT_LIMIT",
				"Provider redirect limit exceeded.",
			);
		}
		const location = response.headers.get("location");
		if (!location) return response;
		url = new URL(location, url).toString();
		if (response.status === 303) {
			init = { ...init, method: "GET", body: undefined };
		}
	}
	throw new OutboundUrlPolicyError(
		"OUTBOUND_REDIRECT_LIMIT",
		"Provider redirect limit exceeded.",
	);
}
