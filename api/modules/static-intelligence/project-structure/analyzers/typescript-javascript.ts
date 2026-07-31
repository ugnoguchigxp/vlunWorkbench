import path from "node:path";
import ts from "typescript";
import type {
	CodeStructureFileTag,
	CodeStructureLanguage,
	CodeStructureModuleKind,
} from "../../../../../shared/schemas/static-intelligence-code-structure.schema";
import type {
	ProjectStructureAnalyzer,
	UnresolvedStructureReference,
} from "./types";

const TAG_ORDER: CodeStructureFileTag[] = [
	"route",
	"handler",
	"schema",
	"worker",
	"test",
	"config",
	"source",
];

export const TYPESCRIPT_JAVASCRIPT_ANALYZER: ProjectStructureAnalyzer = {
	id: "typescript-javascript",
	version: "2",
	supports: (entry) =>
		entry.kind === "source" &&
		[".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(
			path.posix.extname(entry.path).toLowerCase(),
		),
	analyze(entry, bytes) {
		const content = new TextDecoder().decode(bytes);
		const sourceFile = ts.createSourceFile(
			entry.path,
			content,
			ts.ScriptTarget.Latest,
			true,
			scriptKindForPath(entry.path),
		);
		const imports: string[] = [];
		const exportedSymbols: string[] = [];
		const identifiers: string[] = [];
		let hasEsm = false;
		let hasCommonjs = false;

		const addImportSpecifier = (node: ts.Node | undefined) => {
			if (node && ts.isStringLiteralLike(node)) imports.push(node.text);
		};
		const addBindingName = (name: ts.BindingName): void => {
			if (ts.isIdentifier(name)) {
				exportedSymbols.push(name.text);
				return;
			}
			for (const element of name.elements) {
				if (ts.isBindingElement(element)) addBindingName(element.name);
			}
		};
		const addIdentifierName = (
			name: ts.BindingName | ts.PropertyName | undefined,
		): void => {
			if (!name) return;
			if (ts.isIdentifier(name)) {
				identifiers.push(name.text);
				return;
			}
			if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
				for (const element of name.elements) {
					if (ts.isBindingElement(element)) addIdentifierName(element.name);
				}
			}
		};
		const visit = (node: ts.Node): void => {
			if (
				(ts.isFunctionDeclaration(node) ||
					ts.isClassDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isEnumDeclaration(node)) &&
				node.name
			) {
				addIdentifierName(node.name);
			} else if (ts.isVariableDeclaration(node)) {
				addIdentifierName(node.name);
			} else if (
				ts.isPropertyDeclaration(node) ||
				ts.isPropertySignature(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isMethodSignature(node) ||
				ts.isPropertyAssignment(node) ||
				ts.isShorthandPropertyAssignment(node)
			) {
				addIdentifierName(node.name);
			}

			if (ts.isImportDeclaration(node)) {
				hasEsm = true;
				addImportSpecifier(node.moduleSpecifier);
			} else if (
				ts.isImportEqualsDeclaration(node) &&
				ts.isExternalModuleReference(node.moduleReference)
			) {
				hasCommonjs = true;
				addImportSpecifier(node.moduleReference.expression);
			} else if (ts.isExportDeclaration(node)) {
				hasEsm = true;
				addImportSpecifier(node.moduleSpecifier);
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					for (const element of node.exportClause.elements) {
						exportedSymbols.push(element.name.text);
					}
				}
			} else if (ts.isExportAssignment(node)) {
				hasEsm = true;
				exportedSymbols.push("default");
			} else if (hasExportModifier(node)) {
				hasEsm = true;
				if (hasDefaultModifier(node)) exportedSymbols.push("default");
				if (
					(ts.isFunctionDeclaration(node) ||
						ts.isClassDeclaration(node) ||
						ts.isInterfaceDeclaration(node) ||
						ts.isTypeAliasDeclaration(node) ||
						ts.isEnumDeclaration(node)) &&
					node.name
				) {
					exportedSymbols.push(node.name.text);
				} else if (ts.isVariableStatement(node)) {
					for (const declaration of node.declarationList.declarations) {
						addBindingName(declaration.name);
					}
				}
			}
			if (ts.isCallExpression(node)) {
				if (
					ts.isIdentifier(node.expression) &&
					node.expression.text === "require" &&
					node.arguments.length === 1
				) {
					hasCommonjs = true;
					addImportSpecifier(node.arguments[0]);
				} else if (
					node.expression.kind === ts.SyntaxKind.ImportKeyword &&
					node.arguments.length === 1
				) {
					hasEsm = true;
					addImportSpecifier(node.arguments[0]);
				}
			} else if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				isCommonjsExportExpression(node.left)
			) {
				hasCommonjs = true;
				const exportedName = commonjsExportName(node.left);
				if (exportedName) exportedSymbols.push(exportedName);
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
		const references: UnresolvedStructureReference[] = uniqueSorted(
			imports,
		).map((specifier) => ({
			from: entry.path,
			specifier,
			kindHint: kindHintForSpecifier(specifier),
		}));
		return {
			analyzerId: "typescript-javascript",
			references,
			diagnosticCodes:
				parseDiagnosticCount(sourceFile) > 0 ? ["analysis_source_partial"] : [],
			fileFacts: {
				language: languageForPath(entry.path),
				moduleKind: moduleKind(hasEsm, hasCommonjs),
				tags: tagsForFile(entry.path, imports, exportedSymbols),
				exportedSymbols: uniqueSorted(exportedSymbols),
				identifiers: uniqueSorted(identifiers).slice(0, 256),
			},
		};
	},
};

function kindHintForSpecifier(
	specifier: string,
): UnresolvedStructureReference["kindHint"] {
	if (/\.css$/i.test(specifier)) return "stylesheet";
	if (
		/\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|wasm)$/i.test(
			specifier,
		)
	)
		return "asset";
	if (/\.json$/i.test(specifier)) return "manifest";
	return "code_module";
}

function tagsForFile(
	filePath: string,
	imports: string[],
	exportedSymbols: string[],
): CodeStructureFileTag[] {
	const tags = new Set<CodeStructureFileTag>();
	const lowerPath = filePath.toLowerCase();
	const basename = path.posix.basename(lowerPath);
	if (
		lowerPath.includes("/__tests__/") ||
		basename.includes(".test.") ||
		basename.includes(".spec.")
	)
		tags.add("test");
	if (
		basename.includes("config") ||
		/^(?:vite|vitest|eslint|biome|tailwind|postcss)\./.test(basename) ||
		lowerPath.includes("/config/")
	)
		tags.add("config");
	if (
		lowerPath.includes("schema") ||
		imports.includes("zod") ||
		imports.includes("drizzle-orm/sqlite-core")
	)
		tags.add("schema");
	if (
		lowerPath.includes("routes") ||
		basename.includes(".route.") ||
		[
			"route.ts",
			"route.js",
			"page.tsx",
			"page.jsx",
			"layout.tsx",
			"layout.jsx",
		].includes(basename)
	)
		tags.add("route");
	if (
		exportedSymbols.some((symbol) =>
			symbol.toLowerCase().includes("handler"),
		) ||
		imports.includes("hono") ||
		lowerPath.includes("handlers")
	)
		tags.add("handler");
	if (
		lowerPath.includes("worker") ||
		lowerPath.includes("queue") ||
		lowerPath.includes("job") ||
		lowerPath.includes("runner")
	)
		tags.add("worker");
	if (!(tags.size === 1 && tags.has("config")) && !tags.has("test"))
		tags.add("source");
	return TAG_ORDER.filter((tag) => tags.has(tag));
}

function parseDiagnosticCount(sourceFile: ts.SourceFile): number {
	return (
		(
			sourceFile as ts.SourceFile & {
				parseDiagnostics?: readonly ts.Diagnostic[];
			}
		).parseDiagnostics?.length ?? 0
	);
}
function hasExportModifier(node: ts.Node): boolean {
	return (
		ts.canHaveModifiers(node) &&
		(ts
			.getModifiers(node)
			?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
			false)
	);
}
function hasDefaultModifier(node: ts.Node): boolean {
	return (
		ts.canHaveModifiers(node) &&
		(ts
			.getModifiers(node)
			?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ??
			false)
	);
}
function isCommonjsExportExpression(expression: ts.Expression): boolean {
	return (
		isModuleExportsExpression(expression) ||
		commonjsExportName(expression) !== null
	);
}
function isModuleExportsExpression(expression: ts.Expression): boolean {
	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === "exports" &&
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === "module"
	);
}
function commonjsExportName(expression: ts.Expression): string | null {
	if (!ts.isPropertyAccessExpression(expression)) return null;
	if (isModuleExportsExpression(expression.expression))
		return expression.name.text;
	if (
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === "exports"
	)
		return expression.name.text;
	return null;
}
function moduleKind(
	hasEsm: boolean,
	hasCommonjs: boolean,
): CodeStructureModuleKind {
	if (hasEsm && hasCommonjs) return "mixed";
	if (hasEsm) return "esm";
	if (hasCommonjs) return "commonjs";
	return "unknown";
}
function scriptKindForPath(filePath: string): ts.ScriptKind {
	switch (path.extname(filePath)) {
		case ".tsx":
			return ts.ScriptKind.TSX;
		case ".jsx":
			return ts.ScriptKind.JSX;
		case ".js":
		case ".mjs":
		case ".cjs":
			return ts.ScriptKind.JS;
		default:
			return ts.ScriptKind.TS;
	}
}
function languageForPath(filePath: string): CodeStructureLanguage {
	const extension = path.extname(filePath);
	if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
	if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
	return "unknown";
}
function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
