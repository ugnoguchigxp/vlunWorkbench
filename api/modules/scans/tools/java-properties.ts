// java.util.Properties.load(InputStream): ISO-8859-1 bytes, logical lines,
// escaped separators, and exactly four hexadecimal digits per Unicode escape.
// https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/util/Properties.html#load(java.io.InputStream)
export function parseJavaProperties(
	source: string,
): Map<string, string> | null {
	const result = new Map<string, string>();
	const lines = source.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index++) {
		let line = (lines[index] ?? "").replace(/^[ \t\f]+/, "");
		if (!line || /^[#!]/.test(line)) continue;
		while ((line.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) {
			line =
				line.slice(0, -1) + (lines[++index] ?? "").replace(/^[ \t\f]+/, "");
			if (index >= lines.length) break;
		}
		let separator = line.length;
		for (let cursor = 0; cursor < line.length; cursor++) {
			if (line[cursor] === "\\") {
				cursor++;
				continue;
			}
			if (/[=: \t\f]/.test(line[cursor] ?? "")) {
				separator = cursor;
				break;
			}
		}
		let valueStart = separator;
		while (/[ \t\f]/.test(line[valueStart] ?? "")) valueStart++;
		if (line[valueStart] === ":" || line[valueStart] === "=") valueStart++;
		while (/[ \t\f]/.test(line[valueStart] ?? "")) valueStart++;
		const key = unescapeProperty(line.slice(0, separator));
		const value = unescapeProperty(line.slice(valueStart));
		if (key === null || value === null) return null;
		result.set(key, value);
	}
	return result;
}

function unescapeProperty(text: string): string | null {
	let value = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (char !== "\\") {
			value += char;
			continue;
		}
		const escaped = text[++index];
		if (escaped === undefined) return null;
		if (escaped === "u") {
			const hex = text.slice(index + 1, index + 5);
			if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
			value += String.fromCharCode(Number.parseInt(hex, 16));
			index += 4;
		} else
			value +=
				({ t: "\t", n: "\n", r: "\r", f: "\f" } as Record<string, string>)[
					escaped
				] ?? escaped;
	}
	return value;
}
