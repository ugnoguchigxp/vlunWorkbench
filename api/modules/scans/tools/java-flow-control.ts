import {
	type Environment,
	known,
	mergeEnvironment,
	mergeValue,
	UNKNOWN,
	type Value,
} from "./java-constant-values";
import {
	allNodes,
	contains,
	descendants,
	first,
	type JavaMethod,
	type JavaNode,
	type JavaSource,
	javaText,
	nodes,
	tokens,
} from "./java-source-analysis";
export abstract class JavaFlowControl {
	protected unsupportedNumericVariables = new Set<string>();
	protected variableTypes = new Map<string, string>();
	constructor(
		protected program: JavaSource,
		protected method: JavaMethod,
		protected depth = 0,
		protected allowProcessProperties = true,
		protected budget = { remaining: 20_000 },
	) {
		for (const declaration of allNodes(method.node, "localVariableDeclaration"))
			if (
				/^(?:long|double|float)$/.test(
					javaText(first(declaration, "localVariableType")),
				)
			)
				for (const variable of allNodes(declaration, "variableDeclaratorId"))
					this.unsupportedNumericVariables.add(javaText(variable));
		for (const parameter of allNodes(method.node, "formalParameter"))
			if (
				allNodes(parameter, "unannType").some((node) =>
					/^(?:long|double|float)$/.test(javaText(node)),
				)
			)
				for (const variable of allNodes(parameter, "variableDeclaratorId"))
					this.unsupportedNumericVariables.add(javaText(variable));
		for (const declaration of [
			...allNodes(method.node, "localVariableDeclaration"),
			...allNodes(method.node, "formalParameter"),
		]) {
			const type = javaText(
				first(declaration, "localVariableType") ??
					allNodes(declaration, "unannType")[0],
			);
			for (const variable of allNodes(declaration, "variableDeclaratorId")) {
				const name = javaText(variable);
				const previous = this.variableTypes.get(name);
				if (
					previous !== undefined ||
					/^(?:java\.lang\.)?(?:Object|Integer|Long|Float|Double|Short|Byte|Character|Boolean)$/.test(
						type,
					)
				)
					this.unsupportedNumericVariables.add(name);
				this.variableTypes.set(
					name,
					previous === undefined || previous === type ? type : "",
				);
			}
		}
		this.allowProcessProperties &&= ![
			program,
			...(program.dependencies ?? []),
		].some((source) =>
			/\bSystem\s*\.\s*setPropert(?:y|ies)\s*\(/.test(source.source),
		);
	}
	before(offset: number): Environment | null {
		const env: Environment = new Map(
			this.method.parameters.map((name) => [name, UNKNOWN]),
		);
		return this.toOffset(this.method.body, env, offset);
	}
	protected toOffset(
		node: JavaNode,
		env: Environment,
		offset: number,
	): Environment | null {
		if (--this.budget.remaining < 0) return null;
		if (node.name === "block" || node.name === "blockStatements") {
			const statements =
				node.name === "block"
					? nodes(first(node, "blockStatements"), "blockStatement")
					: nodes(node, "blockStatement");
			for (const statement of statements) {
				if (contains(statement, offset))
					return this.toOffset(statement, env, offset);
				if (statement.location.endOffset < offset)
					this.statement(statement, env);
			}
			return env;
		}
		if (node.name === "ifStatement") {
			const condition = first(node, "expression");
			if (contains(condition, offset)) return null;
			this.expression(condition, env);
			const branch = nodes(node, "statement").find((child) =>
				contains(child, offset),
			);
			return branch ? this.toOffset(branch, env, offset) : null;
		}
		if (node.name === "tryStatement") {
			const block = first(node, "block");
			if (contains(block, offset) && block)
				return this.toOffset(block, env, offset);
			this.invalidate(node, env);
			const nested = descendants(node, "block").find((child) =>
				contains(child, offset),
			);
			return nested ? this.toOffset(nested, env, offset) : null;
		}
		if (
			/^(?:basicForStatement|enhancedForStatement|whileStatement|doStatement|switchStatement|synchronizedStatement)$/.test(
				node.name,
			)
		)
			return null;
		if (
			/^(?:expressionStatement|localVariableDeclarationStatement|returnStatement)$/.test(
				node.name,
			)
		)
			return env;
		const children = nodes(node).filter((child) => contains(child, offset));
		return children.length === 1
			? this.toOffset(children[0] as JavaNode, env, offset)
			: null;
	}
	private statement(
		node: JavaNode | undefined,
		env: Environment,
	): Value | null {
		if (!node) return null;
		if (--this.budget.remaining < 0) {
			env.clear();
			return UNKNOWN;
		}
		if (node.name === "block" || node.name === "blockStatements") {
			const list =
				node.name === "block" ? first(node, "blockStatements") : node;
			for (const child of nodes(list, "blockStatement")) {
				const result = this.statement(child, env);
				if (result) return result;
			}
			return null;
		}
		if (node.name === "localVariableDeclaration") {
			for (const declaration of nodes(
				first(node, "variableDeclaratorList"),
				"variableDeclarator",
			)) {
				const name = javaText(first(declaration, "variableDeclaratorId"));
				const value = /^(?:long|double|float)$/.test(
					javaText(first(node, "localVariableType")),
				)
					? UNKNOWN
					: this.expression(first(declaration, "variableInitializer"), env);
				// Shadowing requires lexical bindings; avoid claiming a proof for it.
				env.set(name, env.has(name) ? UNKNOWN : value);
			}
			return null;
		}
		if (node.name === "expressionStatement") {
			this.expression(
				first(first(node, "statementExpression"), "expression"),
				env,
			);
			return null;
		}
		if (node.name === "returnStatement")
			return this.expression(first(node, "expression"), env);
		if (node.name === "ifStatement") {
			const value = this.expression(first(node, "expression"), env);
			const branches = nodes(node, "statement");
			if (known(value) && typeof value.value === "boolean")
				return this.statement(branches[value.value ? 0 : 1], env);
			const left = structuredClone(env),
				right = structuredClone(env);
			const a = branches[0] ? this.statement(branches[0], left) : null;
			const b = branches[1] ? this.statement(branches[1], right) : null;
			if (a && b) {
				env.clear();
				return mergeValue(a, b);
			}
			if (a || b) {
				const continuing = a ? right : left;
				env.clear();
				for (const [name, value] of continuing) env.set(name, value);
				return null;
			}
			mergeEnvironment(env, left, right);
			return null;
		}
		if (node.name === "switchStatement") {
			const value = this.expression(first(node, "expression"), env);
			const groups = nodes(
				first(node, "switchBlock"),
				"switchBlockStatementGroup",
			);
			if (!known(value) || value.value === undefined || !groups.length) {
				this.invalidate(node, env);
				return null;
			}
			let selected = groups.findIndex((group) =>
				nodes(group, "switchLabel").some(
					(label) =>
						javaText(label) === `case${JSON.stringify(value.value)}` ||
						(typeof value.value === "string" &&
							javaText(label) === `case'${value.value}'`),
				),
			);
			if (selected < 0)
				selected = groups.findIndex((group) =>
					nodes(group, "switchLabel").some(
						(label) => javaText(label) === "default",
					),
				);
			if (selected < 0) return null;
			for (const group of groups.slice(selected)) {
				for (const child of nodes(
					first(group, "blockStatements"),
					"blockStatement",
				)) {
					if (descendants(child, "breakStatement").length) {
						if (javaText(child) !== "break;") this.invalidate(node, env);
						for (const [name, entry] of env)
							if (known(entry))
								env.set(name, { ...entry, reason: "constant_switch" });
						return null;
					}
					const returned = this.statement(child, env);
					if (returned) return returned;
				}
			}
			return null;
		}
		if (
			/^(?:tryStatement|basicForStatement|enhancedForStatement|whileStatement|doStatement|synchronizedStatement|throwStatement|lambdaExpression|classDeclaration)$/.test(
				node.name,
			)
		) {
			this.invalidate(node, env);
			return null;
		}
		const children = nodes(node);
		if (children.length === 1) return this.statement(children[0], env);
		if (children.length) this.invalidate(node, env);
		return null;
	}
	protected invalidate(node: JavaNode, env: Environment) {
		for (const token of tokens(node)) {
			const value = env.get(token.image);
			if (value?.kind === "list" || value?.kind === "map") value.invalid = true;
		}
		for (const assignment of descendants(node, "binaryExpression")) {
			if (assignment.children.AssignmentOperator)
				env.set(javaText(first(assignment, "unaryExpression")), UNKNOWN);
		}
		for (const expression of descendants(node, "unaryExpression")) {
			if (/\+\+|--/.test(javaText(expression)))
				for (const token of tokens(expression))
					if (env.has(token.image)) env.set(token.image, UNKNOWN);
		}
		for (const declaration of descendants(node, "variableDeclarator"))
			env.set(javaText(first(declaration, "variableDeclaratorId")), UNKNOWN);
	}
	abstract expression(node: JavaNode | undefined, env: Environment): Value;
}
