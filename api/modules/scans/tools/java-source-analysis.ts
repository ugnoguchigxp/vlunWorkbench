import { type CstNode, type IToken, parse } from "java-parser";

export type JavaNode = CstNode;
export type JavaMethod = {
	node: JavaNode;
	body: JavaNode;
	name: string;
	owner: string;
	parameters: string[];
	modifiers: string[];
};
export type JavaSource = {
	root: JavaNode;
	source: string;
	methods: JavaMethod[];
	fields: Array<{ owner: string; node: JavaNode }>;
	dependencies?: JavaSource[];
	factories?: Map<string, Array<{ program: JavaSource; owner: string }>>;
	projectTypeNames?: Set<string>;
	configurationEvidence?: string[];
};
const MAX_SOURCE_BYTES = 1024 * 1024;

// Unsupported syntax and resource limits disable proofs; they never remove a finding.
export function parseJavaSource(source: string): JavaSource | null {
	if (source.length > MAX_SOURCE_BYTES || /\\u+[0-9a-fA-F]{4}|"""/.test(source))
		return null;
	try {
		const root = parse(source);
		const methods: JavaMethod[] = [];
		const fields: JavaSource["fields"] = [];
		function walk(node: JavaNode, owner = "") {
			if (node.name === "normalClassDeclaration")
				owner = javaText(first(node, "typeIdentifier"));
			if (node.name === "fieldDeclaration") fields.push({ owner, node });
			if (node.name === "methodDeclaration") {
				const declarator = descendants(node, "methodDeclarator")[0];
				const body = first(first(node, "methodBody"), "block");
				if (declarator && body)
					methods.push({
						node,
						body,
						owner,
						name:
							tokens(declarator).find((t) => t.tokenType.name === "Identifier")
								?.image ?? "",
						parameters: descendants(
							first(declarator, "formalParameterList"),
							"variableDeclaratorId",
						).map(javaText),
						modifiers: nodes(node, "methodModifier").map(javaText),
					});
				return;
			}
			for (const child of nodes(node)) walk(child, owner);
		}
		walk(root);
		return { root, source, methods, fields };
	} catch {
		return null;
	}
}

export function nodes(node: JavaNode | undefined, key?: string): JavaNode[] {
	const children = key
		? (node?.children[key] ?? [])
		: Object.values(node?.children ?? {}).flat();
	return children
		.flatMap((child) => ("name" in child ? [child as JavaNode] : []))
		.sort((a, b) => a.location.startOffset - b.location.startOffset);
}
export function first(
	node: JavaNode | undefined,
	key?: string,
): JavaNode | undefined {
	return nodes(node, key)[0];
}
export function descendants(
	node: JavaNode | undefined,
	name: string,
): JavaNode[] {
	if (!node) return [];
	if (node.name === name) return [node];
	return nodes(node).flatMap((child) => descendants(child, name));
}
export function allNodes(node: JavaNode | undefined, name: string): JavaNode[] {
	return node
		? [
				...(node.name === name ? [node] : []),
				...nodes(node).flatMap((child) => allNodes(child, name)),
			]
		: [];
}

export function isJavaType(
	program: JavaSource,
	reference: string,
	qualified: string,
): boolean {
	if (reference === qualified) return true;
	const simple = qualified.split(".").at(-1) ?? "";
	if (
		reference !== simple ||
		allNodes(program.root, "normalClassDeclaration").some(
			(node) => javaText(first(node, "typeIdentifier")) === simple,
		)
	)
		return false;
	const imports = allNodes(program.root, "importDeclaration").map(javaText);
	if (imports.includes(`import${qualified};`)) return true;
	if (
		imports.some((imported) => imported.endsWith(`.${simple};`)) ||
		program.projectTypeNames?.has(simple)
	)
		return false;
	return (
		qualified.startsWith("java.lang.") ||
		imports.includes(`import${qualified.slice(0, -simple.length)}*;`)
	);
}
export function tokens(node: JavaNode | undefined): IToken[] {
	return Object.values(node?.children ?? {})
		.flat()
		.flatMap((child) => ("name" in child ? tokens(child) : [child]))
		.sort((a, b) => a.startOffset - b.startOffset);
}
export function javaText(node: JavaNode | undefined): string {
	return tokens(node)
		.map((t) => t.image)
		.join("");
}
export function parseJavaExpression(source: string): JavaNode | undefined {
	if (source.length > 16_384) return undefined;
	try {
		return parse(source, "expression");
	} catch {
		return undefined;
	}
}
export function contains(node: JavaNode | undefined, offset: number): boolean {
	return (
		!!node &&
		node.location.startOffset <= offset &&
		offset <= node.location.endOffset
	);
}
export function methodAt(
	program: JavaSource,
	offset: number,
): JavaMethod | undefined {
	return program.methods.find((method) => contains(method.body, offset));
}
export function literal(
	text: string,
): string | number | boolean | null | undefined {
	if (/^"(?:[^"\\]|\\["\\nrtbf])*"$/.test(text)) {
		try {
			return JSON.parse(text);
		} catch {
			return undefined;
		}
	}
	if (/^'[^'\\]'$/.test(text)) return text.slice(1, -1);
	if (/^'\\[\\'"nrtbf]'$/.test(text))
		return (
			{
				"\\": "\\",
				"'": "'",
				'"': '"',
				n: "\n",
				r: "\r",
				t: "\t",
				b: "\b",
				f: "\f",
			} as Record<string, string>
		)[text[2] ?? ""];
	if (/^(?:0|[1-9][0-9]*)$/.test(text)) {
		const value = Number(text);
		return value <= 2147483647 ? value : undefined;
	}
	if (text === "true" || text === "false") return text === "true";
	if (text === "null") return null;
	return undefined;
}
