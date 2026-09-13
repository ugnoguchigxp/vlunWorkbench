import { readdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const inventory: object[] = [];
const reviews = JSON.parse(
	await readFile("spec/decisions/route-contract-review.json", "utf8"),
) as { reviewedFiles: Record<string, string> };
for (const name of (await readdir("api/routes"))
	.filter((name) => name.endsWith(".ts") && !name.includes(".test."))
	.sort()) {
	const file = `api/routes/${name}`;
	const text = await readFile(file, "utf8");
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			/^(get|post|put|patch|delete)$/.test(node.expression.name.text) &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		) {
			// Inspect this call's arguments, not its preceding chained route calls.
			const argumentsText = node.arguments
				.slice(1)
				.map((argument) => argument.getText(source))
				.join("\n");
			const validators = [
				...new Set(
					argumentsText.match(
						/\w+(?:Schema|schema)\.(?:safeParse|parse)|zValidator|readJsonBody/g,
					) ?? [],
				),
			];
			const ownership = [
				...new Set(
					argumentsText.match(
						/ownerUserId|assert\w*Owner\w*|check\w*Ownership|requireAdmin|getAuthContextUser/g,
					) ?? [],
				),
			];
			if (!reviews.reviewedFiles[file])
				throw new Error(`route_review_missing:${file}`);
			inventory.push({
				file,
				line:
					source.getLineAndCharacterOfPosition(
						node.expression.name.getStart(source),
					).line + 1,
				method: node.expression.name.text.toUpperCase(),
				relativePath: node.arguments[0].text,
				validators,
				inputAccess: [
					...new Set(
						argumentsText.match(
							/(?:\w+\.req\.(?:param|query|queries|json|text|valid)\([^)]*\)|zValidator\([^,]+,\s*[\w.]+|readJson\w*\([^)]*\))/g,
						) ?? [],
					),
				],
				validationLocation: file,
				boundaryReview: reviews.reviewedFiles[file],
				authorizationMarkers: ownership,
				delegatedHandlers: node.arguments
					.slice(1)
					.filter(ts.isIdentifier)
					.map((argument) => argument.text),
				review:
					"Markers are navigation aids, not proof of validation or authorization. Parent middleware and delegated services must also be reviewed.",
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}
const output = "spec/generated/route-contract-inventory.json";
const serialized = `${JSON.stringify({ schemaVersion: 1, scope: "Literal Hono route registrations; dynamic and mounted prefixes require composition review.", routes: inventory }, null, 2)}\n`;
if (process.argv.includes("--check")) {
	if ((await readFile(output, "utf8")) !== serialized)
		throw new Error("route_contract_inventory_stale");
} else await writeFile(output, serialized);
console.log(JSON.stringify({ routes: inventory.length, output }));
