import { createHash } from "node:crypto";
import { canonicalJson } from "../../../shared/canonical-json";
import type { ParsedOpenApiDocument } from "./openapi-document";

const digest = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

export type OpenApiReadonlyOperationPolicyV1 = {
	schemaVersion: 1;
	schemaSnapshotDigest: string;
	basePath: string;
	operations: ParsedOpenApiDocument["operations"];
	maxRequests: 100;
	rateLimitPerSecond: 2;
	requestTimeoutMs: 10_000;
	runTimeoutMs: 120_000;
	maxRedirects: 0;
	maxPathBytes: 8192;
	maxPathSegmentBytes: 2048;
	maxQueryParameters: 50;
	maxQueryValueBytes: 4096;
	maxQueryBytes: 16384;
	maxRequestHeaderBytes: 16384;
	maxResponseBytes: 1048576;
	maxTotalResponseBytes: 67108864;
	policyHash: string;
};

export function buildOpenApiReadonlyOperationPolicy(
	document: ParsedOpenApiDocument,
	schemaSnapshotDigest: string,
): OpenApiReadonlyOperationPolicyV1 {
	const unsigned = {
		schemaVersion: 1 as const,
		schemaSnapshotDigest,
		basePath: document.basePath,
		operations: [...document.operations],
		maxRequests: 100 as const,
		rateLimitPerSecond: 2 as const,
		requestTimeoutMs: 10_000 as const,
		runTimeoutMs: 120_000 as const,
		maxRedirects: 0 as const,
		maxPathBytes: 8192 as const,
		maxPathSegmentBytes: 2048 as const,
		maxQueryParameters: 50 as const,
		maxQueryValueBytes: 4096 as const,
		maxQueryBytes: 16384 as const,
		maxRequestHeaderBytes: 16384 as const,
		maxResponseBytes: 1048576 as const,
		maxTotalResponseBytes: 67108864 as const,
	};
	return { ...unsigned, policyHash: digest(canonicalJson(unsigned)) };
}
