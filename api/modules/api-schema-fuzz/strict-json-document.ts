import fs from "node:fs/promises";
import path from "node:path";

export const MAX_STRICT_JSON_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class StrictJsonParser {
	private offset = 0;

	constructor(private readonly source: string) {}

	parse(): unknown {
		const value = this.value(0);
		this.whitespace();
		if (this.offset !== this.source.length) this.fail("trailing_data");
		return value;
	}

	private value(depth: number): unknown {
		if (depth > 128) this.fail("depth_exceeded");
		this.whitespace();
		const char = this.source[this.offset];
		if (char === "{") return this.object(depth + 1);
		if (char === "[") return this.array(depth + 1);
		if (char === '"') return this.string();
		for (const [token, value] of [
			["true", true],
			["false", false],
			["null", null],
		] as const) {
			if (this.source.startsWith(token, this.offset)) {
				this.offset += token.length;
				return value;
			}
		}
		const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
		match.lastIndex = this.offset;
		const number = match.exec(this.source)?.[0];
		if (!number) this.fail("value_invalid");
		this.offset += number.length;
		const parsed = Number(number);
		if (!Number.isFinite(parsed)) this.fail("number_invalid");
		return parsed;
	}

	private object(depth: number): Record<string, unknown> {
		this.offset += 1;
		const result = Object.create(null) as Record<string, unknown>;
		const keys = new Set<string>();
		this.whitespace();
		if (this.take("}")) return result;
		while (true) {
			this.whitespace();
			if (this.source[this.offset] !== '"') this.fail("object_key_invalid");
			const key = this.string();
			if (keys.has(key)) this.fail("duplicate_key");
			if (FORBIDDEN_KEYS.has(key)) this.fail("prototype_key");
			keys.add(key);
			this.whitespace();
			if (!this.take(":")) this.fail("object_colon_missing");
			result[key] = this.value(depth);
			this.whitespace();
			if (this.take("}")) return result;
			if (!this.take(",")) this.fail("object_separator_invalid");
		}
	}

	private array(depth: number): unknown[] {
		this.offset += 1;
		const result: unknown[] = [];
		this.whitespace();
		if (this.take("]")) return result;
		while (true) {
			result.push(this.value(depth));
			this.whitespace();
			if (this.take("]")) return result;
			if (!this.take(",")) this.fail("array_separator_invalid");
		}
	}

	private string(): string {
		const start = this.offset;
		this.offset += 1;
		let escaped = false;
		while (this.offset < this.source.length) {
			const code = this.source.charCodeAt(this.offset);
			if (!escaped && code === 0x22) {
				this.offset += 1;
				let value: string;
				try {
					value = JSON.parse(this.source.slice(start, this.offset));
				} catch {
					this.fail("string_invalid");
				}
				for (let index = 0; index < value.length; index += 1) {
					const unit = value.charCodeAt(index);
					if (unit >= 0xd800 && unit <= 0xdbff) {
						const next = value.charCodeAt(index + 1);
						if (!(next >= 0xdc00 && next <= 0xdfff))
							this.fail("lone_surrogate");
						index += 1;
					} else if (unit >= 0xdc00 && unit <= 0xdfff)
						this.fail("lone_surrogate");
				}
				return value;
			}
			if (!escaped && code < 0x20) this.fail("string_control_character");
			if (!escaped && code === 0x5c) escaped = true;
			else escaped = false;
			this.offset += 1;
		}
		this.fail("string_unterminated");
	}

	private whitespace() {
		while (
			/\s/.test(this.source[this.offset] ?? "") &&
			/[\x20\t\r\n]/.test(this.source[this.offset])
		)
			this.offset += 1;
	}

	private take(value: string) {
		if (this.source[this.offset] !== value) return false;
		this.offset += 1;
		return true;
	}

	private fail(reason: string): never {
		throw new Error(`strict_json_${reason}:${this.offset}`);
	}
}

export function parseStrictJsonDocument(source: string | Uint8Array): unknown {
	const bytes =
		typeof source === "string" ? new TextEncoder().encode(source) : source;
	if (bytes.byteLength > MAX_STRICT_JSON_BYTES)
		throw new Error("strict_json_size_exceeded");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("strict_json_utf8_invalid");
	}
	return new StrictJsonParser(text).parse();
}

export async function readStrictJsonDocument(
	filePath: string,
	snapshotRoot: string,
): Promise<unknown> {
	return parseStrictJsonDocument(
		await readStrictJsonDocumentBytes(filePath, snapshotRoot),
	);
}

export async function readStrictJsonDocumentBytes(
	filePath: string,
	snapshotRoot: string,
): Promise<Uint8Array> {
	const stat = await fs.lstat(filePath);
	if (stat.isSymbolicLink() || !stat.isFile())
		throw new Error("strict_json_regular_file_required");
	if (stat.size > MAX_STRICT_JSON_BYTES)
		throw new Error("strict_json_size_exceeded");
	const [realFile, realRoot] = await Promise.all([
		fs.realpath(filePath),
		fs.realpath(snapshotRoot),
	]);
	if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`))
		throw new Error("strict_json_outside_snapshot");
	const handle = await fs.open(realFile, "r");
	try {
		const opened = await handle.stat();
		if (!opened.isFile()) throw new Error("strict_json_regular_file_required");
		if (opened.size > MAX_STRICT_JSON_BYTES)
			throw new Error("strict_json_size_exceeded");
		const bytes = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (bytesRead === 0) throw new Error("strict_json_file_changed");
			offset += bytesRead;
		}
		const trailing = Buffer.alloc(1);
		if ((await handle.read(trailing, 0, 1, bytes.length)).bytesRead > 0)
			throw new Error("strict_json_file_changed");
		return bytes;
	} finally {
		await handle.close();
	}
}
