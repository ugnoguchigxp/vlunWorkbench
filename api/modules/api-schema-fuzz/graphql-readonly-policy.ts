import { createHash } from "node:crypto";
import {
	buildASTSchema,
	Kind,
	parse,
	type DocumentNode,
	validateSchema,
} from "graphql";
import { canonicalJson } from "../../../shared/canonical-json";
import { readStrictJsonDocumentBytes } from "./strict-json-document";

const MAX_GRAPHQL_TOKENS = 100_000;
const MAX_GRAPHQL_DEFINITIONS = 10_000;

const digest = (value: string | Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

export type GraphqlReadonlyOperationPolicyV1 = {
	schemaVersion: 1;
	schemaSnapshotDigest: string;
	endpointPath: "/graphql";
	allowedOperation: "query";
	maxRequests: 100;
	rateLimitPerSecond: 2;
	requestTimeoutMs: 10_000;
	runTimeoutMs: 120_000;
	maxRedirects: 0;
	maxRequestBytes: 1_048_576;
	maxPathBytes: 8192;
	maxPathSegmentBytes: 2048;
	maxQueryParameters: 50;
	maxQueryValueBytes: 4096;
	maxQueryBytes: 16384;
	maxRequestHeaderBytes: 16384;
	maxResponseBytes: 1_048_576;
	maxTotalResponseBytes: 67_108_864;
	policyHash: string;
};

function decodeGraphqlSource(source: string | Uint8Array): string {
	if (typeof source === "string") return source;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(source);
	} catch {
		throw new Error("graphql_schema_utf8_invalid");
	}
}

export function parseGraphqlReadonlySchema(
	source: string | Uint8Array,
): DocumentNode {
	let document: DocumentNode;
	try {
		document = parse(decodeGraphqlSource(source), {
			maxTokens: MAX_GRAPHQL_TOKENS,
		});
	} catch {
		throw new Error("graphql_schema_invalid");
	}
	if (document.definitions.length > MAX_GRAPHQL_DEFINITIONS)
		throw new Error("graphql_schema_definition_limit_exceeded");
	if (
		document.definitions.some(
			(definition) =>
				definition.kind === Kind.OPERATION_DEFINITION ||
				definition.kind === Kind.FRAGMENT_DEFINITION,
		)
	)
		throw new Error("graphql_schema_sdl_required");

	let schema: ReturnType<typeof buildASTSchema>;
	try {
		schema = buildASTSchema(document);
	} catch {
		throw new Error("graphql_schema_invalid");
	}
	if (validateSchema(schema).length > 0)
		throw new Error("graphql_schema_invalid");
	if (schema.getMutationType())
		throw new Error("graphql_mutation_not_readonly");
	if (schema.getSubscriptionType())
		throw new Error("graphql_subscription_not_readonly");
	const queryType = schema.getQueryType();
	if (!queryType || Object.keys(queryType.getFields()).length === 0)
		throw new Error("graphql_query_type_required");
	return document;
}

export function buildGraphqlReadonlyOperationPolicy(
	schemaSnapshotDigest: string,
): GraphqlReadonlyOperationPolicyV1 {
	const unsigned = {
		schemaVersion: 1 as const,
		schemaSnapshotDigest,
		endpointPath: "/graphql" as const,
		allowedOperation: "query" as const,
		maxRequests: 100 as const,
		rateLimitPerSecond: 2 as const,
		requestTimeoutMs: 10_000 as const,
		runTimeoutMs: 120_000 as const,
		maxRedirects: 0 as const,
		maxRequestBytes: 1_048_576 as const,
		maxPathBytes: 8192 as const,
		maxPathSegmentBytes: 2048 as const,
		maxQueryParameters: 50 as const,
		maxQueryValueBytes: 4096 as const,
		maxQueryBytes: 16384 as const,
		maxRequestHeaderBytes: 16384 as const,
		maxResponseBytes: 1_048_576 as const,
		maxTotalResponseBytes: 67_108_864 as const,
	};
	return { ...unsigned, policyHash: digest(canonicalJson(unsigned)) };
}

export async function loadGraphqlReadonlyOperationPolicy(
	schemaPath: string,
	snapshotRoot: string,
): Promise<GraphqlReadonlyOperationPolicyV1> {
	const bytes = await readStrictJsonDocumentBytes(schemaPath, snapshotRoot);
	parseGraphqlReadonlySchema(bytes);
	return buildGraphqlReadonlyOperationPolicy(digest(bytes));
}

export function isGraphqlQueryOnlyRequest(source: string): boolean {
	let document: DocumentNode;
	try {
		document = parse(source, { maxTokens: MAX_GRAPHQL_TOKENS });
	} catch {
		return false;
	}
	const operations = document.definitions.filter(
		(definition) => definition.kind === Kind.OPERATION_DEFINITION,
	);
	return (
		operations.length > 0 &&
		operations.every((operation) => operation.operation === "query") &&
		document.definitions.every(
			(definition) =>
				definition.kind === Kind.OPERATION_DEFINITION ||
				definition.kind === Kind.FRAGMENT_DEFINITION,
		)
	);
}

export function isGraphqlQueryOnlyPayload(payload: unknown): boolean {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return false;
	const record = payload as Record<string, unknown>;
	const allowedKeys = new Set(["query", "variables", "operationName"]);
	if (Object.keys(record).some((key) => !allowedKeys.has(key))) return false;
	if (typeof record.query !== "string") return false;
	if (
		record.operationName !== undefined &&
		record.operationName !== null &&
		(typeof record.operationName !== "string" ||
			!/^[_A-Za-z][_0-9A-Za-z]{0,255}$/.test(record.operationName))
	)
		return false;
	if (
		record.variables !== undefined &&
		record.variables !== null &&
		(typeof record.variables !== "object" || Array.isArray(record.variables))
	)
		return false;
	return isGraphqlQueryOnlyRequest(record.query);
}
