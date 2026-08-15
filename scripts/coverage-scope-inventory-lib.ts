import fs from "node:fs/promises";
import path from "node:path";
import { criticalCoverageTargets } from "./critical-coverage-policy";

export type CoverageClassification =
	| "selected_web"
	| "critical_api"
	| "e2e_only"
	| "unmeasured";

export type E2eCoverageEntry = {
	path: string;
	testId: string;
	spec: string;
	title: string;
};

export type CoverageScopePolicy = {
	version: number;
	selectedWebPatterns: string[];
	criticalSurfacePatterns: string[];
	criticalSurfaceExemptionBaseline: number;
	criticalSurfaceExemptions: Array<{
		path: string;
		reason: string;
		tests: string[];
	}>;
	e2eOnly: E2eCoverageEntry[];
};

const productionRoots = ["api", "shared", "web"];
const sourcePattern = /\.(?:ts|tsx)$/;
const testPattern = /\.(?:test|spec)\.(?:ts|tsx)$/;

const normalizePath = (value: string): string =>
	value.split(path.sep).join("/");

async function walk(directory: string, root: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(absolute, root)));
		} else if (
			entry.isFile() &&
			sourcePattern.test(entry.name) &&
			!testPattern.test(entry.name) &&
			!entry.name.endsWith(".d.ts")
		) {
			files.push(normalizePath(path.relative(root, absolute)));
		}
	}
	return files;
}

export async function discoverProductionFiles(
	root = process.cwd(),
): Promise<string[]> {
	const nested = await Promise.all(
		productionRoots.map((directory) => walk(path.join(root, directory), root)),
	);
	return nested.flat().sort();
}

export function matchesCoveragePattern(
	filePath: string,
	pattern: string,
): boolean {
	if (!pattern.includes("*")) return filePath === pattern;
	const escaped = pattern
		.split("*")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp(`^${escaped}$`).test(filePath);
}

export async function loadCoverageScopePolicy(
	root = process.cwd(),
): Promise<CoverageScopePolicy> {
	return JSON.parse(
		await fs.readFile(
			path.join(root, "scripts/coverage-scope-policy.v1.json"),
			"utf8",
		),
	) as CoverageScopePolicy;
}

export function classifyProductionFiles(
	files: readonly string[],
	policy: CoverageScopePolicy,
): Array<{ path: string; classification: CoverageClassification }> {
	const critical = new Set(
		criticalCoverageTargets.map((target) => target.path),
	);
	const e2e = new Set(policy.e2eOnly.map((entry) => entry.path));
	return files.map((filePath) => {
		if (critical.has(filePath)) {
			return { path: filePath, classification: "critical_api" };
		}
		if (e2e.has(filePath)) {
			return { path: filePath, classification: "e2e_only" };
		}
		if (
			policy.selectedWebPatterns.some((pattern) =>
				matchesCoveragePattern(filePath, pattern),
			)
		) {
			return { path: filePath, classification: "selected_web" };
		}
		return { path: filePath, classification: "unmeasured" };
	});
}

export async function validateE2eCoverageEntries(
	entries: readonly E2eCoverageEntry[],
	productionFiles: ReadonlySet<string>,
	root = process.cwd(),
): Promise<string[]> {
	const errors: string[] = [];
	const ids = new Set<string>();
	for (const entry of entries) {
		if (!productionFiles.has(entry.path)) {
			errors.push(`E2E-only source does not exist: ${entry.path}`);
		}
		if (!entry.testId || ids.has(entry.testId)) {
			errors.push(`E2E test ID is missing or duplicated: ${entry.testId}`);
		}
		ids.add(entry.testId);
		try {
			const spec = await fs.readFile(path.join(root, entry.spec), "utf8");
			if (!spec.includes(entry.title)) {
				errors.push(`${entry.testId} title is missing from ${entry.spec}`);
			}
		} catch {
			errors.push(`E2E spec does not exist: ${entry.spec}`);
		}
	}
	return errors;
}
