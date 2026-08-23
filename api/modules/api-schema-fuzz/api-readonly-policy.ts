import { parseOpenApiDocument } from "./openapi-document";

export type ApiReadonlyPolicyResult =
	| {
			ok: true;
			operations: Array<{ path: string; method: "get" | "head" | "options" }>;
	  }
	| { ok: false; reasonCode: string };

/** Stable API scanning accepts only self-contained JSON OpenAPI 3.0/3.1 or Swagger 2.0. */
export function evaluateApiReadonlyPolicy(
	document: unknown,
): ApiReadonlyPolicyResult {
	try {
		const parsed = parseOpenApiDocument(document);
		return {
			ok: true,
			operations: parsed.operations.map((operation) => ({
				path: operation.pathTemplate,
				method: operation.method.toLowerCase() as "get" | "head" | "options",
			})),
		};
	} catch (error) {
		return {
			ok: false,
			reasonCode:
				error instanceof Error ? error.message : "openapi_schema_required",
		};
	}
}
