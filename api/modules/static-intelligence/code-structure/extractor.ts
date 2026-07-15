import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
	type CodeStructureEdge,
	type CodeStructureFile,
	type CodeStructureFileTag,
	type CodeStructureLanguage,
	type CodeStructureModuleKind,
	type CodeStructurePackage,
	type CodeStructureSnapshot,
	codeStructureSnapshotSchema,
} from "../../../../shared/schemas/static-intelligence-code-structure.schema";

const SUPPORTED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
]);

const RESOLUTION_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
];

const INDEX_FILENAMES = RESOLUTION_EXTENSIONS.map(
	(extension) => `index${extension}`,
);

const IGNORED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".cache",
	".vite",
	"vendor",
]);

const SECRET_FILE_EXTENSIONS = new Set([
	".pem",
	".key",
	".crt",
	".p12",
	".sqlite",
	".db",
]);

const TAG_ORDER: CodeStructureFileTag[] = [
	"route",
	"handler",
	"schema",
	"worker",
	"test",
	"config",
	"source",
];

type BuildCodeStructureSnapshotInput = {
	projectPath: string;
	projectId?: string;
	generatedAt?: Date;
	includeRootPath?: boolean;
	maxFiles?: number;
};

type ExtractedSyntax = {
	imports: string[];
	exportedSymbols: string[];
	identifiers: string[];
	moduleKind: CodeStructureModuleKind;
	hasParseDiagnostics: boolean;
};

type DiscoveredFile = {
	absolutePath: string;
	relativePath: string;
};

export async function buildCodeStructureSnapshot(
	input: BuildCodeStructureSnapshotInput,
): Promise<CodeStructureSnapshot> {
	const generatedAt = (input.generatedAt ?? new Date()).toISOString();
	const maxFiles = input.maxFiles ?? 5000;
	if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20000) {
		throw new Error("--max-files must be an integer between 1 and 20000.");
	}

	const rootPath = await resolveProjectRoot(input.projectPath);
	const rootRef = sha256Hex(rootPath);
	const discovery = await discoverFiles(rootPath, maxFiles);
	const files = await Promise.all(
		discovery.files.map((file) => buildFileFacts(file)),
	);
	const sortedFiles = files.sort((a, b) => a.path.localeCompare(b.path));
	const filePathSet = new Set(sortedFiles.map((file) => file.path));
	annotateUnresolvedRelativeImports(sortedFiles, filePathSet);

	const edges = buildEdges(sortedFiles, filePathSet);
	const packages = buildPackages(sortedFiles);
	for (const file of sortedFiles) {
		file.tags = tagsForFile(file);
	}
	const degradedReasons = uniqueSorted([
		...discovery.degradedReasons,
		...sortedFiles.flatMap((file) =>
			file.degradedReasons.map((reason) => `${file.path}: ${reason}`),
		),
	]);
	const status = degradedReasons.length > 0 ? "partial" : "completed";
	const snapshot: CodeStructureSnapshot = {
		version: "v1",
		generatedAt,
		project: {
			...(input.projectId ? { id: input.projectId } : {}),
			rootRef,
			...(input.includeRootPath ? { rootPath } : {}),
			rootPathIncluded: input.includeRootPath === true,
		},
		status,
		degradedReasons,
		files: sortedFiles,
		edges,
		packages,
		summary: buildSummary(sortedFiles, edges, packages),
	};

	return codeStructureSnapshotSchema.parse(snapshot);
}

async function resolveProjectRoot(projectPath: string): Promise<string> {
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(projectPath);
	} catch {
		throw new Error(`Project path not found: ${projectPath}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`Project path is not a directory: ${projectPath}`);
	}
	return fs.realpath(projectPath);
}

async function discoverFiles(
	rootPath: string,
	maxFiles: number,
): Promise<{ files: DiscoveredFile[]; degradedReasons: string[] }> {
	const files: DiscoveredFile[] = [];
	const degradedReasons: string[] = [];
	let hitMaxFiles = false;

	async function walk(directory: string): Promise<void> {
		if (hitMaxFiles) return;
		const entries = await fs
			.readdir(directory, { withFileTypes: true })
			.catch((error) => {
				degradedReasons.push(
					`failed to read directory: ${relativePosix(rootPath, directory)} (${errorCode(error)})`,
				);
				return [];
			});
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (hitMaxFiles) return;
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (IGNORED_DIRECTORIES.has(entry.name)) continue;
				await walk(absolutePath);
				continue;
			}
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (!isSupportedSourcePath(entry.name) || isSecretDataPath(entry.name)) {
				continue;
			}
			let realPath: string;
			try {
				realPath = await fs.realpath(absolutePath);
			} catch {
				degradedReasons.push(
					`failed to resolve file path: ${relativePosix(rootPath, absolutePath)}`,
				);
				continue;
			}
			if (!isPathInside(rootPath, realPath)) {
				degradedReasons.push(
					`skipped file outside project root: ${relativePosix(rootPath, absolutePath)}`,
				);
				continue;
			}
			if (files.length >= maxFiles) {
				hitMaxFiles = true;
				degradedReasons.push(`max file limit reached: ${maxFiles}`);
				return;
			}
			files.push({
				absolutePath: realPath,
				relativePath: relativePosix(rootPath, realPath),
			});
		}
	}

	await walk(rootPath);
	return {
		files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
		degradedReasons,
	};
}

async function buildFileFacts(
	file: DiscoveredFile,
): Promise<CodeStructureFile> {
	const degradedReasons: string[] = [];
	let content: Buffer;
	try {
		content = await fs.readFile(file.absolutePath);
	} catch {
		return {
			path: file.relativePath,
			language: languageForPath(file.relativePath),
			moduleKind: "unknown",
			tags: ["source"],
			exportedSymbols: [],
			identifiers: [],
			imports: [],
			packageImports: [],
			contentHash: sha256Hex(""),
			parseStatus: "skipped",
			degradedReasons: ["failed to read file"],
		};
	}

	const sourceText = content.toString("utf8");
	const syntax = extractSyntax(file.relativePath, sourceText);
	if (syntax.hasParseDiagnostics) {
		degradedReasons.push("typescript parser reported syntax diagnostics");
	}
	const imports = uniqueSorted(syntax.imports);
	const packageImports = uniqueSorted(
		imports.filter(isPackageSpecifier).map(normalizePackageName),
	);
	const result: CodeStructureFile = {
		path: file.relativePath,
		language: languageForPath(file.relativePath),
		moduleKind: syntax.moduleKind,
		tags: [],
		exportedSymbols: uniqueSorted(syntax.exportedSymbols),
		identifiers: uniqueSorted(syntax.identifiers).slice(0, 256),
		imports,
		packageImports,
		contentHash: createHash("sha256").update(content).digest("hex"),
		parseStatus: degradedReasons.length > 0 ? "degraded" : "parsed",
		degradedReasons,
	};

	return {
		...result,
		tags: tagsForFile(result),
	};
}

function extractSyntax(filePath: string, sourceText: string): ExtractedSyntax {
	const sourceFile = ts.createSourceFile(
		filePath,
		sourceText,
		ts.ScriptTarget.Latest,
		true,
		scriptKindForPath(filePath),
	);
	const imports: string[] = [];
	const exportedSymbols: string[] = [];
	const identifiers: string[] = [];
	let hasEsm = false;
	let hasCommonjs = false;

	function addImportSpecifier(node: ts.Node | undefined): void {
		if (node && ts.isStringLiteralLike(node)) imports.push(node.text);
	}

	function addBindingName(name: ts.BindingName): void {
		if (ts.isIdentifier(name)) {
			exportedSymbols.push(name.text);
			return;
		}
		for (const element of name.elements) {
			if (ts.isBindingElement(element)) addBindingName(element.name);
		}
	}

	function addIdentifierName(
		name: ts.BindingName | ts.PropertyName | undefined,
	) {
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
	}

	function visit(node: ts.Node): void {
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
			if (hasDefaultModifier(node)) {
				exportedSymbols.push("default");
			}
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
	}

	visit(sourceFile);

	return {
		imports,
		exportedSymbols,
		identifiers,
		moduleKind: moduleKind(hasEsm, hasCommonjs),
		hasParseDiagnostics: parseDiagnosticCount(sourceFile) > 0,
	};
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
	) {
		return expression.name.text;
	}
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

function annotateUnresolvedRelativeImports(
	files: CodeStructureFile[],
	filePathSet: Set<string>,
): void {
	for (const file of files) {
		const unresolvedImports = file.imports
			.filter(isRelativeSpecifier)
			.filter(
				(specifier) =>
					!resolveRelativeImport(file.path, specifier, filePathSet),
			);
		if (unresolvedImports.length === 0) continue;
		file.degradedReasons.push(
			`unresolved relative imports: ${unresolvedImports.join(", ")}`,
		);
		file.parseStatus = "degraded";
	}
}

function buildEdges(
	files: CodeStructureFile[],
	filePathSet: Set<string>,
): CodeStructureEdge[] {
	const edgeKeys = new Set<string>();
	const edges: CodeStructureEdge[] = [];
	for (const file of files) {
		for (const specifier of file.imports) {
			if (isRelativeSpecifier(specifier)) {
				const target = resolveRelativeImport(file.path, specifier, filePathSet);
				if (target) {
					addEdge(edges, edgeKeys, {
						from: file.path,
						to: target,
						kind: "imports",
						confidence: 0.9,
					});
				}
			} else if (isPackageSpecifier(specifier)) {
				addEdge(edges, edgeKeys, {
					from: file.path,
					to: normalizePackageName(specifier),
					kind: "depends_on_package",
					confidence: 0.8,
				});
			}
		}
	}
	return edges.sort(compareEdges);
}

function addEdge(
	edges: CodeStructureEdge[],
	keys: Set<string>,
	edge: CodeStructureEdge,
): void {
	const key = `${edge.from}\0${edge.kind}\0${edge.to}`;
	if (keys.has(key)) return;
	keys.add(key);
	edges.push(edge);
}

function compareEdges(a: CodeStructureEdge, b: CodeStructureEdge): number {
	return (
		a.from.localeCompare(b.from) ||
		a.kind.localeCompare(b.kind) ||
		a.to.localeCompare(b.to)
	);
}

function buildPackages(files: CodeStructureFile[]): CodeStructurePackage[] {
	const importedByByPackage = new Map<string, Set<string>>();
	for (const file of files) {
		for (const packageName of file.packageImports) {
			const importedBy =
				importedByByPackage.get(packageName) ?? new Set<string>();
			importedBy.add(file.path);
			importedByByPackage.set(packageName, importedBy);
		}
	}
	return [...importedByByPackage.entries()]
		.map(([name, importedBy]) => ({
			name,
			importedBy: [...importedBy].sort((a, b) => a.localeCompare(b)),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function buildSummary(
	files: CodeStructureFile[],
	edges: CodeStructureEdge[],
	packages: CodeStructurePackage[],
) {
	return {
		fileCount: files.length,
		parsedFileCount: files.filter((file) => file.parseStatus === "parsed")
			.length,
		skippedFileCount: files.filter((file) => file.parseStatus === "skipped")
			.length,
		importEdgeCount: edges.filter((edge) => edge.kind === "imports").length,
		packageDependencyCount: packages.length,
		exportedSymbolCount: files.reduce(
			(total, file) => total + file.exportedSymbols.length,
			0,
		),
		routeFileCount: files.filter((file) => file.tags.includes("route")).length,
		handlerFileCount: files.filter((file) => file.tags.includes("handler"))
			.length,
		schemaFileCount: files.filter((file) => file.tags.includes("schema"))
			.length,
		workerFileCount: files.filter((file) => file.tags.includes("worker"))
			.length,
		testFileCount: files.filter((file) => file.tags.includes("test")).length,
		configFileCount: files.filter((file) => file.tags.includes("config"))
			.length,
	};
}

function tagsForFile(
	file: Pick<CodeStructureFile, "path" | "imports" | "exportedSymbols">,
): CodeStructureFileTag[] {
	const tags = new Set<CodeStructureFileTag>();
	const lowerPath = file.path.toLowerCase();
	const basename = path.posix.basename(lowerPath);
	if (
		lowerPath.includes("/__tests__/") ||
		basename.includes(".test.") ||
		basename.includes(".spec.")
	) {
		tags.add("test");
	}
	if (
		basename.includes("config") ||
		basename.startsWith("vite.") ||
		basename.startsWith("vitest.") ||
		basename.startsWith("eslint.") ||
		basename.startsWith("biome.") ||
		basename.startsWith("tailwind.") ||
		basename.startsWith("postcss.") ||
		lowerPath.includes("/config/")
	) {
		tags.add("config");
	}
	if (
		lowerPath.includes("schema") ||
		lowerPath.includes("schemas") ||
		file.imports.includes("zod") ||
		file.imports.includes("drizzle-orm/sqlite-core")
	) {
		tags.add("schema");
	}
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
	) {
		tags.add("route");
	}
	if (
		file.exportedSymbols.some((symbol) =>
			symbol.toLowerCase().includes("handler"),
		) ||
		file.imports.includes("hono") ||
		lowerPath.includes("handlers")
	) {
		tags.add("handler");
	}
	if (
		lowerPath.includes("worker") ||
		lowerPath.includes("queue") ||
		lowerPath.includes("job") ||
		lowerPath.includes("runner")
	) {
		tags.add("worker");
	}
	if (!(tags.size === 1 && tags.has("config")) && !tags.has("test")) {
		tags.add("source");
	}
	return TAG_ORDER.filter((tag) => tags.has(tag));
}

function resolveRelativeImport(
	importerPath: string,
	specifier: string,
	filePathSet: Set<string>,
): string | null {
	const importerDir = path.posix.dirname(importerPath);
	const normalizedBase = path.posix.normalize(
		path.posix.join(importerDir, specifier),
	);
	const candidates = [
		normalizedBase,
		...RESOLUTION_EXTENSIONS.map(
			(extension) => `${normalizedBase}${extension}`,
		),
		...INDEX_FILENAMES.map((filename) =>
			path.posix.join(normalizedBase, filename),
		),
	];
	for (const candidate of candidates) {
		if (!candidate.startsWith("..") && filePathSet.has(candidate)) {
			return candidate;
		}
	}
	return null;
}

function isRelativeSpecifier(value: string): boolean {
	return value.startsWith("./") || value.startsWith("../");
}

function isPackageSpecifier(value: string): boolean {
	return (
		value.length > 0 && !isRelativeSpecifier(value) && !value.startsWith("/")
	);
}

function normalizePackageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		const parts = specifier.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
	}
	return specifier.split("/")[0] ?? specifier;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
	const extension = path.extname(filePath);
	switch (extension) {
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

function isSupportedSourcePath(filePath: string): boolean {
	return SUPPORTED_EXTENSIONS.has(path.extname(filePath));
}

function isSecretDataPath(filePath: string): boolean {
	const basename = path.basename(filePath);
	return (
		basename === ".env" ||
		basename.startsWith(".env.") ||
		SECRET_FILE_EXTENSIONS.has(path.extname(filePath))
	);
}

function isPathInside(rootPath: string, childPath: string): boolean {
	const relative = path.relative(rootPath, childPath);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function relativePosix(rootPath: string, absolutePath: string): string {
	return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String(error.code);
	}
	return "unknown";
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
