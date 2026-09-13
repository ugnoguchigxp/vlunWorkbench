import type {
	sanitizeAttempt,
	sanitizeTask,
} from "./project-intelligence-value-pilot-contract";

export function assertTaskSchedule(
	tasks: ReturnType<typeof sanitizeTask>[],
	attempts: ReturnType<typeof sanitizeAttempt>[],
) {
	if (
		tasks.length !== 10 ||
		new Set(tasks.map((task) => task.id)).size !== 10
	) {
		throw new Error("Pilot report must retain the fixed ten-task task set.");
	}
	for (const attempt of attempts) {
		if (!tasks.some((task) => task.id === attempt.taskId)) {
			throw new Error(
				`Attempt references an unregistered task: ${attempt.taskId}`,
			);
		}
		const expectedFirst =
			Number(attempt.taskId.slice(1)) % 2 === 1 ? "baseline" : "catalog";
		if (attempt.executionOrder[0] !== expectedFirst) {
			throw new Error(
				`Attempt ${attempt.taskId} violates the counterbalanced order.`,
			);
		}
	}
}

export function explorationCalls(mode: "baseline" | "catalog") {
	return (attempt: ReturnType<typeof sanitizeAttempt>) => {
		const measurement = attempt[mode].measurement;
		return (
			measurement.listDirCallsBeforeMutation +
			measurement.searchCallsBeforeMutation +
			measurement.readFileCallsBeforeMutation +
			(mode === "catalog" ? measurement.catalogCallCount : 0)
		);
	};
}

export function median(values: number[]) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

export function reduction(baseline: number | null, catalog: number | null) {
	if (baseline === null || catalog === null || baseline === 0) return null;
	return (baseline - catalog) / baseline;
}

export function failedGateCodes(gates: Record<string, boolean>) {
	return Object.entries(gates)
		.filter(([, passed]) => !passed)
		.map(([name]) => name)
		.sort();
}

export function isComparableAttempt(classification: string) {
	return (
		classification === "valid" || classification === "task_outcome_failure"
	);
}

export function assertKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	name: string,
) {
	const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
	if (unexpected.length > 0) {
		throw new Error(
			`${name} contains forbidden field(s): ${unexpected.join(", ")}`,
		);
	}
	const missing = allowed.filter((key) => !(key in value));
	if (missing.length > 0)
		throw new Error(`${name} is missing field(s): ${missing.join(", ")}`);
}

export function assertSafeCommittedValue(
	value: unknown,
	path = "report",
): void {
	if (typeof value === "string") {
		if (/^(?:[A-Za-z]:\\|\/|file:)/.test(value)) {
			throw new Error(`${path} contains an absolute path.`);
		}
		if (
			/(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]/i.test(
				value,
			)
		) {
			throw new Error(`${path} contains a secret-shaped string.`);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertSafeCommittedValue(item, `${path}[${index}]`);
		}
		return;
	}
	if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) {
			assertSafeCommittedValue(item, `${path}.${key}`);
		}
	}
}

export function sameStringSet(left: string[], right: string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
	return value;
}

export function boolean(value: unknown, name: string) {
	if (typeof value !== "boolean") throw new Error(`${name} must be boolean.`);
	return value;
}

export function integer(value: unknown, name: string) {
	if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
	return value as number;
}

export function positiveInteger(value: unknown, name: string) {
	const result = integer(value, name);
	if (result < 1) throw new Error(`${name} must be positive.`);
	return result;
}

export function nonNegativeInteger(value: unknown, name: string) {
	const result = integer(value, name);
	if (result < 0) throw new Error(`${name} must be non-negative.`);
	return result;
}

export function nullableNonNegativeInteger(value: unknown, name: string) {
	return value === null ? null : nonNegativeInteger(value, name);
}

export function stringArray(value: unknown, name: string) {
	return array(value, name)
		.map((item, index) => code(item, `${name}[${index}]`))
		.sort();
}

export function code(value: unknown, name: string) {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(value)) {
		throw new Error(`${name} must be a safe reason/code string.`);
	}
	return value;
}

export function nonEmptyText(value: unknown, name: string) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${name} must be non-empty text.`);
	}
	return value;
}

export function taskId(value: unknown) {
	if (typeof value !== "string" || !/^p(?:0[1-9]|10)$/.test(value)) {
		throw new Error("Task ID must be one of p01 through p10.");
	}
	return value;
}

export function safePilotId(value: unknown) {
	return code(value, "pilotId");
}

export function classificationValue(value: unknown) {
	const valid = [
		"valid",
		"safety_failure",
		"catalog_reliability_failure",
		"shared_infrastructure_failure",
		"task_outcome_failure",
		"protocol_failure",
	];
	if (typeof value !== "string" || !valid.includes(value)) {
		throw new Error("Unknown attempt classification.");
	}
	return value;
}

export function armValue(value: unknown, name: string): "baseline" | "catalog" {
	if (value !== "baseline" && value !== "catalog")
		throw new Error(`${name} must be an arm.`);
	return value;
}

export function sha(value: unknown, name: string) {
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
		throw new Error(`${name} must be a sha256 fingerprint.`);
	}
	return value;
}

export function gitSha(value: unknown, name: string) {
	if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
		throw new Error(`${name} must be a full Git SHA.`);
	}
	return value;
}

export class DuplicateKeyJsonParser {
	private index = 0;

	constructor(private readonly source: string) {}

	assertDocument() {
		this.skipWhitespace();
		this.value();
		this.skipWhitespace();
		if (this.index !== this.source.length)
			throw new Error("Invalid trailing JSON content.");
	}

	private value(): void {
		this.skipWhitespace();
		const current = this.source[this.index];
		if (current === "{") {
			this.object();
			return;
		}
		if (current === "[") {
			this.array();
			return;
		}
		if (current === '"') {
			this.string();
			return;
		}
		if (current === "-" || (current && /[0-9]/.test(current))) {
			this.number();
			return;
		}
		if (this.source.startsWith("true", this.index)) {
			this.index += 4;
			return;
		}
		if (this.source.startsWith("false", this.index)) {
			this.index += 5;
			return;
		}
		if (this.source.startsWith("null", this.index)) {
			this.index += 4;
			return;
		}
		throw new Error("Invalid JSON value.");
	}

	private object(): void {
		this.index += 1;
		this.skipWhitespace();
		const keys = new Set<string>();
		if (this.source[this.index] === "}") {
			this.index += 1;
			return;
		}
		while (true) {
			this.skipWhitespace();
			if (this.source[this.index] !== '"')
				throw new Error("Invalid JSON object key.");
			const key = this.string();
			if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
			keys.add(key);
			this.skipWhitespace();
			if (this.source[this.index] !== ":")
				throw new Error("Invalid JSON object separator.");
			this.index += 1;
			this.value();
			this.skipWhitespace();
			if (this.source[this.index] === "}") {
				this.index += 1;
				return;
			}
			if (this.source[this.index] !== ",")
				throw new Error("Invalid JSON object delimiter.");
			this.index += 1;
		}
	}

	private array(): void {
		this.index += 1;
		this.skipWhitespace();
		if (this.source[this.index] === "]") {
			this.index += 1;
			return;
		}
		while (true) {
			this.value();
			this.skipWhitespace();
			if (this.source[this.index] === "]") {
				this.index += 1;
				return;
			}
			if (this.source[this.index] !== ",")
				throw new Error("Invalid JSON array delimiter.");
			this.index += 1;
		}
	}

	private string(): string {
		const start = this.index;
		this.index += 1;
		while (this.index < this.source.length) {
			const current = this.source[this.index];
			if (current === "\\") {
				this.index += 2;
				continue;
			}
			if (current === '"') {
				this.index += 1;
				try {
					return JSON.parse(this.source.slice(start, this.index));
				} catch {
					throw new Error("Invalid JSON string.");
				}
			}
			if (current && current.charCodeAt(0) < 0x20)
				throw new Error("Invalid JSON string control character.");
			this.index += 1;
		}
		throw new Error("Unterminated JSON string.");
	}

	private number(): void {
		const match = this.source
			.slice(this.index)
			.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
		if (!match) throw new Error("Invalid JSON number.");
		this.index += match[0].length;
	}

	private skipWhitespace() {
		while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
	}
}
