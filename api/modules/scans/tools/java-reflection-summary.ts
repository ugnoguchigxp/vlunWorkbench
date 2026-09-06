import {
	allNodes,
	first,
	type JavaMethod,
	javaText,
	nodes,
	tokens,
} from "./java-source-analysis";

export type JavaFactoryPlan = {
	resource: string;
	key: string;
	prefix: string;
	fallbacks: string[];
};

// Summarize a narrow configuration-driven factory idiom. Every reference to
// the Properties, class-name, Class, Constructor and instance locals is counted
// so a mutation or an alias cannot silently change the selected implementation.
export function configuredFactoryPlan(
	method: JavaMethod,
): JavaFactoryPlan | null {
	if (!method.modifiers.includes("static") || method.parameters.length)
		return null;
	const declarations = allNodes(
		method.body,
		"localVariableDeclaration",
	).flatMap((node) =>
		nodes(first(node, "variableDeclaratorList"), "variableDeclarator").map(
			(declaration) => ({
				name: javaText(first(declaration, "variableDeclaratorId")),
				initializer: javaText(first(declaration, "variableInitializer")),
			}),
		),
	);
	const props = declarations.filter((item) =>
		/^(?:newProperties|newjava\.util\.Properties)\(\)$/.test(item.initializer),
	);
	if (props.length !== 1) return null;
	const properties = props[0]?.name ?? "";
	const allTokens = tokens(method.body);
	const references = (name: string) =>
		allTokens.filter((token) => token.image === name).length;
	if (references(properties) !== 3) return null;
	const resourceCalls = allNodes(method.body, "primary")
		.map(javaText)
		.filter((text) =>
			text.startsWith(
				`${method.owner}.class.getClassLoader().getResourceAsStream(`,
			),
		);
	if (resourceCalls.length !== 1) return null;
	const resourceLiteral = resourceCalls[0]?.match(
		/getResourceAsStream\(("(?:[^"\\]|\\.)*")\)$/,
	)?.[1];
	const stream = allNodes(method.body, "resource").find((node) =>
		javaText(node).includes(resourceCalls[0] ?? "missing"),
	);
	const streamName = javaText(allNodes(stream, "variableDeclaratorId")[0]);
	if (
		!streamName ||
		!javaText(method.body).includes(`${properties}.load(${streamName});`)
	)
		return null;
	const selection = declarations.find((item) =>
		item.initializer.includes(`${properties}.getProperty(`),
	);
	if (!selection || references(selection.name) !== 2) return null;
	const property = selection.initializer.match(
		/^((?:"(?:[^"\\]|\\.)*"))\+(\w+)\.getProperty\(("(?:[^"\\]|\\.)*")\)$/,
	);
	if (!property || property[2] !== properties) return null;
	const classLocal = declarations.find(
		(item) =>
			item.initializer === `Class.forName(${selection.name})` ||
			item.initializer === `java.lang.Class.forName(${selection.name})`,
	);
	if (!classLocal || references(classLocal.name) !== 2) return null;
	const constructorNode = declarations.find(
		(item) => item.initializer === `${classLocal.name}.getConstructor()`,
	);
	if (!constructorNode || references(constructorNode.name) !== 2) return null;
	const instance = declarations.find(
		(item) => item.initializer === `${constructorNode.name}.newInstance()`,
	);
	if (!instance || references(instance.name) !== 2) return null;
	const returns = allNodes(method.body, "returnStatement").map(javaText);
	const fallbacks: string[] = [];
	for (const statement of returns) {
		if (
			new RegExp(`^return(?:\\([\\w$.]+\\))?${instance.name};$`).test(statement)
		)
			continue;
		const fallback = statement.match(/^returnnew([\w$.]+)\(\);$/)?.[1];
		if (!fallback) return null;
		fallbacks.push(fallback);
	}
	if (!returns.length || fallbacks.length > 8) return null;
	try {
		const resource = JSON.parse(resourceLiteral ?? ""),
			prefix = JSON.parse(property[1] ?? ""),
			key = JSON.parse(property[3] ?? "");
		if (
			typeof resource !== "string" ||
			typeof key !== "string" ||
			!/^(?:[A-Za-z_$][\w$]*\.)+$/.test(prefix)
		)
			return null;
		return { resource, key, prefix, fallbacks };
	} catch {
		return null;
	}
}
