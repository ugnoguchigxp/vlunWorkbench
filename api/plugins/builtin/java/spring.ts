import type {
	DastStartPlanV1,
	TechnologyPluginV1,
} from "../../../modules/project-capabilities/plugin-contract";
import { extractJavaEndpoints } from "../../../modules/threat-models/endpoint-extractors/java";
import { hasInventoryPath, inventoryPaths } from "../helpers";

const PLUGIN_ID = "framework.java.spring";
const SPRING_TEXT =
	/(?:org\.springframework|org\.springframework\.boot|spring-boot|@(?:RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b)/;

export const springFrameworkPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "framework",
		displayName: "Spring Boot / Spring MVC",
		requires: {
			allOf: ["language.java"],
			oneOf: ["build.maven", "build.gradle"],
		},
		declaredCapabilities: [
			"endpoint_extraction",
			"schema_discovery",
			"dast_start",
		],
	},
	detectors: [
		{
			id: "detect.framework.java.spring",
			pluginId: PLUGIN_ID,
			fileGlobs: [
				"pom.xml",
				"**/pom.xml",
				"build.gradle",
				"build.gradle.kts",
				"**/build.gradle",
				"**/build.gradle.kts",
				"gradle/libs.versions.toml",
				"**/*.java",
				"application.properties",
				"application.yml",
				"application.yaml",
				"**/application.properties",
				"**/application.yml",
				"**/application.yaml",
			],
			async detect(context) {
				const evidence: Array<{
					path: string;
					kind: "dependency" | "annotation" | "config";
				}> = [];
				for (const candidate of inventoryPaths(context, [
					"pom.xml",
					"**/pom.xml",
					"build.gradle",
					"build.gradle.kts",
					"**/build.gradle",
					"**/build.gradle.kts",
					"gradle/libs.versions.toml",
					"**/gradle/libs.versions.toml",
					"**/*.java",
					"application.properties",
					"application.yml",
					"application.yaml",
					"**/application.properties",
					"**/application.yml",
					"**/application.yaml",
				]).slice(0, 50)) {
					const content = await context.readText(candidate);
					if (!content.ok || !SPRING_TEXT.test(content.text)) continue;
					evidence.push({
						path: candidate,
						kind: candidate.endsWith(".java")
							? "annotation"
							: candidate.includes("application.")
								? "config"
								: "dependency",
					});
				}
				const evidenceKinds = new Set(evidence.map((item) => item.kind));
				const hasBuildEvidence =
					evidenceKinds.has("dependency") || evidenceKinds.has("config");
				return {
					detected: evidence.length > 0 && hasBuildEvidence,
					confidence:
						evidenceKinds.size >= 2
							? "high"
							: hasBuildEvidence
								? "medium"
								: "low",
					evidence,
					limitations:
						evidence.length > 0 && !hasBuildEvidence
							? ["spring_annotation_without_build_evidence"]
							: [
									"spring_webflux_functional_routes_partial",
									"spring_security_policy_not_inferred",
								],
				};
			},
		},
	],
	dependencyProviders: [],
	sourceAnalyzers: [],
	endpointExtractors: [
		{
			id: "endpoint.framework.java.spring",
			pluginId: PLUGIN_ID,
			extensions: [".java"],
			frameworks: ["spring-mvc"],
			extract(source) {
				return extractJavaEndpoints(source).filter(
					(endpoint) => endpoint.framework === "spring-mvc",
				);
			},
		},
	],
	semgrepRules: [],
	startPlanners: [
		{
			id: "start.framework.java.spring",
			pluginId: PLUGIN_ID,
			plan(context): DastStartPlanV1 | null {
				const active = new Set(context.activePluginIds);
				if (active.has("build.gradle")) {
					return springGradlePlan(context);
				}
				if (active.has("build.maven")) {
					return springMavenPlan(context);
				}
				return null;
			},
		},
	],
};

function springMavenPlan(
	context: Parameters<
		(typeof springFrameworkPlugin.startPlanners)[number]["plan"]
	>[0],
): DastStartPlanV1 {
	const wrapper = hasInventoryPath(context, ["mvnw"]);
	return {
		schemaVersion: 1,
		pluginId: PLUGIN_ID,
		executable: wrapper ? "./mvnw" : "mvn",
		args: ["--offline", "spring-boot:run"],
		cwd: ".",
		env: springEnvironment(context.port),
		readinessPaths: ["/actuator/health", "/health", "/", "/v3/api-docs"],
		requiresProjectCodeConsent: true,
		requestedNetwork: "none",
	};
}

function springGradlePlan(
	context: Parameters<
		(typeof springFrameworkPlugin.startPlanners)[number]["plan"]
	>[0],
): DastStartPlanV1 {
	const wrapper = hasInventoryPath(context, ["gradlew"]);
	return {
		schemaVersion: 1,
		pluginId: PLUGIN_ID,
		executable: wrapper ? "./gradlew" : "gradle",
		args: ["--offline", "--no-daemon", "bootRun"],
		cwd: ".",
		env: springEnvironment(context.port),
		readinessPaths: ["/actuator/health", "/health", "/", "/v3/api-docs"],
		requiresProjectCodeConsent: true,
		requestedNetwork: "none",
	};
}

function springEnvironment(port: number): Record<string, string> {
	return {
		SERVER_ADDRESS: "127.0.0.1",
		SERVER_PORT: String(port),
	};
}
