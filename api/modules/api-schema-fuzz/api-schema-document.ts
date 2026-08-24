import path from "node:path";
import {
	parseStrictJsonDocument,
	readStrictJsonDocumentBytes,
} from "./strict-json-document";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_YAML_DEPTH = 128;
const MAX_YAML_NODES = 100_000;

export type ApiSchemaDocumentFormat = "json" | "yaml";

function validateYamlValue(
	value: unknown,
	state: { nodes: number; seen: WeakSet<object> },
	depth = 0,
): void {
	if (depth > MAX_YAML_DEPTH) throw new Error("api_schema_yaml_depth_exceeded");
	state.nodes += 1;
	if (state.nodes > MAX_YAML_NODES)
		throw new Error("api_schema_yaml_node_limit_exceeded");
	if (value === null || ["string", "boolean"].includes(typeof value)) return;
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("api_schema_yaml_number_invalid");
		return;
	}
	if (typeof value !== "object")
		throw new Error("api_schema_yaml_value_not_qualified");
	if (state.seen.has(value)) throw new Error("api_schema_yaml_alias_rejected");
	state.seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) validateYamlValue(item, state, depth + 1);
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null)
		throw new Error("api_schema_yaml_object_not_qualified");
	for (const [key, child] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key))
			throw new Error("api_schema_yaml_prototype_key");
		validateYamlValue(child, state, depth + 1);
	}
}

export function apiSchemaDocumentFormatForPath(
	filePath: string,
): ApiSchemaDocumentFormat {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".yaml" || extension === ".yml") return "yaml";
	return "json";
}

export function parseApiSchemaDocument(
	source: string | Uint8Array,
	format: ApiSchemaDocumentFormat,
): unknown {
	if (format === "json") return parseStrictJsonDocument(source);
	const bytes =
		typeof source === "string" ? new TextEncoder().encode(source) : source;
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("api_schema_yaml_utf8_invalid");
	}
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(text);
	} catch {
		throw new Error("api_schema_yaml_invalid");
	}
	validateYamlValue(parsed, { nodes: 0, seen: new WeakSet() });
	return parsed;
}

export async function readApiSchemaDocument(
	filePath: string,
	snapshotRoot: string,
): Promise<{
	bytes: Uint8Array;
	document: unknown;
	format: ApiSchemaDocumentFormat;
}> {
	const bytes = await readStrictJsonDocumentBytes(filePath, snapshotRoot);
	const format = apiSchemaDocumentFormatForPath(filePath);
	return {
		bytes,
		document: parseApiSchemaDocument(bytes, format),
		format,
	};
}
