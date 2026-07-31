import type {
	ProjectDetector,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { extractGoEndpoints } from "../../../modules/threat-models/endpoint-extractors/go";
import { inventoryPaths } from "../helpers";

type GoFramework = "net-http" | "gin" | "echo";

export const goFrameworkPlugins: TechnologyPluginV1[] = [
	goFrameworkPlugin("net-http"),
	goFrameworkPlugin("gin"),
	goFrameworkPlugin("echo"),
];

function goFrameworkPlugin(framework: GoFramework): TechnologyPluginV1 {
	const pluginId = `framework.go.${framework}`;
	const endpointFramework = framework === "net-http" ? "net/http" : framework;
	return {
		manifest: {
			schemaVersion: 1,
			pluginApiVersion: "1",
			id: pluginId,
			version: "1.0.0",
			kind: "framework",
			displayName:
				framework === "net-http"
					? "Go net/http"
					: framework === "gin"
						? "Gin"
						: "Echo",
			requires: { allOf: ["language.go"], oneOf: [] },
			declaredCapabilities: ["endpoint_extraction"],
		},
		detectors: [goFrameworkDetector(pluginId, framework)],
		dependencyProviders: [],
		sourceAnalyzers: [],
		endpointExtractors: [
			{
				id: `endpoint.${pluginId}`,
				pluginId,
				extensions: [".go"],
				frameworks: [endpointFramework],
				coverageEffect: "partial",
				limitationCodes: [
					"dynamic_routes_not_inferred",
					"go_type_checking_not_performed",
				],
				extract(source) {
					return extractGoEndpoints(source).filter(
						(endpoint) => endpoint.framework === endpointFramework,
					);
				},
			},
		],
		semgrepRules: [],
		startPlanners: [],
	};
}

function goFrameworkDetector(
	pluginId: string,
	framework: GoFramework,
): ProjectDetector {
	const modulePath =
		framework === "net-http"
			? "net/http"
			: framework === "gin"
				? "github.com/gin-gonic/gin"
				: "github.com/labstack/echo";
	const importPattern = new RegExp(
		`(?:^|\\n)\\s*(?:import\\s+)?(?:[A-Za-z_]\\w*\\s+)?["']${escapeRegExp(modulePath)}${framework === "echo" ? "(?:/v\\d+)?" : ""}["']`,
		"m",
	);
	const callPattern =
		framework === "net-http"
			? /\b(?:Handle|HandleFunc|NewServeMux)\s*\(/
			: framework === "gin"
				? /\bgin\.(?:Default|New)\s*\(|\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(/
				: /\becho\.New\s*\(|\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(/;
	return {
		id: `detect.${pluginId}`,
		pluginId,
		fileGlobs: ["go.mod", "**/go.mod", "**/*.go"],
		async detect(context) {
			const evidence: Array<{
				path: string;
				kind: "dependency" | "annotation";
			}> = [];
			let importEvidence = false;
			let callEvidence = false;
			for (const candidate of inventoryPaths(context, [
				"go.mod",
				"**/go.mod",
				"**/*.go",
			]).slice(0, 200)) {
				const read = await context.readText(candidate);
				if (!read.ok) continue;
				if (candidate.endsWith("go.mod")) {
					if (framework !== "net-http" && read.text.includes(modulePath)) {
						evidence.push({ path: candidate, kind: "dependency" });
					}
					continue;
				}
				if (hasGoCodeMatch(read.text, importPattern)) {
					importEvidence = true;
					evidence.push({ path: candidate, kind: "dependency" });
					if (hasGoCodeMatch(read.text, callPattern)) callEvidence = true;
				}
			}
			const detected =
				importEvidence || evidence.some((item) => item.path.endsWith("go.mod"));
			return {
				detected,
				confidence:
					importEvidence && callEvidence ? "high" : detected ? "medium" : "low",
				evidence,
				limitations: detected
					? [
							"dynamic_routes_not_inferred",
							"go_type_checking_not_performed",
							"go_dast_auto_start_unsupported",
						]
					: [],
			};
		},
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasGoCodeMatch(content: string, pattern: RegExp): boolean {
	const flags = pattern.flags.includes("g")
		? pattern.flags
		: `${pattern.flags}g`;
	for (const match of content.matchAll(new RegExp(pattern.source, flags))) {
		if (isGoCodePosition(content, match.index ?? 0)) return true;
	}
	return false;
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
