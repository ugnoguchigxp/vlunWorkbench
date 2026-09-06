export type JavaProofReason =
	| "constant_branch"
	| "constant_switch"
	| "collection_overwrite"
	| "constant_interprocedural_flow"
	| "contextual_output_encoding";
export type Scalar = {
	kind: "scalar";
	value?: string | number | boolean | null;
	reason: JavaProofReason;
	javaType?: "file" | "file-descriptor" | "class-loader" | "url";
};
export type Value =
	| Scalar
	| { kind: "unknown" }
	| { kind: "html" }
	| { kind: "instance"; owner: string }
	| { kind: "factory"; key: string }
	| { kind: "list"; items: Value[]; invalid?: boolean }
	| { kind: "map"; items: Map<string, Value>; invalid?: boolean };
export type Environment = Map<string, Value>;
export const UNKNOWN: Value = { kind: "unknown" };
export const safe = (
	value?: Scalar["value"],
	reason: JavaProofReason = "constant_branch",
): Scalar => ({ kind: "scalar", value, reason });
export const known = (value: Value): value is Scalar => value.kind === "scalar";
export const isSafe = (value: Value): boolean =>
	known(value) ||
	((value.kind === "list" || value.kind === "map") &&
		!value.invalid &&
		[...(value.kind === "list" ? value.items : value.items.values())].every(
			isSafe,
		));

export function collectionCall(
	receiver: Extract<Value, { kind: "list" | "map" }>,
	name: string,
	args: Value[],
): Value {
	if (receiver.invalid) return UNKNOWN;
	if (receiver.kind === "list") {
		const index = known(args[0] ?? UNKNOWN)
			? (args[0] as Scalar).value
			: undefined;
		if (name === "add" && args.length === 1) {
			receiver.items.push(args[0] ?? UNKNOWN);
			return safe(true);
		}
		if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
			if (
				name === "get" &&
				args.length === 1 &&
				index < receiver.items.length
			) {
				const value = receiver.items[index] ?? UNKNOWN;
				return known(value)
					? { ...value, reason: "collection_overwrite" }
					: value;
			}
			if (
				name === "add" &&
				args.length === 2 &&
				index <= receiver.items.length
			) {
				receiver.items.splice(index, 0, args[1] ?? UNKNOWN);
				return safe();
			}
			if (
				name === "set" &&
				args.length === 2 &&
				index < receiver.items.length
			) {
				receiver.items[index] = args[1] ?? UNKNOWN;
				return UNKNOWN;
			}
			if (
				name === "remove" &&
				args.length === 1 &&
				index < receiver.items.length
			)
				return receiver.items.splice(index, 1)[0] ?? UNKNOWN;
		}
	} else {
		const key = known(args[0] ?? UNKNOWN)
			? (args[0] as Scalar).value
			: undefined;
		if (typeof key === "string") {
			if (name === "put" && args.length === 2) {
				receiver.items.set(key, args[1] ?? UNKNOWN);
				return UNKNOWN;
			}
			if (name === "get" && args.length === 1) {
				const value = receiver.items.get(key) ?? UNKNOWN;
				return known(value)
					? { ...value, reason: "collection_overwrite" }
					: value;
			}
		}
	}
	receiver.invalid = true;
	return UNKNOWN;
}

export function mergeValue(left: Value, right: Value): Value {
	if (known(left) && known(right))
		return {
			...safe(left.value === right.value ? left.value : undefined, left.reason),
			javaType:
				left.javaType === right.javaType
					? left.javaType
					: left.value === null
						? right.javaType
						: right.value === null
							? left.javaType
							: undefined,
		};
	if (left.kind === "html" && right.kind === "html") return left;
	if (
		left.kind === "list" &&
		right.kind === "list" &&
		!left.invalid &&
		!right.invalid &&
		left.items.length === right.items.length
	)
		return {
			kind: "list",
			items: left.items.map((value, index) =>
				mergeValue(value, right.items[index] ?? UNKNOWN),
			),
		};
	if (
		left.kind === "map" &&
		right.kind === "map" &&
		!left.invalid &&
		!right.invalid
	)
		return {
			kind: "map",
			items: new Map(
				[...left.items].map(([key, value]) => [
					key,
					mergeValue(value, right.items.get(key) ?? UNKNOWN),
				]),
			),
		};
	return UNKNOWN;
}
export function mergeEnvironment(
	target: Environment,
	left: Environment,
	right: Environment,
) {
	for (const key of new Set([...left.keys(), ...right.keys()]))
		target.set(
			key,
			mergeValue(left.get(key) ?? UNKNOWN, right.get(key) ?? UNKNOWN),
		);
	// Branch cloning loses alias identity. No mutable value may retain a proof
	// across a join when it has more than one local binding.
	for (const branch of [left, right]) {
		const seen = new Map<Value, string>();
		for (const [key, value] of branch)
			if (value.kind === "list" || value.kind === "map") {
				const other = seen.get(value);
				if (other) {
					target.set(key, UNKNOWN);
					target.set(other, UNKNOWN);
				} else seen.set(value, key);
			}
	}
}

export function binaryValues(values: Value[], operators: string[]): Value {
	const precedence: Record<string, number> = {
		"||": 1,
		"&&": 2,
		"==": 3,
		"!=": 3,
		"<": 4,
		">": 4,
		"<=": 4,
		">=": 4,
		"+": 5,
		"-": 5,
		"*": 6,
		"/": 6,
		"%": 6,
	};
	if (
		values.length !== operators.length + 1 ||
		operators.some((op) => !precedence[op])
	)
		return UNKNOWN;
	const stack: Value[] = [values[0] ?? UNKNOWN],
		ops: string[] = [];
	const reduce = () => {
		const op = ops.pop() ?? "",
			b = stack.pop() ?? UNKNOWN,
			a = stack.pop() ?? UNKNOWN;
		stack.push(binary(a, op, b));
	};
	for (let index = 0; index < operators.length; index++) {
		const op = operators[index] ?? "";
		while (
			ops.length &&
			(precedence[ops.at(-1) ?? ""] ?? 0) >= (precedence[op] ?? 0)
		)
			reduce();
		ops.push(op);
		stack.push(values[index + 1] ?? UNKNOWN);
	}
	while (ops.length) reduce();
	return stack[0] ?? UNKNOWN;
}
function binary(a: Value, op: string, b: Value): Value {
	if (
		op === "+" &&
		((a.kind === "html" &&
			known(b) &&
			typeof b.value === "string" &&
			!b.value.includes("<")) ||
			(b.kind === "html" &&
				known(a) &&
				typeof a.value === "string" &&
				!a.value.includes("<")))
	)
		return { kind: "html" };
	if (!known(a) || !known(b)) return UNKNOWN;
	const x = a.value,
		y = b.value;
	if (
		(op === "==" || op === "!=") &&
		(x === null || y === null) &&
		x !== undefined &&
		y !== undefined
	)
		return safe(op === "==" ? x === y : x !== y);
	if (x === undefined || y === undefined)
		return ["+", "-", "*", "/", "%"].includes(op) ? safe() : UNKNOWN;
	if (op === "+" && (typeof x === "string" || typeof y === "string"))
		return safe(String(x) + String(y), a.reason);
	if (typeof x === "number" && typeof y === "number") {
		switch (op) {
			case "+":
				return safe((x + y) | 0);
			case "-":
				return safe((x - y) | 0);
			case "*":
				return safe(Math.imul(x, y));
			case "/":
				return y ? safe(Math.trunc(x / y) | 0) : UNKNOWN;
			case "%":
				return y ? safe(x % y) : UNKNOWN;
			case ">":
				return safe(x > y);
			case "<":
				return safe(x < y);
			case ">=":
				return safe(x >= y);
			case "<=":
				return safe(x <= y);
		}
	}
	if (typeof x === "boolean" && typeof y === "boolean") {
		if (op === "&&") return safe(x && y);
		if (op === "||") return safe(x || y);
	}
	if (
		typeof x === typeof y &&
		typeof x !== "string" &&
		(op === "==" || op === "!=")
	)
		return safe(op === "==" ? x === y : x !== y);
	return UNKNOWN;
}
