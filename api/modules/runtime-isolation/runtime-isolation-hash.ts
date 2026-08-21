import crypto from "node:crypto";

export function canonicalRuntimeJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map(canonicalRuntimeJson).join(",")}]`;
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalRuntimeJson(object[key])}`)
		.join(",")}}`;
}

export function runtimeIsolationHash(value: unknown): string {
	return `sha256:${crypto.createHash("sha256").update(canonicalRuntimeJson(value)).digest("hex")}`;
}
