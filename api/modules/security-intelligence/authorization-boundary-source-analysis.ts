import path from "node:path";
import ts from "typescript";
import type { ModelEvidenceRef } from "../../../shared/schemas/application-model.schema";
import { securityIntelligenceRepositoryPathSchema } from "../../../shared/schemas/security-intelligence-assessment-components.schema";
import type { AuthorizationBoundary } from "../../../shared/schemas/security-intelligence-authorization.schema";

const HTTP_METHODS = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
]);

export type AuthorizationProjectionSource = {
	path: string;
	content: string;
};

export type ParsedAuthorizationSource = {
	sourceFile: ts.SourceFile;
	parseFailed: boolean;
	hasUseCall: boolean;
};

export function normalizeAuthorizationSources(
	values: readonly AuthorizationProjectionSource[],
	projectRoot?: string,
): Map<string, AuthorizationProjectionSource> {
	const output = new Map<string, AuthorizationProjectionSource>();
	for (const source of values) {
		const relativePath = normalizeSourcePath(source.path, projectRoot);
		if (output.has(relativePath)) {
			throw new Error("security_intelligence:authorization_source_duplicate");
		}
		output.set(relativePath, { path: relativePath, content: source.content });
	}
	return output;
}

export function parseAuthorizationSources(
	sources: ReadonlyMap<string, AuthorizationProjectionSource>,
): Map<string, ParsedAuthorizationSource> {
	return new Map(
		[...sources.entries()].map(([sourcePath, source]) => [
			sourcePath,
			parseSource(sourcePath, source.content),
		]),
	);
}

export function findAuthorizationHandlerCandidates(params: {
	method: AuthorizationBoundary["method"];
	routePattern: string;
	sourceRefs: readonly ModelEvidenceRef[];
	parsedSources: ReadonlyMap<string, ParsedAuthorizationSource>;
	hashIdentity: (value: string) => string;
}): string[] {
	const candidates: string[] = [];
	for (const ref of params.sourceRefs) {
		if (!ref.path) continue;
		const parsed = params.parsedSources.get(ref.path);
		if (!parsed || parsed.parseFailed) continue;
		visit(parsed.sourceFile, (node) => {
			if (!ts.isCallExpression(node)) return;
			const candidate = routeCandidate(node);
			if (
				candidate?.method === params.method &&
				candidate.routePattern === params.routePattern
			) {
				const identity = handlerIdentity(
					candidate.handler,
					params.hashIdentity,
				);
				if (identity) candidates.push(identity);
			}
		});
	}
	return candidates;
}

function parseSource(
	sourcePath: string,
	content: string,
): ParsedAuthorizationSource {
	const sourceFile = ts.createSourceFile(
		sourcePath,
		content,
		ts.ScriptTarget.Latest,
		true,
		scriptKind(sourcePath),
	);
	const diagnostics = (
		sourceFile as ts.SourceFile & {
			parseDiagnostics?: readonly ts.Diagnostic[];
		}
	).parseDiagnostics;
	const parseFailed = (diagnostics?.length ?? 0) > 0;
	let hasUseCall = false;
	visit(sourceFile, (node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "use"
		) {
			hasUseCall = true;
		}
	});
	return { sourceFile, parseFailed, hasUseCall };
}

function routeCandidate(node: ts.CallExpression): {
	method: AuthorizationBoundary["method"];
	routePattern: string;
	handler: ts.Expression | undefined;
} | null {
	if (!ts.isPropertyAccessExpression(node.expression)) return null;
	const callName = node.expression.name.text;
	if (callName === "route") return fastifyRouteCandidate(node.arguments[0]);
	const method = callName.toUpperCase();
	if (!HTTP_METHODS.has(method)) return null;
	const route = stringValue(node.arguments[0]);
	if (!route) return null;
	return {
		method: method as AuthorizationBoundary["method"],
		routePattern: normalizeRoute(route),
		handler: node.arguments.at(-1),
	};
}

function fastifyRouteCandidate(
	argument: ts.Expression | undefined,
): ReturnType<typeof routeCandidate> {
	if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
	const property = (name: string) =>
		argument.properties.find(
			(item) =>
				ts.isPropertyAssignment(item) &&
				((ts.isIdentifier(item.name) && item.name.text === name) ||
					(ts.isStringLiteralLike(item.name) && item.name.text === name)),
		) as ts.PropertyAssignment | undefined;
	const method = stringValue(property("method")?.initializer)?.toUpperCase();
	const route = stringValue(property("url")?.initializer);
	if (!method || !HTTP_METHODS.has(method) || !route) return null;
	return {
		method: method as AuthorizationBoundary["method"],
		routePattern: normalizeRoute(route),
		handler: property("handler")?.initializer,
	};
}

function handlerIdentity(
	expression: ts.Expression | undefined,
	hashIdentity: (value: string) => string,
): string | null {
	if (!expression) return null;
	if (ts.isIdentifier(expression)) {
		return `handler:v1:${hashIdentity(expression.text)}`;
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return `handler:v1:${hashIdentity(expression.getText())}`;
	}
	if (ts.isFunctionExpression(expression) && expression.name) {
		return `handler:v1:${hashIdentity(expression.name.text)}`;
	}
	return null;
}

function normalizeSourcePath(value: string, projectRoot?: string): string {
	let relativePath = value;
	if (path.isAbsolute(value)) {
		if (!projectRoot || !path.isAbsolute(projectRoot)) {
			throw new Error(
				"security_intelligence:authorization_project_root_required",
			);
		}
		relativePath = path.relative(
			path.resolve(projectRoot),
			path.resolve(value),
		);
	}
	const normalized = relativePath.split(path.sep).join("/");
	return securityIntelligenceRepositoryPathSchema.parse(normalized);
}

function stringValue(node: ts.Expression | undefined): string | null {
	return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function normalizeRoute(value: string): string {
	const leading = value.startsWith("/") ? value : `/${value}`;
	return leading
		.replace(/:([A-Za-z_][\w]*)/g, "{$1}")
		.replace(/\*+/g, "{wildcard}")
		.replace(/\/+/g, "/");
}

function scriptKind(sourcePath: string): ts.ScriptKind {
	const extension = path.extname(sourcePath).toLowerCase();
	if (extension === ".tsx") return ts.ScriptKind.TSX;
	if (extension === ".jsx") return ts.ScriptKind.JSX;
	if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
	callback(node);
	node.forEachChild((child) => visit(child, callback));
}
