import type { ExtractedEndpoint, SourceInput } from "./types";

const ROUTER_METHOD =
	/\b([A-Za-z_]\w*)\.(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\(\s*["'`]([^"'`]+)["'`]/g;
const GO_122_PATTERN =
	/\b([A-Za-z_]\w*)\.HandleFunc\(\s*["'`](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s+([^"'`]+)["'`]/g;
const HANDLE_FUNC_PATTERN =
	/\b([A-Za-z_]\w*)\.HandleFunc\(\s*["'`]([^"'`]+)["'`]\s*,[\s\S]{0,500}?\.(?:Method|Method\s*==)\s*(?:!=|==)?\s*["'`](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["'`]/g;

export function extractGoEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	const frameworks = goFrameworkEvidence(source.content);
	for (const framework of ["gin", "echo"] as const) {
		const evidence = frameworks[framework];
		if (!evidence.imported) continue;
		for (const match of source.content.matchAll(ROUTER_METHOD)) {
			if (!isGoCodePosition(source.content, match.index ?? 0)) continue;
			const receiver = match[1] ?? "";
			if (!evidence.receivers.has(receiver)) continue;
			output.push(
				endpoint(
					source,
					match,
					match[2] ?? "",
					joinRoute(evidence.prefixes.get(receiver) ?? "", match[3] ?? ""),
					framework,
				),
			);
		}
	}
	const netHttp = frameworks.netHttp;
	if (netHttp.imported) {
		for (const match of source.content.matchAll(GO_122_PATTERN)) {
			if (!isGoCodePosition(source.content, match.index ?? 0)) continue;
			if (!netHttp.receivers.has(match[1] ?? "")) continue;
			output.push(
				endpoint(source, match, match[2] ?? "", match[3] ?? "", "net/http"),
			);
		}
		for (const match of source.content.matchAll(HANDLE_FUNC_PATTERN)) {
			if (!isGoCodePosition(source.content, match.index ?? 0)) continue;
			if (!netHttp.receivers.has(match[1] ?? "")) continue;
			output.push(
				endpoint(source, match, match[3] ?? "", match[2] ?? "", "net/http"),
			);
		}
	}
	return dedupe(output);
}

type FrameworkEvidence = {
	imported: boolean;
	receivers: Set<string>;
	prefixes: Map<string, string>;
};

function goFrameworkEvidence(content: string): {
	gin: FrameworkEvidence;
	echo: FrameworkEvidence;
	netHttp: FrameworkEvidence;
} {
	const gin = frameworkEvidence(content, "github.com/gin-gonic/gin", "gin", [
		"Engine",
		"RouterGroup",
	]);
	const echo = frameworkEvidence(content, "github.com/labstack/echo", "echo", [
		"Echo",
		"Group",
	]);
	const netHttpAlias = importAlias(content, "net/http", "http");
	const netHttp: FrameworkEvidence = {
		imported: netHttpAlias !== null,
		receivers: new Set(netHttpAlias ? [netHttpAlias] : []),
		prefixes: new Map(),
	};
	if (netHttpAlias) {
		for (const match of content.matchAll(
			new RegExp(
				`\\b([A-Za-z_]\\w*)\\s*:?=\\s*${escapeRegExp(netHttpAlias)}\\.NewServeMux\\s*\\(`,
				"g",
			),
		)) {
			if (isGoCodePosition(content, match.index ?? 0) && match[1])
				netHttp.receivers.add(match[1]);
		}
	}
	return { gin, echo, netHttp };
}

function frameworkEvidence(
	content: string,
	modulePrefix: string,
	defaultAlias: string,
	typeNames: string[],
): FrameworkEvidence {
	const alias = importAlias(content, modulePrefix, defaultAlias, true);
	const evidence: FrameworkEvidence = {
		imported: alias !== null,
		receivers: new Set(),
		prefixes: new Map(),
	};
	if (!alias) return evidence;
	const escapedAlias = escapeRegExp(alias);
	for (const match of content.matchAll(
		new RegExp(
			`\\b([A-Za-z_]\\w*)\\s*:?=\\s*${escapedAlias}\\.(?:Default|New)\\s*\\(`,
			"g",
		),
	)) {
		if (isGoCodePosition(content, match.index ?? 0) && match[1])
			evidence.receivers.add(match[1]);
	}
	for (const match of content.matchAll(
		new RegExp(
			`\\b([A-Za-z_]\\w*)\\s+\\*${escapedAlias}\\.(?:${typeNames.join("|")})\\b`,
			"g",
		),
	)) {
		if (isGoCodePosition(content, match.index ?? 0) && match[1])
			evidence.receivers.add(match[1]);
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (const match of content.matchAll(
			/\b([A-Za-z_]\w*)\s*:?=\s*([A-Za-z_]\w*)\.Group\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
		)) {
			if (!isGoCodePosition(content, match.index ?? 0)) continue;
			const child = match[1] ?? "";
			const parent = match[2] ?? "";
			if (!evidence.receivers.has(parent) || evidence.receivers.has(child))
				continue;
			evidence.receivers.add(child);
			evidence.prefixes.set(
				child,
				joinRoute(evidence.prefixes.get(parent) ?? "", match[3] ?? ""),
			);
			changed = true;
		}
	}
	return evidence;
}

function importAlias(
	content: string,
	modulePath: string,
	defaultAlias: string,
	prefix = false,
): string | null {
	const expression = new RegExp(
		`(?:^|\\n)\\s*(?:import\\s+)?(?:([A-Za-z_]\\w*)\\s+)?["'](${escapeRegExp(modulePath)}${prefix ? "(?:/v\\d+)?" : ""})["']`,
		"g",
	);
	for (const match of content.matchAll(expression)) {
		if (!isGoCodePosition(content, match.index ?? 0)) continue;
		return match[1] ?? defaultAlias;
	}
	return null;
}

function isGoCodePosition(content: string, target: number): boolean {
	let blockComment = false;
	let lineComment = false;
	let quote: '"' | "'" | "`" | null = null;
	let escaped = false;
	for (let index = 0; index < target; index += 1) {
		const character = content[index] ?? "";
		const next = content[index + 1] ?? "";
		if (lineComment) {
			if (character === "\n") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (character === "*" && next === "/") {
				blockComment = false;
				index += 1;
			}
			continue;
		}
		if (quote) {
			if (!escaped && character === quote) quote = null;
			escaped = quote !== "`" && !escaped && character === "\\";
			if (character !== "\\") escaped = false;
			continue;
		}
		if (character === "/" && next === "/") {
			lineComment = true;
			index += 1;
		} else if (character === "/" && next === "*") {
			blockComment = true;
			index += 1;
		} else if (character === '"' || character === "'" || character === "`") {
			quote = character;
		}
	}
	return !blockComment && !lineComment && !quote;
}

function endpoint(
	source: SourceInput,
	match: RegExpMatchArray,
	method: string,
	routePath: string,
	framework: string,
): ExtractedEndpoint {
	const line = source.content.slice(0, match.index ?? 0).split("\n").length;
	return {
		method: method as ExtractedEndpoint["method"],
		path: normalizeRoute(routePath),
		framework,
		evidenceRefs: [
			{
				kind: "source",
				ref: `${source.path}:${line}`,
				path: source.path,
				line,
			},
		],
	};
}

function joinRoute(prefix: string, routePath: string): string {
	return `${prefix.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
}

function normalizeRoute(routePath: string): string {
	return (routePath.startsWith("/") ? routePath : `/${routePath}`)
		.replace(/:([A-Za-z_]\w*)/g, "{$1}")
		.replace(/\/+/g, "/");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(values: ExtractedEndpoint[]): ExtractedEndpoint[] {
	return [
		...new Map(
			values.map((value) => [
				`${value.method}\0${value.path}\0${value.framework}`,
				value,
			]),
		).values(),
	];
}
