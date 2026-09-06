import { ConstantFlow } from "./java-constant-flow";
import {
	isSafe,
	type JavaProofReason,
	known,
	type Value,
} from "./java-constant-values";
import {
	allNodes,
	contains,
	first,
	type JavaMethod,
	type JavaNode,
	type JavaSource,
	javaText,
	literal,
	nodes,
} from "./java-source-analysis";
export function proveJavaSinkSafe(
	program: JavaSource,
	method: JavaMethod,
	start: number,
	end: number,
	rule: string,
): JavaProofReason | null {
	const flow = new ConstantFlow(program, method);
	const environment = flow.before(start);
	if (!environment) return null;
	// Semgrep SQL rules focus the SQL argument; other rules select the whole call.
	const expressions = allNodes(method.body, "expression");
	const exact = expressions.find(
		(node) =>
			node.location.startOffset === start &&
			node.location.endOffset + 1 === end,
	);
	let argumentsToCheck: JavaNode[] = [];
	if (exact && !isSinkCall(javaText(exact), rule)) argumentsToCheck = [exact];
	else {
		const calls = allNodes(method.body, "primary").filter(
			(node) => contains(node, start) && isSinkCall(javaText(node), rule),
		);
		const call = calls.sort(
			(a, b) =>
				a.location.endOffset -
				a.location.startOffset -
				(b.location.endOffset - b.location.startOffset),
		)[0];
		if (!call) return null;
		const invocations = [
			...allNodes(call, "methodInvocationSuffix"),
			...allNodes(call, "unqualifiedClassInstanceCreationExpression"),
		];
		const invocation = invocations.find(
			(node) => node.location.endOffset + 1 === end,
		);
		if (!invocation) return null;
		const list = first(invocation, "argumentList");
		argumentsToCheck = nodes(list, "expression");
		if (rule === "sql-injection" || rule === "xpath-injection")
			argumentsToCheck = argumentsToCheck.slice(0, 1);
		if (rule === "ldap-injection")
			argumentsToCheck = argumentsToCheck.slice(1, 2);
	}
	if (!argumentsToCheck.length) return null;
	const values = argumentsToCheck.map((node) =>
		flow.expression(node, environment),
	);
	if (values.every(isSafe))
		return values.find(known)?.reason ?? "collection_overwrite";
	if (
		rule === "xss-response-writer" &&
		safeHtmlBodyContext(program, method, start, values)
	)
		return "contextual_output_encoding";
	return null;
}

function isSinkCall(text: string, rule: string): boolean {
	const names: Record<string, string> = {
		"sql-injection":
			"prepareStatement|prepareCall|execute|executeQuery|executeUpdate|addBatch|createNativeQuery|createQuery|query|queryForLong|queryForInt|queryForRowSet|queryForMap|queryForList|queryForObject|update|batchUpdate",
		"command-injection": "exec|command|ProcessBuilder",
		"xss-response-writer": "write|print|println|printf|format|append",
		"path-traversal-file":
			"File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile|get|of|readAllBytes|readString|newInputStream|newOutputStream|newBufferedReader|newBufferedWriter|write|delete",
		"ldap-injection": "search",
		"xpath-injection": "evaluate|compile",
		"trust-boundary": "setAttribute|putValue",
	};
	return new RegExp(`(?:\\.|^|new)(?:${names[rule] ?? "(?!)"})\\(`).test(text);
}

// HTML encoding is only sufficient for a complete HTML text-body write. A
// preceding writer call or script/attribute interpolation makes context unknown.
function safeHtmlBodyContext(
	_program: JavaSource,
	method: JavaMethod,
	start: number,
	values: Value[],
): boolean {
	const flattened: Value[] = [];
	const flatten = (value: Value) => {
		if (value.kind === "list" && !value.invalid) value.items.forEach(flatten);
		else flattened.push(value);
	};
	values.forEach(flatten);
	if (
		!flattened.some((v) => v.kind === "html") ||
		!flattened.every(
			(v) =>
				v.kind === "html" ||
				(known(v) && (typeof v.value !== "string" || !v.value.includes("<"))),
		)
	)
		return false;
	const calls = allNodes(method.body, "primary").filter(
		(node) =>
			node.location.endOffset < start && !exitsBeforeSink(method, node, start),
	);
	const contentTypes = calls.filter((node) =>
		/\.setContentType\(/.test(javaText(node)),
	);
	if (
		!contentTypes.length ||
		contentTypes.some(
			(node) =>
				!/^\w+\.setContentType\("text\/html(?:;[^"\r\n]*)?"\)$/.test(
					javaText(node),
				),
		)
	)
		return false;
	const aliases = new Set(
		allNodes(method.body, "localVariableDeclaration")
			.flatMap((node) =>
				nodes(first(node, "variableDeclaratorList"), "variableDeclarator"),
			)
			.filter((node) =>
				/\.getWriter\(\)$/.test(javaText(first(node, "variableInitializer"))),
			)
			.map((node) => javaText(first(node, "variableDeclaratorId"))),
	);
	const outputObjects = new Set([
		...aliases,
		...contentTypes.map((node) => javaText(node).split(".")[0] ?? ""),
	]);
	for (const call of calls) {
		for (const invocation of allNodes(call, "methodInvocationSuffix")) {
			if (
				nodes(first(invocation, "argumentList"), "expression").some(
					(argument) =>
						[...outputObjects].some(
							(name) =>
								name &&
								new RegExp(`(?:^|[^\\w$])${name}(?:$|[^\\w$])`).test(
									javaText(argument),
								),
						),
				)
			)
				return false;
		}
	}
	let markup = "";
	const control = allNodes(method.body, "ifStatement").concat(
		allNodes(method.body, "switchStatement"),
		allNodes(method.body, "basicForStatement"),
		allNodes(method.body, "enhancedForStatement"),
		allNodes(method.body, "whileStatement"),
		allNodes(method.body, "tryStatement"),
	);
	for (const call of calls) {
		const text = javaText(call);
		const output = text.match(
			/^(.*)\.(?:write|print|println|printf|format|append)\(/,
		);
		if (
			!output ||
			(!output[1]?.endsWith(".getWriter()") && !aliases.has(output[1] ?? ""))
		)
			continue;
		if (control.some((node) => contains(node, call.location.startOffset)))
			return false;
		const args = nodes(
			first(allNodes(call, "methodInvocationSuffix").at(-1), "argumentList"),
			"expression",
		);
		if (args.length !== 1) return false;
		const value = literal(javaText(args[0]));
		if (typeof value !== "string") return false;
		markup += value;
		if (markup.length > 65536) return false;
	}
	return endsInHtmlText(markup);
}

function endsInHtmlText(markup: string): boolean {
	let offset = 0;
	while (offset < markup.length) {
		const opening = markup.indexOf("<", offset);
		if (opening < 0) return true;
		const rest = markup.slice(opening);
		const comment = rest.match(/^<!--[\s\S]*?-->/);
		if (comment) {
			offset = opening + comment[0].length;
			continue;
		}
		const doctype = rest.match(/^<!doctype\s+html\s*>/i);
		if (doctype) {
			offset = opening + doctype[0].length;
			continue;
		}
		const tag = rest.match(
			/^<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)?\s*\/?>/,
		);
		if (!tag) return false;
		offset = opening + tag[0].length;
		if (
			!tag[0].startsWith("</") &&
			/^(?:script|style|xmp|iframe|noembed|noframes|noscript|plaintext)$/i.test(
				tag[1] ?? "",
			)
		) {
			if (tag[1]?.toLowerCase() === "plaintext") return false;
			const closing = markup
				.slice(offset)
				.match(new RegExp(`</${tag[1]}\\s*>`, "i"));
			if (!closing) return false;
			offset += (closing.index ?? 0) + closing[0].length;
		}
	}
	return true;
}

// A completed return branch cannot have contributed bytes to a later write.
// Exception/finally control flow is deliberately excluded from this shortcut.
function exitsBeforeSink(
	method: JavaMethod,
	call: JavaNode,
	start: number,
): boolean {
	if (
		allNodes(method.body, "tryStatement").some((node) =>
			contains(node, call.location.startOffset),
		)
	)
		return false;
	return allNodes(method.body, "ifStatement").some(
		(conditional) =>
			conditional.location.endOffset < start &&
			nodes(conditional, "statement").some((branch) => {
				const block = allNodes(branch, "block")[0];
				if (!block || !contains(block, call.location.startOffset)) return false;
				const last = nodes(
					first(block, "blockStatements"),
					"blockStatement",
				).at(-1);
				return /^return(?:;|[\s\S]*;)$/.test(javaText(last));
			}),
	);
}
