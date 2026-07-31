import type {
	DependencyCoverage,
	DastStartPlanV1,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { matchesAnyPluginGlob } from "../../../modules/project-capabilities/path-patterns";
import { pathDetector, readJsonObject } from "../helpers";

const PLUGIN_ID = "build.npm";
const LOCK_GLOBS = [
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"**/bun.lock",
	"**/bun.lockb",
	"**/package-lock.json",
	"**/npm-shrinkwrap.json",
	"**/yarn.lock",
	"**/pnpm-lock.yaml",
] as const;
const COMPANION_GLOBS = [
	"package.json",
	"pnpm-workspace.yaml",
	"**/package.json",
	"**/pnpm-workspace.yaml",
] as const;
const SCRIPT_PRIORITY = ["dast", "dev", "start", "serve", "preview"] as const;

export const npmBuildPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "build_system",
		displayName: "npm-compatible",
		requires: { allOf: ["language.typescript"], oneOf: [] },
		declaredCapabilities: [
			"dependency_detection",
			"dependency_scan",
			"dast_start",
		],
	},
	detectors: [
		pathDetector({
			id: "detect.build.npm",
			pluginId: PLUGIN_ID,
			globs: [...LOCK_GLOBS, ...COMPANION_GLOBS],
			kind: "manifest",
		}),
	],
	dependencyProviders: [
		{
			id: "dependency.npm",
			pluginId: PLUGIN_ID,
			ecosystem: "npm",
			primaryGlobs: LOCK_GLOBS,
			lockGlobs: LOCK_GLOBS,
			companionGlobs: COMPANION_GLOBS,
			excludeGlobs: [
				"node_modules/**",
				"**/node_modules/**",
				"dist/**",
				"dist-web/**",
				".next/**",
				".turbo/**",
			],
			coverage(paths): DependencyCoverage {
				if (paths.some((value) => matchesAnyPluginGlob(value, LOCK_GLOBS))) {
					return {
						coverageEffect: "covered",
						reasonCode: null,
						limitationCodes: [],
					};
				}
				return {
					coverageEffect: "partial",
					reasonCode: "npm_dependency_lock_missing",
					limitationCodes: ["npm_dependency_lock_missing"],
				};
			},
		},
	],
	sourceAnalyzers: [],
	endpointExtractors: [],
	semgrepRules: [],
	startPlanners: [
		{
			id: "start.npm.package-script",
			pluginId: PLUGIN_ID,
			async plan(context): Promise<DastStartPlanV1 | null> {
				const manifestPath = context.inventory
					.map((entry) => entry.path)
					.find((entry) => entry === "package.json");
				if (!manifestPath) return null;
				const manifest = await readJsonObject(context, manifestPath);
				const scripts =
					manifest?.scripts &&
					typeof manifest.scripts === "object" &&
					!Array.isArray(manifest.scripts)
						? (manifest.scripts as Record<string, unknown>)
						: {};
				const scriptName = SCRIPT_PRIORITY.find(
					(candidate) => typeof scripts[candidate] === "string",
				);
				if (!scriptName) return null;
				const packageManager = detectPackageManager(
					context.inventory.map((entry) => entry.path),
				);
				const script = String(scripts[scriptName]);
				return {
					schemaVersion: 1,
					pluginId: PLUGIN_ID,
					executable: packageManager,
					args: packageManagerArgs(
						packageManager,
						scriptName,
						script,
						context.port,
						context.requestedPortExplicit,
					),
					cwd: ".",
					env: {
						HOST: "127.0.0.1",
						PORT: String(context.port),
						VITE_PORT: String(context.port),
						APP_URL: `http://127.0.0.1:${context.port}`,
						CORS_ORIGINS: `http://127.0.0.1:${context.port}`,
						NODE_ENV: "development",
					},
					readinessPaths: ["/", "/health", "/api/health"],
					requiresProjectCodeConsent: false,
					requestedNetwork: "none",
				};
			},
		},
	],
};

function detectPackageManager(
	paths: readonly string[],
): "bun" | "pnpm" | "yarn" | "npm" {
	if (paths.includes("bun.lock") || paths.includes("bun.lockb")) return "bun";
	if (paths.includes("pnpm-lock.yaml")) return "pnpm";
	if (paths.includes("yarn.lock")) return "yarn";
	return "npm";
}

function packageManagerArgs(
	packageManager: "bun" | "pnpm" | "yarn" | "npm",
	scriptName: string,
	script: string,
	port: number,
	requestedPortExplicit: boolean,
): string[] {
	const portFromScript = extractScriptPort(script);
	const portArgs =
		requestedPortExplicit || portFromScript === null
			? extraPortArgs(script, port)
			: [];
	switch (packageManager) {
		case "bun":
			return ["run", scriptName, "--", ...portArgs];
		case "pnpm":
			return ["run", scriptName, "--", ...portArgs];
		case "yarn":
			return [scriptName, ...portArgs];
		case "npm":
			return ["run", scriptName, "--", ...portArgs];
	}
}

function extractScriptPort(script: string): number | null {
	for (const expression of [
		/\bPORT=(\d{2,5})\b/,
		/(?:^|\s)--port(?:=|\s+)(\d{2,5})\b/,
		/\s-p\s+(\d{2,5})\b/,
	]) {
		const match = script.match(expression);
		if (!match?.[1]) continue;
		const port = Number.parseInt(match[1], 10);
		if (port > 0 && port <= 65535) return port;
	}
	return null;
}

function extraPortArgs(script: string, port: number): string[] {
	if (/\b(vite|astro|svelte-kit)\b/i.test(script)) {
		return ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
	}
	if (/\bnext\b/i.test(script)) {
		return ["-H", "127.0.0.1", "-p", String(port)];
	}
	return [];
}
