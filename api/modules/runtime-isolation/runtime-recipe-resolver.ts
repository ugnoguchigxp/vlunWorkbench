import fs from "node:fs/promises";
import path from "node:path";
import {
	type RuntimeTargetRecipeV1,
	runtimeTargetRecipeV1Schema,
} from "../../../shared/schemas/runtime-isolation.schema";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import { dependencyAdapterForPackageManager } from "./runtime-dependency-adapter";
import { runtimeIsolationHash } from "./runtime-isolation-hash";

const RECIPE_PATH = ".vuln-workbench/runtime-target.v1.json";
const DATABASE_DEPENDENCIES: Record<
	string,
	"postgres" | "mysql" | "sqlite" | "ambiguous" | "unsupported"
> = {
	pg: "postgres",
	postgres: "postgres",
	mysql: "mysql",
	mysql2: "mysql",
	sqlite3: "sqlite",
	"better-sqlite3": "sqlite",
	"@prisma/client": "ambiguous",
	prisma: "ambiguous",
	sequelize: "ambiguous",
	typeorm: "ambiguous",
	knex: "ambiguous",
	"drizzle-orm": "ambiguous",
	mongodb: "unsupported",
	mongoose: "unsupported",
	redis: "unsupported",
	ioredis: "unsupported",
};
const DATABASE_CONFIG_PATHS = [
	"prisma/schema.prisma",
	"drizzle.config.ts",
	"drizzle.config.js",
	"knexfile.ts",
	"knexfile.js",
	"ormconfig.ts",
	"ormconfig.js",
	"config/database.ts",
	"config/database.js",
] as const;

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

export type RuntimeRecipeResolution =
	| {
			status: "ready";
			recipe: RuntimeTargetRecipeV1;
			recipeHash: string;
			targetPlan: DastTargetStartPlan;
	  }
	| { status: "blocked"; reasonCode: string };

export async function resolveRuntimeTargetRecipe(params: {
	projectionPath: string;
	inferTargetPlan: (params: {
		repoPath: string;
		port: number;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
}): Promise<RuntimeRecipeResolution> {
	const [recipeFile, indicators, targetPlan] = await Promise.all([
		readRecipe(params.projectionPath),
		readDatabaseIndicators(params.projectionPath),
		params
			.inferTargetPlan({
				repoPath: params.projectionPath,
				port: 18080,
				consentProjectCodeExecution: false,
			})
			.catch(() => null),
	]);
	if (recipeFile.kind === "invalid") {
		return { status: "blocked", reasonCode: "runtime_recipe_invalid" };
	}
	if (!targetPlan) {
		return {
			status: "blocked",
			reasonCode: (await hasUnsupportedRuntimeAdapterEvidence(
				params.projectionPath,
			))
				? "runtime_dependency_adapter_unqualified"
				: "runtime_target_start_unavailable",
		};
	}
	const dependencyAdapterId = dependencyAdapterForPackageManager(
		targetPlan.packageManager,
	);
	if (
		targetPlan.pluginId !== "build.npm" ||
		!dependencyAdapterId ||
		targetPlan.requiresProjectCodeConsent
	) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		};
	}
	if (recipeFile.kind === "missing") {
		if (indicators.size === 0) {
			const recipe: RuntimeTargetRecipeV1 = {
				schemaVersion: 1,
				startPlannerId: "build.npm",
				dependencyAdapterId,
				database: { mode: "none", environmentBindings: [] },
				readinessPaths: targetPlan.readinessPaths,
			};
			return {
				status: "ready",
				recipe,
				recipeHash: runtimeIsolationHash(recipe),
				targetPlan,
			};
		}
		return {
			status: "blocked",
			reasonCode:
				indicators.size === 1 &&
				!indicators.has("ambiguous") &&
				!indicators.has("unsupported")
					? "runtime_database_recipe_required"
					: "runtime_database_mode_ambiguous",
		};
	}
	const recipe = recipeFile.recipe;
	if (recipe.dependencyAdapterId !== dependencyAdapterId) {
		return {
			status: "blocked",
			reasonCode: "runtime_dependency_adapter_unqualified",
		};
	}
	return {
		status: "ready",
		recipe,
		recipeHash: runtimeIsolationHash(recipe),
		targetPlan,
	};
}

async function hasUnsupportedRuntimeAdapterEvidence(
	root: string,
): Promise<boolean> {
	const unsupportedManifests = [
		"pom.xml",
		"build.gradle",
		"build.gradle.kts",
		"requirements.txt",
		"pyproject.toml",
		"Pipfile",
		"poetry.lock",
	] as const;
	return await Promise.any(
		unsupportedManifests.map(async (relativePath) => {
			await fs.access(path.join(root, relativePath));
			return true;
		}),
	)
		.then(() => true)
		.catch(() => false);
}

async function readRecipe(
	root: string,
): Promise<
	| { kind: "missing" }
	| { kind: "invalid" }
	| { kind: "ready"; recipe: RuntimeTargetRecipeV1 }
> {
	try {
		const raw = await fs.readFile(path.join(root, RECIPE_PATH), "utf8");
		const parsed = runtimeTargetRecipeV1Schema.safeParse(JSON.parse(raw));
		return parsed.success
			? { kind: "ready", recipe: parsed.data }
			: { kind: "invalid" };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return { kind: "missing" };
		return { kind: "invalid" };
	}
}

async function readDatabaseIndicators(root: string): Promise<Set<string>> {
	const candidates = new Set<string>();
	const packageJson = await fs
		.readFile(path.join(root, "package.json"), "utf8")
		.then((raw) => JSON.parse(raw) as PackageJson)
		.catch((): PackageJson => ({}));
	for (const dependency of Object.keys({
		...(packageJson.dependencies ?? {}),
		...(packageJson.devDependencies ?? {}),
	})) {
		const indicator = DATABASE_DEPENDENCIES[dependency];
		if (indicator) candidates.add(indicator);
	}
	for (const relativePath of DATABASE_CONFIG_PATHS) {
		if (
			await fs
				.access(path.join(root, relativePath))
				.then(() => true)
				.catch(() => false)
		) {
			candidates.add("ambiguous");
		}
	}
	return candidates;
}
