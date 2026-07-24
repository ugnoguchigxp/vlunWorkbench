import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoots = ["api", "scripts"];
const sqliteModules = new Set([
	"bun:sqlite",
	"node:sqlite",
	"sqlite3",
	"better-sqlite3",
]);
const allowedBunSqliteImports = new Set([
	"api/db/index.ts",
	"api/db/testing/connection.ts",
	"api/db/writer/internal/connection.ts",
	// Backup verification opens an operator-selected snapshot read-only.
	"api/operations/database-backup.ts",
]);
const allowedDatabaseConstructors = new Set([
	"api/db/index.ts",
	"api/db/testing/connection.ts",
	"api/db/writer/internal/connection.ts",
	"api/operations/database-backup.ts",
]);
const allowedRawMutationFiles = new Set([
	"api/db/testing/connection.ts",
	"api/db/writer/internal/connection.ts",
	"api/db/writer/server.ts",
	// Only a connection-local query_only PRAGMA is executed in this file.
	"api/operations/database-backup.ts",
]);
const failures: string[] = [];

function filesUnder(directory: string): string[] {
	const output: string[] = [];
	for (const entry of fs.readdirSync(path.join(root, directory), {
		withFileTypes: true,
	})) {
		const relative = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...filesUnder(relative));
		else if (
			entry.isFile() &&
			entry.name.endsWith(".ts") &&
			!entry.name.endsWith(".test.ts") &&
			!entry.name.endsWith(".e2e.test.ts")
		) {
			output.push(relative);
		}
	}
	return output;
}

function report(file: string, node: ts.Node, message: string): void {
	const source = node.getSourceFile();
	const { line, character } = source.getLineAndCharacterOfPosition(
		node.getStart(),
	);
	failures.push(`${file}:${line + 1}:${character + 1} ${message}`);
}

for (const file of sourceRoots.flatMap(filesUnder)) {
	const absolute = path.join(root, file);
	const text = fs.readFileSync(absolute, "utf8");
	const source = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	function visit(node: ts.Node): void {
		if (
			ts.isImportDeclaration(node) &&
			ts.isStringLiteral(node.moduleSpecifier) &&
			sqliteModules.has(node.moduleSpecifier.text) &&
			!node.importClause?.isTypeOnly &&
			(node.moduleSpecifier.text !== "bun:sqlite" ||
				!allowedBunSqliteImports.has(file))
		) {
			report(file, node, "SQLite module import is outside the DB boundary.");
		}

		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "Database" &&
			!allowedDatabaseConstructors.has(file)
		) {
			report(file, node, "Database construction is outside the DB boundary.");
		}

		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const method = node.expression.name.text;
			const receiver = node.expression.expression.getText(source);
			if (
				method === "transaction" &&
				file !== "api/db/index.ts" &&
				!file.startsWith("api/db/writer/")
			) {
				report(
					file,
					node,
					"Cross-process transaction callbacks are forbidden; use an atomic Writer batch.",
				);
			}
			if (
				(method === "exec" || method === "run") &&
				(receiver === "sqlite" || receiver.endsWith(".sqlite")) &&
				!allowedRawMutationFiles.has(file)
			) {
				if (file !== "api/db/index.ts") {
					report(file, node, `Raw SQLite ${method} is outside the Writer.`);
				} else {
					const sqlArgument = node.arguments[0];
					const sqlText =
						sqlArgument &&
						(ts.isStringLiteral(sqlArgument) ||
							ts.isNoSubstitutionTemplateLiteral(sqlArgument))
							? sqlArgument.text.trimStart()
							: null;
					if (!sqlText?.toLowerCase().startsWith("pragma ")) {
						report(
							file,
							node,
							"Only connection-local PRAGMA calls may use raw SQLite in the read facade.",
						);
					}
				}
			}
		}

		if (ts.isCallExpression(node) && node.arguments.length > 0) {
			const moduleArgument = node.arguments[0];
			const moduleName =
				moduleArgument && ts.isStringLiteral(moduleArgument)
					? moduleArgument.text
					: null;
			const isDynamicImport =
				node.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isRequire =
				ts.isIdentifier(node.expression) && node.expression.text === "require";
			const isBunRequire =
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.expression.getText(source) === "Bun" &&
				node.expression.name.text === "require";
			if (
				moduleName &&
				sqliteModules.has(moduleName) &&
				(isDynamicImport || isRequire || isBunRequire)
			) {
				report(file, node, "Dynamic SQLite loading is forbidden.");
			}
		}

		ts.forEachChild(node, visit);
	}
	visit(source);
}

const dbIndex = fs.readFileSync(path.join(root, "api/db/index.ts"), "utf8");
if (!dbIndex.includes("{ readonly: true, strict: true }")) {
	failures.push(
		"api/db/index.ts must open file-backed runtime connections readonly.",
	);
}
if (!dbIndex.includes("getSqliteWriterClient(databaseUrl)")) {
	failures.push(
		"api/db/index.ts must acquire a SqliteWriterClient for mutations.",
	);
}
if (dbIndex.includes("wrapExternalDatabase")) {
	failures.push(
		"api/db/index.ts must not expose an arbitrary external SQLite connection wrapper.",
	);
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}

console.log("OK SQLite writes are restricted to the Writer boundary.");
