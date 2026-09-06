import {
	binaryValues,
	collectionCall,
	type Environment,
	isSafe,
	known,
	mergeEnvironment,
	mergeValue,
	type Scalar,
	safe,
	UNKNOWN,
	type Value,
} from "./java-constant-values";
import { JavaFlowControl } from "./java-flow-control";
import { resolveJavaHelper } from "./java-helper-resolution";
import {
	allNodes,
	descendants,
	first,
	isJavaType,
	type JavaNode,
	javaText,
	literal,
	nodes,
	parseJavaExpression,
	tokens,
} from "./java-source-analysis";
export class ConstantFlow extends JavaFlowControl {
	expression(node: JavaNode | undefined, env: Environment): Value {
		if (!node || --this.budget.remaining < 0) return UNKNOWN;
		const text = javaText(node);
		const constant = literal(text);
		if (constant !== undefined) return safe(constant);
		if (/^[A-Za-z_$][\w$]*$/.test(text))
			return this.unsupportedNumericVariables.has(text)
				? UNKNOWN
				: (env.get(text) ?? UNKNOWN);
		if (
			/^(?:java\.io\.)?File\.separator(?:Char)?$/.test(text) &&
			(text.startsWith("java.io.") ||
				(!env.has("File") && isJavaType(this.program, "File", "java.io.File")))
		)
			return safe();
		if (
			/^java\.util\.Locale\.(?:US|UK|ROOT|ENGLISH|JAPAN|JAPANESE|FRANCE|FRENCH|GERMAN|GERMANY|ITALIAN|ITALY|CHINA|CHINESE|CANADA|KOREA|KOREAN|TAIWAN|SIMPLIFIED_CHINESE|TRADITIONAL_CHINESE)$/.test(
				text,
			)
		)
			return safe();
		if (/^[a-z][\w$.]*\.[A-Z][\w$]*\.[\w$]+$/.test(text) && !text.includes("("))
			return this.field(text);
		if (node.name === "conditionalExpression" && node.children.QuestionMark) {
			const condition = this.expression(first(node, "binaryExpression"), env);
			const branches = nodes(node, "expression");
			if (known(condition) && typeof condition.value === "boolean")
				return this.expression(branches[condition.value ? 0 : 1], env);
			const left = structuredClone(env),
				right = structuredClone(env);
			const result = mergeValue(
				this.expression(branches[0], left),
				this.expression(branches[1], right),
			);
			mergeEnvironment(env, left, right);
			return result;
		}
		if (node.name === "binaryExpression") {
			if (node.children.AssignmentOperator) {
				const name = javaText(first(node, "unaryExpression"));
				const op = (node.children.AssignmentOperator[0] as { image?: string })
					?.image;
				const result =
					op === "=" && !this.unsupportedNumericVariables.has(name)
						? this.expression(first(node, "expression"), env)
						: UNKNOWN;
				if (/^[A-Za-z_$][\w$]*$/.test(name)) env.set(name, result);
				else this.invalidate(node, env);
				return result;
			}
			const operands = nodes(node, "unaryExpression");
			const operators = (node.children.BinaryOperator ?? []).map(
				(t) => (t as { image: string }).image,
			);
			if (
				operators.some((op) => op === "&&" || op === "||") &&
				/(?:=(?!=)|\+\+|--|\w\s*\()/.test(text)
			) {
				this.invalidate(node, env);
				return UNKNOWN;
			}
			if (operators.length)
				return binaryValues(
					operands.map((n) => this.expression(n, env)),
					operators,
				);
		}
		if (node.name === "primary") return this.primary(node, env);
		if (node.name === "castExpression") {
			const cast = first(node);
			if (
				javaText(first(cast, "referenceType")) !== "String" &&
				javaText(first(cast, "referenceType")) !== "java.lang.String"
			)
				return UNKNOWN;
			const nested =
				first(cast, "unaryExpressionNotPlusMinus") ??
				first(cast, "unaryExpression");
			return nested ? this.expression(nested, env) : UNKNOWN;
		}
		if (node.name === "arrayInitializer")
			return {
				kind: "list",
				items: descendants(node, "variableInitializer").map((n) =>
					this.expression(n, env),
				),
			};
		if (node.name === "unaryExpression" && /^(?:[+-]|!)/.test(text)) {
			const value = this.expression(first(node, "primary"), env);
			if (
				known(value) &&
				typeof value.value === "number" &&
				/^-[0-9]+$/.test(text)
			)
				return safe(-value.value);
			if (
				known(value) &&
				typeof value.value === "boolean" &&
				text.startsWith("!")
			)
				return safe(!value.value);
			this.invalidate(node, env);
			return UNKNOWN;
		}
		const children = nodes(node);
		return children.length === 1 ? this.expression(children[0], env) : UNKNOWN;
	}
	private primary(node: JavaNode, env: Environment): Value {
		const prefix = first(node, "primaryPrefix");
		const text = javaText(node);
		if (javaText(prefix).startsWith("new")) {
			const initializer = descendants(prefix, "arrayInitializer")[0];
			if (initializer && !nodes(node, "primarySuffix").length)
				return this.expression(initializer, env);
			const constructorNode = descendants(
				prefix,
				"unqualifiedClassInstanceCreationExpression",
			)[0];
			const className = javaText(
				first(constructorNode, "classOrInterfaceTypeToInstantiate"),
			).replace(/<.*>/g, "");
			const args = nodes(
				first(constructorNode, "argumentList"),
				"expression",
			).map((arg) => this.expression(arg, env));
			const suffixes = nodes(node, "primarySuffix");
			if (
				isJavaType(this.program, className, "java.lang.StringBuilder") &&
				args.length === 1 &&
				known(args[0] ?? UNKNOWN) &&
				/^new(?:java\.lang\.)?StringBuilder\([^()]*\)\.toString\(\)$/.test(text)
			)
				return args[0] ?? UNKNOWN;
			if (
				!suffixes.length &&
				["ArrayList", "LinkedList"].some((name) =>
					isJavaType(this.program, className, `java.util.${name}`),
				) &&
				args.length === 0
			)
				return { kind: "list", items: [] };
			if (
				!suffixes.length &&
				isJavaType(this.program, className, "java.util.HashMap") &&
				args.length === 0
			)
				return { kind: "map", items: new Map() };
			if (
				!suffixes.length &&
				isJavaType(this.program, className, "java.lang.String") &&
				args.length === 1 &&
				isSafe(args[0] ?? UNKNOWN)
			)
				return known(args[0] ?? UNKNOWN) ? (args[0] ?? UNKNOWN) : safe();
			if (
				isJavaType(this.program, className, "java.io.File") &&
				args.length > 0 &&
				args.every(known) &&
				(!suffixes.length ||
					/\.(?:getPath|getAbsolutePath|getCanonicalPath|toString)\(\)$/.test(
						text,
					))
			)
				return { ...safe(), javaType: "file" };
			if (
				isJavaType(this.program, className, "java.net.URI") &&
				[1, 3, 4, 5, 7].includes(args.length) &&
				args.every(known) &&
				!suffixes.length
			)
				return { ...safe(), javaType: "url" };
			if (
				/^java\.io\.FileInputStream$/.test(className) &&
				args.length === 1 &&
				args.every(known) &&
				!suffixes.length
			)
				return { ...safe(), javaType: "file-descriptor" };
			if (
				/^java\.io\.FileOutputStream$/.test(className) &&
				args.length === 1 &&
				args.every(known) &&
				!suffixes.length
			)
				return { ...safe(), javaType: "file-descriptor" };
			const call = text.match(/^new([\w$.]+)(?:<[^>]*>)?\([^)]*\)\.(\w+)\(/);
			if (call && args.length === 0) {
				const invocation = descendants(
					suffixes.at(-1),
					"methodInvocationSuffix",
				)[0];
				const parameters = nodes(
					first(invocation, "argumentList"),
					"expression",
				).map((arg) => this.expression(arg, env));
				if (
					call[1] === "sun.misc.BASE64Encoder" &&
					call[2] === "encode" &&
					parameters.length === 1 &&
					parameters.every(isSafe)
				)
					return safe();
				if (
					call[1] === "sun.misc.BASE64Decoder" &&
					call[2] === "decodeBuffer" &&
					parameters.length === 1 &&
					parameters.every(isSafe)
				)
					return { kind: "list", items: [safe()] };
				return this.helper(call[1] ?? "", call[2] ?? "", parameters);
			}
			for (const arg of args)
				if (arg.kind === "list" || arg.kind === "map") arg.invalid = true;
			if (
				!suffixes.length &&
				[this.program, ...(this.program.dependencies ?? [])].some((program) =>
					program.methods.some(
						(method) => method.owner === className.split(".").at(-1),
					),
				)
			)
				return { kind: "instance", owner: className };
			return UNKNOWN;
		}
		const parenthesis = first(prefix, "parenthesisExpression");
		if (parenthesis && !nodes(node, "primarySuffix").length)
			return this.expression(first(parenthesis, "expression"), env);
		const invocation = descendants(
			nodes(node, "primarySuffix").at(-1),
			"methodInvocationSuffix",
		)[0];
		if (!invocation) {
			const children = nodes(prefix);
			return children.length === 1
				? this.expression(children[0], env)
				: UNKNOWN;
		}
		const argumentNodes = nodes(
			first(invocation, "argumentList"),
			"expression",
		);
		const stringArguments = argumentNodes.every((argument) => {
			const text = javaText(argument);
			return (
				(/^"/.test(text) && typeof literal(text) === "string") ||
				isJavaType(
					this.program,
					this.variableTypes.get(text) ?? "",
					"java.lang.String",
				)
			);
		});
		const args = argumentNodes.map((arg) => this.expression(arg, env));
		const before = tokens(node)
			.filter((t) => t.endOffset < invocation.location.startOffset)
			.map((t) => t.image)
			.join("");
		if (before === "this.getClass().getClassLoader" && args.length === 0)
			return { ...safe(), javaType: "class-loader" };
		const standardMethod = before.match(
			/^(.*)\.(toCharArray|getBytes|length|replace|substring|getPath|toURI|getFD|getResource|getAbsolutePath)$/,
		);
		if (standardMethod) {
			const receiver = this.expression(
				parseJavaExpression(standardMethod[1] ?? ""),
				env,
			);
			const name = standardMethod[2];
			if (receiver.kind === "html" && name === "toCharArray" && !args.length)
				return receiver;
			if (known(receiver) && args.every(known)) {
				if (
					name === "getResource" &&
					receiver.javaType === "class-loader" &&
					args.length === 1
				)
					return { ...safe(), javaType: "url" };
				if (
					receiver.javaType === "url" &&
					/^(?:toURI|getPath)$/.test(name ?? "") &&
					!args.length
				)
					return { ...safe(), javaType: "url" };
				if (
					receiver.javaType === "file-descriptor" &&
					name === "getFD" &&
					!args.length
				)
					return receiver;
				if (
					receiver.javaType === "file" &&
					/^(?:getPath|getAbsolutePath)$/.test(name ?? "") &&
					!args.length
				)
					return safe();
				if (
					!receiver.javaType &&
					[
						"toCharArray",
						"getBytes",
						"length",
						"replace",
						"substring",
					].includes(name ?? "")
				) {
					if (name === "length")
						return safe(
							typeof receiver.value === "string"
								? receiver.value.length
								: undefined,
						);
					if (name === "getBytes") return { kind: "list", items: [safe()] };
					if (name === "toCharArray")
						return {
							kind: "list",
							items:
								typeof receiver.value === "string"
									? [...receiver.value].map((value) => safe(value))
									: [safe()],
						};
					return safe();
				}
			}
		}
		const simple = before.match(/^([\w$]+)\.([\w$]+)$/);
		if (simple) {
			const receiver = env.get(simple[1] ?? "") ?? UNKNOWN;
			const name = simple[2] ?? "";
			if (receiver.kind === "factory") {
				const targets = [
					this.program,
					...(this.program.dependencies ?? []),
				].flatMap((program) => program.factories?.get(receiver.key) ?? []);
				return targets.length
					? targets
							.map((target) =>
								this.helper(
									target.owner,
									name,
									args,
									target.program,
									false,
									stringArguments,
								),
							)
							.reduce(mergeValue)
					: UNKNOWN;
			}
			if (receiver.kind === "instance") {
				const owner = receiver.owner.split(".").at(-1) ?? "";
				const program = receiver.owner.includes(".")
					? this.program.dependencies?.find((program) =>
							program.methods.some((method) => method.owner === owner),
						)
					: this.program;
				return program
					? this.helper(owner, name, args, program, false, stringArguments)
					: UNKNOWN;
			}
			if (receiver.kind === "list" || receiver.kind === "map") {
				if (
					receiver.kind === "list" &&
					name === "remove" &&
					argumentNodes.length === 1 &&
					!/^\d+$/.test(javaText(argumentNodes[0])) &&
					this.variableTypes.get(javaText(argumentNodes[0])) !== "int"
				) {
					receiver.invalid = true;
					return UNKNOWN;
				}
				return collectionCall(receiver, name, args);
			}
			if (
				known(receiver) &&
				receiver.javaType === "file" &&
				/^(?:getPath|getAbsolutePath|getCanonicalPath|toString)$/.test(name) &&
				!args.length
			)
				return safe();
			if (
				known(receiver) &&
				name === "charAt" &&
				typeof receiver.value === "string" &&
				known(args[0] ?? UNKNOWN)
			) {
				const index = (args[0] as Scalar).value;
				return typeof index === "number" &&
					Number.isInteger(index) &&
					index >= 0 &&
					index < receiver.value.length
					? safe(receiver.value[index])
					: UNKNOWN;
			}
		}
		if (
			/^(?:org\.springframework\.web\.util\.HtmlUtils\.htmlEscape|org\.apache\.commons\.(?:lang|lang3|text)\.StringEscapeUtils\.escapeHtml4?|org\.owasp\.esapi\.ESAPI\.encoder\(\)\.encodeForHTML)$/.test(
				before,
			) &&
			args.length === 1
		)
			return known(args[0] ?? UNKNOWN) ? safe() : { kind: "html" };
		if (
			/^(?:java\.lang\.)?System\.getProperty$/.test(before) &&
			args.length === 1 &&
			known(args[0] ?? UNKNOWN) &&
			["os.name", "user.dir", "file.separator"].includes(
				String((args[0] as Scalar).value),
			) &&
			this.allowProcessProperties &&
			(before.startsWith("java.lang.") ||
				(!env.has("System") &&
					isJavaType(this.program, "System", "java.lang.System")))
		)
			return safe();
		const qualified = before.match(/^([a-z][\w$.]*\.[A-Z][\w$]*)\.([\w$]+)$/);
		if (qualified && !env.has(before.split(".")[0] ?? "")) {
			const owner = qualified[1]?.split(".").at(-1) ?? "";
			const dependency = this.program.dependencies?.find((program) =>
				program.methods.some((method) => method.owner === owner),
			);
			if (dependency) {
				const key = `${owner}.${qualified[2] ?? ""}`;
				if (args.length === 0 && dependency.factories?.has(key))
					return { kind: "factory", key };
				return this.helper(
					owner,
					qualified[2] ?? "",
					args,
					dependency,
					true,
					stringArguments,
				);
			}
		}
		if (/^(?:this\.)?[A-Za-z_$][\w$]*$/.test(before)) {
			const name = before.replace(/^this\./, "");
			const candidates = this.program.methods.filter(
				(method) => method.owner === this.method.owner && method.name === name,
			);
			if (
				candidates.length === 1 &&
				candidates[0]?.modifiers.some((modifier) =>
					["private", "static", "final"].includes(modifier),
				)
			)
				return this.helper(
					this.method.owner,
					name,
					args,
					this.program,
					false,
					stringArguments,
				);
		}
		if (before.startsWith(`${this.method.owner}.`) && /^\w+\.\w+$/.test(before))
			return this.helper(
				this.method.owner,
				before.split(".")[1] ?? "",
				args,
				this.program,
				true,
				stringArguments,
			);
		// Unresolved calls may mutate any collection passed to them. They do not
		// become safe merely because one argument happens to be a constant.
		for (const arg of args)
			if (arg.kind === "list" || arg.kind === "map") arg.invalid = true;
		this.invalidate(node, env);
		return UNKNOWN;
	}
	private field(name: string): Value {
		if (this.depth >= 3) return UNKNOWN;
		const parts = name.split("."),
			fieldName = parts.pop(),
			owner = parts.pop();
		const program = this.program.dependencies?.find((program) =>
			program.methods.some((method) => method.owner === owner),
		);
		if (!program || !fieldName) return UNKNOWN;
		const declarations = program.fields
			.filter((field) => field.owner === owner)
			.map((field) => field.node)
			.filter(
				(node) =>
					nodes(node, "fieldModifier").map(javaText).includes("static") &&
					nodes(node, "fieldModifier").map(javaText).includes("final") &&
					javaText(first(node, "unannType")) === "String",
			);
		const variables = declarations
			.flatMap((node) => descendants(node, "variableDeclarator"))
			.filter(
				(node) => javaText(first(node, "variableDeclaratorId")) === fieldName,
			);
		const method = program.methods.find((method) => method.owner === owner);
		if (variables.length !== 1 || !method) return UNKNOWN;
		return new ConstantFlow(
			program,
			method,
			this.depth + 1,
			this.allowProcessProperties,
			this.budget,
		).expression(first(variables[0], "variableInitializer"), new Map());
	}
	private helper(
		owner: string,
		name: string,
		args: Value[],
		program = this.program,
		staticOnly = false,
		stringArguments = false,
	): Value {
		if (this.depth >= 3) return UNKNOWN;
		const method = resolveJavaHelper(
			program,
			owner,
			name,
			args,
			staticOnly,
			stringArguments,
		);
		if (!method) return UNKNOWN;
		const evaluator = new ConstantFlow(
			program,
			method,
			this.depth + 1,
			this.allowProcessProperties,
			this.budget,
		);
		const env: Environment = new Map(
			method.parameters.map((parameter, index) => [
				parameter,
				args[index] ?? UNKNOWN,
			]),
		);
		const returns = allNodes(method.body, "returnStatement");
		if (!returns.length) return UNKNOWN;
		const results = returns.map((node) => {
			const before = evaluator.toOffset(
				method.body,
				structuredClone(env),
				node.location.startOffset,
			);
			return before
				? evaluator.expression(first(node, "expression"), before)
				: UNKNOWN;
		});
		return results.reduce(mergeValue);
	}
}
