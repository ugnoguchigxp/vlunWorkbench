import type { Value } from "./java-constant-values";
import {
	allNodes,
	first,
	isJavaType,
	type JavaMethod,
	type JavaSource,
	javaText,
} from "./java-source-analysis";
export function resolveJavaHelper(
	program: JavaSource,
	owner: string,
	name: string,
	args: Value[],
	staticOnly: boolean,
	stringArguments: boolean,
): JavaMethod | null {
	if (
		allNodes(program.root, "normalClassDeclaration").filter(
			(node) => javaText(first(node, "typeIdentifier")) === owner,
		).length !== 1
	)
		return null;
	if (args.some((arg) => arg.kind === "list" || arg.kind === "map")) {
		for (const arg of args)
			if (arg.kind === "list" || arg.kind === "map") arg.invalid = true;
		return null;
	}
	const candidates = program.methods.filter(
		(method) =>
			method.owner === owner &&
			method.name === name &&
			method.parameters.length === args.length &&
			(!staticOnly || method.modifiers.includes("static")),
	);
	if (candidates.length !== 1) return null;
	const method = candidates[0];
	if (!method) return null;
	const declaration = allNodes(program.root, "normalClassDeclaration").find(
		(node) => javaText(first(node, "typeIdentifier")) === owner,
	);
	// Without a complete classpath, inherited overloads can change dispatch.
	// String is final: an exact String signature and static argument types
	// establish the selected declaration even when a superclass is unknown.
	if (args.length && first(declaration, "classExtends")) {
		const parameters = allNodes(method.node, "formalParameter");
		if (
			!stringArguments ||
			parameters.length !== args.length ||
			!parameters.every((parameter) =>
				isJavaType(
					program,
					javaText(allNodes(parameter, "unannType")[0]),
					"java.lang.String",
				),
			)
		)
			return null;
	}
	if (
		allNodes(method.body, "normalClassDeclaration").length ||
		allNodes(method.body, "lambdaExpression").length
	)
		return null;
	return method;
}
