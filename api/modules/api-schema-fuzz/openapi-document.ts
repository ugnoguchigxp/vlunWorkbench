const SAFE_METHODS = ["get", "head", "options"] as const;
const ALL_METHODS = [
	"get",
	"head",
	"options",
	"post",
	"put",
	"patch",
	"delete",
	"trace",
] as const;
const MAX_REFERENCE_DEPTH = 64;
const MAX_REFERENCE_COUNT = 10_000;

export type ParsedOpenApiOperation = {
	method: "GET" | "HEAD" | "OPTIONS";
	pathTemplate: string;
	operationId: string;
};

export type ParsedOpenApiDocument = {
	format: "openapi-3.0" | "openapi-3.1" | "swagger-2.0";
	basePath: string;
	operations: ParsedOpenApiOperation[];
	root: Record<string, unknown>;
};

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

function qualifiedVersion(
	root: Record<string, unknown>,
): ParsedOpenApiDocument["format"] {
	if (typeof root.openapi === "string") {
		if (/^3\.0\.[0-4]$/.test(root.openapi)) return "openapi-3.0";
		if (/^3\.1\.[0-2]$/.test(root.openapi)) return "openapi-3.1";
	}
	if (root.swagger === "2.0") return "swagger-2.0";
	throw new Error("openapi_version_not_qualified");
}

function validateBasePath(
	root: Record<string, unknown>,
	format: ParsedOpenApiDocument["format"],
): string {
	const candidate =
		format === "swagger-2.0"
			? (root.basePath ?? "/")
			: (() => {
					const servers = root.servers;
					if (servers === undefined) return "/";
					if (!Array.isArray(servers) || servers.length !== 1)
						throw new Error("openapi_server_base_path_invalid");
					return record(servers[0])?.url;
				})();
	if (
		typeof candidate !== "string" ||
		!candidate.startsWith("/") ||
		candidate.startsWith("//") ||
		/[?#{}\\%]/.test(candidate) ||
		candidate.includes("..") ||
		candidate.includes("//")
	)
		throw new Error("openapi_server_base_path_invalid");
	return candidate.length > 1 && candidate.endsWith("/")
		? candidate.slice(0, -1)
		: candidate;
}

function pointerTarget(
	root: Record<string, unknown>,
	reference: string,
): unknown {
	if (!reference.startsWith("#/"))
		throw new Error("openapi_external_ref_rejected");
	let current: unknown = root;
	for (const encoded of reference.slice(2).split("/")) {
		if (/~(?![01])/.test(encoded)) throw new Error("openapi_reference_invalid");
		const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
		const container = record(current);
		if (!container || !(key in container))
			throw new Error("openapi_reference_missing");
		current = container[key];
	}
	return current;
}

function validateReferences(root: Record<string, unknown>) {
	let count = 0;
	const visit = (value: unknown, stack: readonly string[], depth: number) => {
		if (depth > MAX_REFERENCE_DEPTH)
			throw new Error("openapi_reference_depth_exceeded");
		if (Array.isArray(value)) {
			for (const item of value) visit(item, stack, depth);
			return;
		}
		const object = record(value);
		if (!object) return;
		if ("$ref" in object) {
			if (typeof object.$ref !== "string")
				throw new Error("openapi_reference_invalid");
			count += 1;
			if (count > MAX_REFERENCE_COUNT)
				throw new Error("openapi_reference_count_exceeded");
			if (stack.includes(object.$ref))
				throw new Error("openapi_reference_cycle");
			visit(
				pointerTarget(root, object.$ref),
				[...stack, object.$ref],
				depth + 1,
			);
		}
		for (const [key, child] of Object.entries(object))
			if (key !== "$ref") visit(child, stack, depth);
	};
	visit(root, [], 0);
}

function parameterNames(
	root: Record<string, unknown>,
	value: unknown,
): Set<string> {
	if (value === undefined) return new Set();
	if (!Array.isArray(value)) throw new Error("openapi_path_parameters_invalid");
	const names = new Set<string>();
	for (const item of value) {
		let parameter = record(item);
		if (parameter && typeof parameter.$ref === "string")
			parameter = record(pointerTarget(root, parameter.$ref));
		if (parameter?.in !== "path" || typeof parameter.name !== "string")
			continue;
		if (names.has(parameter.name))
			throw new Error("openapi_path_parameter_duplicate");
		names.add(parameter.name);
	}
	return names;
}

function validatePath(pathTemplate: string) {
	if (
		!pathTemplate.startsWith("/") ||
		pathTemplate.includes("//") ||
		/[%\\\0]/.test(pathTemplate)
	)
		throw new Error("openapi_path_invalid");
	for (const segment of pathTemplate.split("/"))
		if (segment === "." || segment === "..")
			throw new Error("openapi_path_invalid");
	const parameters = [...pathTemplate.matchAll(/\{([^{}]+)\}/g)].map(
		(match) => match[1],
	);
	if (
		new Set(parameters).size !== parameters.length ||
		pathTemplate.replace(/\{[^{}]+\}/g, "").includes("{")
	)
		throw new Error("openapi_path_parameter_invalid");
	return new Set(parameters);
}

export function parseOpenApiDocument(document: unknown): ParsedOpenApiDocument {
	const root = record(document);
	if (!root) throw new Error("openapi_schema_required");
	const format = qualifiedVersion(root);
	if ("webhooks" in root) throw new Error("openapi_callback_not_qualified");
	validateReferences(root);
	const basePath = validateBasePath(root, format);
	const paths = record(root.paths);
	if (!paths) throw new Error("openapi_schema_required");
	const rootSecurity = root.security;
	if (rootSecurity !== undefined && !Array.isArray(rootSecurity))
		throw new Error("openapi_security_invalid");
	const operations: ParsedOpenApiOperation[] = [];
	const operationKeys = new Set<string>();
	for (const [pathTemplate, rawPathItem] of Object.entries(paths)) {
		const templateParameters = validatePath(pathTemplate);
		const pathItem = record(rawPathItem);
		if (!pathItem) throw new Error("openapi_path_item_invalid");
		const pathParameters = parameterNames(root, pathItem.parameters);
		for (const method of ALL_METHODS) {
			if (!(method in pathItem)) continue;
			const operation = record(pathItem[method]);
			if (!operation) throw new Error("openapi_operation_invalid");
			if ("callbacks" in operation)
				throw new Error("openapi_callback_not_qualified");
			const operationParameters = parameterNames(root, operation.parameters);
			const declared = new Set([...pathParameters, ...operationParameters]);
			if (
				templateParameters.size !== declared.size ||
				[...templateParameters].some((name) => !declared.has(name))
			)
				throw new Error("openapi_path_parameter_mismatch");
			if (!SAFE_METHODS.includes(method as (typeof SAFE_METHODS)[number]))
				continue;
			const security =
				operation.security === undefined ? rootSecurity : operation.security;
			if (security !== undefined && !Array.isArray(security))
				throw new Error("openapi_security_invalid");
			if (Array.isArray(security) && security.length > 0) continue;
			const key = `${method.toUpperCase()} ${pathTemplate}`;
			if (operationKeys.has(key))
				throw new Error("openapi_operation_duplicate");
			operationKeys.add(key);
			operations.push({
				method: method.toUpperCase() as ParsedOpenApiOperation["method"],
				pathTemplate,
				operationId:
					typeof operation.operationId === "string" && operation.operationId
						? operation.operationId
						: key,
			});
		}
	}
	operations.sort(
		(left, right) =>
			left.method.localeCompare(right.method) ||
			left.pathTemplate.localeCompare(right.pathTemplate) ||
			left.operationId.localeCompare(right.operationId),
	);
	if (operations.length === 0)
		throw new Error("no_unauthenticated_readonly_operations");
	return { format, basePath, operations, root };
}
