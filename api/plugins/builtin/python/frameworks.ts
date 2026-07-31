import type {
	DastStartPlanV1,
	ProjectDetector,
	StartPlannerContext,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { extractPythonEndpoints } from "../../../modules/threat-models/endpoint-extractors/python";
import { inventoryPaths } from "../helpers";
import { parsePythonRequirements } from "./requirements";

type PythonFramework = "fastapi" | "flask" | "django";

export const pythonFrameworkPlugins: TechnologyPluginV1[] = [
	pythonFrameworkPlugin("fastapi"),
	pythonFrameworkPlugin("flask"),
	pythonFrameworkPlugin("django"),
];

function pythonFrameworkPlugin(framework: PythonFramework): TechnologyPluginV1 {
	const pluginId = `framework.python.${framework}`;
	return {
		manifest: {
			schemaVersion: 1,
			pluginApiVersion: "1",
			id: pluginId,
			version: "1.0.0",
			kind: "framework",
			displayName:
				framework === "fastapi"
					? "FastAPI"
					: framework === "flask"
						? "Flask"
						: "Django",
			requires: { allOf: ["language.python"], oneOf: [] },
			declaredCapabilities: ["endpoint_extraction", "dast_start"],
		},
		detectors: [pythonFrameworkDetector(pluginId, framework)],
		dependencyProviders: [],
		sourceAnalyzers: [],
		endpointExtractors: [
			{
				id: `endpoint.${pluginId}`,
				pluginId,
				extensions: [".py"],
				frameworks: [framework],
				coverageEffect: "partial",
				limitationCodes: frameworkLimitations(framework),
				extract(source) {
					return extractPythonEndpoints(source).filter(
						(endpoint) => endpoint.framework === framework,
					);
				},
			},
		],
		semgrepRules: [],
		startPlanners: [
			{
				id: `start.${pluginId}`,
				pluginId,
				plan: (context) => pythonStartPlan(framework, pluginId, context),
			},
		],
	};
}

function pythonFrameworkDetector(
	pluginId: string,
	framework: PythonFramework,
): ProjectDetector {
	const dependencyName = framework;
	const importPattern = new RegExp(
		`^\\s*(?:from\\s+${framework}\\b|import\\s+${framework}\\b)`,
		"m",
	);
	const runtimePattern =
		framework === "fastapi"
			? /\b(?:FastAPI|APIRouter)\s*\(|@\w+\.(?:get|post|put|patch|delete|route)\s*\(/
			: framework === "flask"
				? /\b(?:Flask|Blueprint)\s*\(|@\w+\.route\s*\(/
				: /\burlpatterns\s*=|\b(?:path|re_path|include)\s*\(|DJANGO_SETTINGS_MODULE/;
	return {
		id: `detect.${pluginId}`,
		pluginId,
		fileGlobs: [
			"**/*.py",
			"requirements.txt",
			"requirements-*.txt",
			"requirements/*.txt",
			"**/requirements.txt",
			"**/requirements-*.txt",
			"pyproject.toml",
			"**/pyproject.toml",
		],
		async detect(context) {
			const evidence: Array<{
				path: string;
				kind: "dependency" | "annotation" | "config";
			}> = [];
			let dependencyEvidence = false;
			let importEvidence = false;
			let runtimeEvidence = false;
			for (const candidate of inventoryPaths(context, [
				"requirements.txt",
				"requirements-*.txt",
				"requirements/*.txt",
				"**/requirements.txt",
				"**/requirements-*.txt",
				"pyproject.toml",
				"**/pyproject.toml",
				"**/*.py",
			]).slice(0, 150)) {
				const read = await context.readText(candidate);
				if (!read.ok) continue;
				if (candidate.endsWith(".py")) {
					if (hasPythonCodeMatch(read.text, importPattern)) {
						importEvidence = true;
						evidence.push({ path: candidate, kind: "annotation" });
					}
					if (hasPythonCodeMatch(read.text, runtimePattern))
						runtimeEvidence = true;
				} else if (
					hasPythonDependencyEvidence(candidate, read.text, dependencyName)
				) {
					dependencyEvidence = true;
					evidence.push({ path: candidate, kind: "dependency" });
				}
			}
			if (
				framework === "django" &&
				context.inventory.some((entry) => entry.path === "manage.py")
			) {
				evidence.push({ path: "manage.py", kind: "config" });
				runtimeEvidence = true;
			}
			const detected = dependencyEvidence || importEvidence;
			return {
				detected,
				confidence:
					detected && runtimeEvidence && (dependencyEvidence || importEvidence)
						? dependencyEvidence && importEvidence
							? "high"
							: "medium"
						: detected
							? "medium"
							: "low",
				evidence,
				limitations: detected ? frameworkLimitations(framework) : [],
			};
		},
	};
}

function hasPythonDependencyEvidence(
	filePath: string,
	content: string,
	dependencyName: string,
): boolean {
	if (filePath.endsWith(".txt")) {
		const normalizedDependency = normalizePythonPackageName(dependencyName);
		return parsePythonRequirements(content).some(
			(entry) =>
				entry.name !== null &&
				normalizePythonPackageName(entry.name) === normalizedDependency,
		);
	}
	if (!filePath.endsWith("pyproject.toml")) return false;
	const escaped = escapeRegExp(dependencyName);
	const dependencyEntry = new RegExp(
		`(?:^|\\n|\\[|,)\\s*["']?${escaped}(?:\\[[^\\]]+\\])?(?=\\s*(?:["']|[<>=!~]))`,
		"im",
	);
	return dependencyEntry.test(stripTomlComments(content));
}

function stripTomlComments(content: string): string {
	let output = "";
	let quote: "'" | '"' | null = null;
	let tripleQuote: "'''" | '"""' | null = null;
	let escaped = false;
	let comment = false;
	for (let index = 0; index < content.length; index += 1) {
		const character = content[index] ?? "";
		if (comment) {
			if (character === "\n") {
				comment = false;
				output += "\n";
			} else output += " ";
			continue;
		}
		if (tripleQuote) {
			if (content.slice(index, index + 3) === tripleQuote) {
				output += "   ";
				index += 2;
				tripleQuote = null;
			} else {
				output += character === "\n" ? "\n" : " ";
			}
			continue;
		}
		if (quote) {
			output += character;
			if (!escaped && character === quote) quote = null;
			escaped = quote === '"' && !escaped && character === "\\";
			if (character !== "\\") escaped = false;
			continue;
		}
		if (character === "#") {
			comment = true;
			output += " ";
			continue;
		}
		if (
			content.slice(index, index + 3) === '"""' ||
			content.slice(index, index + 3) === "'''"
		) {
			tripleQuote = content.slice(index, index + 3) as "'''" | '"""';
			output += "   ";
			index += 2;
			continue;
		}
		if (character === "'" || character === '"') quote = character;
		output += character;
	}
	return output;
}

function normalizePythonPackageName(value: string): string {
	return value.toLowerCase().replace(/[-_.]+/g, "-");
}

async function pythonStartPlan(
	framework: PythonFramework,
	pluginId: string,
	context: StartPlannerContext,
): Promise<DastStartPlanV1 | null> {
	if (framework === "django") {
		if (!context.inventory.some((entry) => entry.path === "manage.py"))
			return null;
		return plan(
			pluginId,
			["manage.py", "runserver", `127.0.0.1:${context.port}`],
			context.port,
		);
	}
	const candidates: Array<{ module: string; app: string }> = [];
	const applicationConstructor = framework === "fastapi" ? "FastAPI" : "Flask";
	for (const sourcePath of inventoryPaths(context, ["**/*.py"]).slice(0, 200)) {
		if (sourcePath.endsWith(".pyi")) continue;
		const module = pythonModuleName(sourcePath);
		if (!module) continue;
		const read = await context.readText(sourcePath);
		if (!read.ok) continue;
		const expression = new RegExp(
			`^\\s*([A-Za-z_]\\w*)\\s*=\\s*${applicationConstructor}\\s*\\(`,
			"gm",
		);
		for (const match of read.text.matchAll(expression)) {
			if (match[1] && isPythonCodePosition(read.text, match.index ?? 0)) {
				candidates.push({ module, app: match[1] });
			}
		}
	}
	const unique = [
		...new Map(
			candidates.map((candidate) => [
				`${candidate.module}:${candidate.app}`,
				candidate,
			]),
		).values(),
	];
	if (unique.length !== 1) return null;
	const candidate = unique[0];
	if (!candidate) return null;
	return framework === "fastapi"
		? plan(
				pluginId,
				[
					"-m",
					"uvicorn",
					`${candidate.module}:${candidate.app}`,
					"--host",
					"127.0.0.1",
					"--port",
					String(context.port),
				],
				context.port,
			)
		: plan(
				pluginId,
				[
					"-m",
					"flask",
					"--app",
					`${candidate.module}:${candidate.app}`,
					"run",
					"--host",
					"127.0.0.1",
					"--port",
					String(context.port),
				],
				context.port,
			);
}

function plan(pluginId: string, args: string[], port: number): DastStartPlanV1 {
	return {
		schemaVersion: 1,
		pluginId,
		executable: "python3",
		args,
		cwd: ".",
		env: { HOST: "127.0.0.1", PORT: String(port) },
		readinessPaths: ["/health", "/", "/docs"],
		requiresProjectCodeConsent: true,
		requestedNetwork: "none",
	};
}

function pythonModuleName(sourcePath: string): string | null {
	const withoutExtension = sourcePath.replace(/\.py$/, "");
	const modulePath = withoutExtension.endsWith("/__init__")
		? withoutExtension.slice(0, -"/__init__".length)
		: withoutExtension;
	const parts = modulePath.split("/");
	if (parts[0] === "src") parts.shift();
	if (parts.length === 0 || parts.some((part) => !/^[A-Za-z_]\w*$/.test(part)))
		return null;
	return parts.join(".");
}

function frameworkLimitations(framework: PythonFramework): string[] {
	if (framework === "django") {
		return ["django_include_expansion_partial", "dynamic_routes_not_inferred"];
	}
	return ["dynamic_routes_not_inferred", "decorator_semantics_not_executed"];
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPythonCodeMatch(content: string, pattern: RegExp): boolean {
	const flags = pattern.flags.includes("g")
		? pattern.flags
		: `${pattern.flags}g`;
	for (const match of content.matchAll(new RegExp(pattern.source, flags))) {
		if (isPythonCodePosition(content, match.index ?? 0)) return true;
	}
	return false;
}

function isPythonCodePosition(content: string, target: number): boolean {
	let quote: "'" | '"' | null = null;
	let triple = false;
	let escaped = false;
	let comment = false;
	for (let index = 0; index < target; index += 1) {
		const character = content[index] ?? "";
		if (comment) {
			if (character === "\n") comment = false;
			continue;
		}
		if (quote) {
			if (
				!escaped &&
				triple &&
				content.slice(index, index + 3) === quote.repeat(3)
			) {
				index += 2;
				quote = null;
				triple = false;
				continue;
			}
			if (!escaped && !triple && character === quote) quote = null;
			escaped = !escaped && character === "\\";
			if (character !== "\\") escaped = false;
			continue;
		}
		if (character === "#") comment = true;
		if (character === "'" || character === '"') {
			quote = character;
			triple = content.slice(index, index + 3) === character.repeat(3);
			if (triple) index += 2;
		}
	}
	return !quote && !comment;
}
