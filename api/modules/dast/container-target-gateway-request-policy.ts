import type http from "node:http";
import { isGraphqlQueryOnlyPayload } from "../api-schema-fuzz/graphql-readonly-policy";
import { parseStrictJsonDocument } from "../api-schema-fuzz/strict-json-document";
import type { ContainerTargetGatewayOptions } from "./container-target-gateway";

export const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);
const BLOCKED_UPSTREAM_INJECTION_HEADERS = new Set([
	...HOP_BY_HOP_HEADERS,
	"__proto__",
	"constructor",
	"host",
	"content-length",
	"content-type",
	"prototype",
	"x-http-method",
	"x-http-method-override",
	"x-method-override",
]);
const DEFAULT_REQUEST_LIMITS = {
	maxPathBytes: 8192,
	maxPathSegmentBytes: 2048,
	maxQueryParameters: 50,
	maxQueryValueBytes: 4096,
	maxQueryBytes: 16384,
	maxRequestHeaderBytes: 16384,
} as const;

function decodedPathSegments(requestTarget: string): string[] | null {
	const rawPath = requestTarget.split("?", 1)[0];
	if (
		!rawPath.startsWith("/") ||
		rawPath.startsWith("//") ||
		rawPath.includes("//") ||
		/%(?:2f|5c|00)/i.test(rawPath)
	)
		return null;
	const result: string[] = [];
	for (const rawSegment of rawPath.split("/").slice(1)) {
		let segment: string;
		try {
			segment = decodeURIComponent(rawSegment);
		} catch {
			return null;
		}
		if (
			segment === "." ||
			segment === ".." ||
			segment.includes("/") ||
			segment.includes("\\") ||
			segment.includes("\0")
		)
			return null;
		result.push(segment);
	}
	return result;
}

export function matchingExactOperation(
	requestTarget: string,
	method: string,
	operations: NonNullable<ContainerTargetGatewayOptions["exactOperations"]>,
) {
	const actual = decodedPathSegments(requestTarget);
	if (!actual) return null;
	return (
		operations.find((operation) => {
			if (operation.method !== method) return false;
			const expected = operation.pathTemplate.split("/").slice(1);
			return (
				expected.length === actual.length &&
				expected.every((segment, index) =>
					/^\{[^{}]+\}$/.test(segment)
						? actual[index].length > 0
						: segment === actual[index],
				)
			);
		}) ?? null
	);
}

export async function readBoundedRequestBody(
	req: http.IncomingMessage,
	maxBytes: number,
): Promise<Uint8Array | null> {
	const contentLength = req.headers["content-length"];
	if (
		typeof contentLength !== "string" ||
		!/^\d+$/.test(contentLength) ||
		Number(contentLength) > maxBytes
	) {
		req.resume();
		return null;
	}
	const expectedBytes = Number(contentLength);
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const rawChunk of req) {
		const chunk =
			typeof rawChunk === "string"
				? new TextEncoder().encode(rawChunk)
				: new Uint8Array(rawChunk);
		total += chunk.byteLength;
		if (total > expectedBytes) {
			req.destroy();
			return null;
		}
		chunks.push(chunk);
	}
	if (total !== expectedBytes) return null;
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export function normalizeRequestLimits(
	limits: ContainerTargetGatewayOptions["requestLimits"],
) {
	const resolved = { ...DEFAULT_REQUEST_LIMITS, ...limits };
	for (const [name, maximum] of Object.entries(DEFAULT_REQUEST_LIMITS)) {
		const value = resolved[name as keyof typeof resolved];
		if (!Number.isInteger(value) || value < 1 || value > maximum)
			throw new Error(`target_gateway_${name}_invalid`);
	}
	if (resolved.maxPathSegmentBytes > resolved.maxPathBytes)
		throw new Error("target_gateway_path_segment_limit_invalid");
	return resolved;
}

function decodeQueryComponent(value: string): string | null {
	try {
		return decodeURIComponent(value.replaceAll("+", " "));
	} catch {
		return null;
	}
}

export function requestWithinLimits(
	req: http.IncomingMessage,
	requestTarget: string,
	limits: ReturnType<typeof normalizeRequestLimits>,
	upstreamRequestHeaders: Readonly<Record<string, string>>,
): boolean {
	if (requestTarget.includes("#")) return false;
	const separator = requestTarget.indexOf("?");
	const rawPath =
		separator === -1 ? requestTarget : requestTarget.slice(0, separator);
	const rawQuery = separator === -1 ? "" : requestTarget.slice(separator + 1);
	if (
		Buffer.byteLength(rawPath) > limits.maxPathBytes ||
		Buffer.byteLength(rawQuery) > limits.maxQueryBytes
	)
		return false;
	const segments = decodedPathSegments(rawPath);
	if (
		!segments ||
		segments.some(
			(segment) => Buffer.byteLength(segment) > limits.maxPathSegmentBytes,
		)
	)
		return false;
	const parameters = rawQuery ? rawQuery.split("&") : [];
	if (parameters.length > limits.maxQueryParameters) return false;
	for (const parameter of parameters) {
		const equals = parameter.indexOf("=");
		const rawName = equals === -1 ? parameter : parameter.slice(0, equals);
		const rawValue = equals === -1 ? "" : parameter.slice(equals + 1);
		const name = decodeQueryComponent(rawName);
		const value = decodeQueryComponent(rawValue);
		if (
			name === null ||
			value === null ||
			Buffer.byteLength(value) > limits.maxQueryValueBytes ||
			[
				"_method",
				"x-http-method",
				"x-http-method-override",
				"x-method-override",
			].includes(name.toLowerCase())
		)
			return false;
	}
	const headerBytes =
		2 +
		req.rawHeaders.reduce(
			(total, value) => total + Buffer.byteLength(value) + 2,
			0,
		) +
		Object.entries(upstreamRequestHeaders).reduce(
			(total, [name, value]) =>
				total + Buffer.byteLength(name) + Buffer.byteLength(value) + 4,
			0,
		);
	return headerBytes <= limits.maxRequestHeaderBytes;
}

export function isQualifiedGraphqlRequest(
	body: Uint8Array,
	contentType: string | undefined,
): boolean {
	if (!/^application\/json(?:\s*;|$)/i.test(contentType ?? "")) return false;
	let parsed: unknown;
	try {
		parsed = parseStrictJsonDocument(body);
	} catch {
		return false;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return false;
	return isGraphqlQueryOnlyPayload(parsed);
}

export function validatedUpstreamHeaders(
	headers: ContainerTargetGatewayOptions["upstreamRequestHeaders"],
): Readonly<Record<string, string>> {
	if (!headers) return {};
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		const normalized = name.toLowerCase();
		if (
			!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(normalized) ||
			BLOCKED_UPSTREAM_INJECTION_HEADERS.has(normalized)
		)
			throw new Error("target_gateway_auth_header_not_allowed");
		if (/[\r\n]/.test(name) || /[\r\n]/.test(value))
			throw new Error("target_gateway_auth_header_invalid");
		if (Object.hasOwn(result, normalized))
			throw new Error("target_gateway_auth_header_duplicate");
		result[normalized] = value;
	}
	return result;
}
