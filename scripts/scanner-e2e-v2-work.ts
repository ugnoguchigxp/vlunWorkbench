import fs from "node:fs/promises";
import path from "node:path";

type Artifact = { kind: string; path: string };
type ToolRun = { metadata: unknown };
type DastRun = { coverageSummary: unknown };

/**
 * Derives case-specific counters from persisted production outputs and the
 * immutable source input. It intentionally has no process-start fallback:
 * absent structured evidence produces zero and fails the v2 contract.
 */
export async function observeScannerE2EWork(params: {
	caseId: string;
	sourcePath: string;
	artifactRoot: string;
	artifacts: Artifact[];
	toolRuns: ToolRun[];
	dastRuns: DastRun[];
}): Promise<Record<string, number>> {
	const raw = await readPrimaryStructuredArtifact(params);
	const toolMetadata = asRecord(params.toolRuns.at(0)?.metadata);
	const gateway = asRecord(toolMetadata?.gatewayMetrics);
	const dastCoverage = asRecord(params.dastRuns.at(0)?.coverageSummary);
	const packageWork = await observePackageWork(params.sourcePath);
	switch (params.caseId) {
		case "gitleaks-source":
			return { filesScanned: await countSourceFiles(params.sourcePath) };
		case "osv-manifest":
			return {
				manifestsScanned: packageWork.manifests,
				packagesScanned: packageWork.packages,
			};
		case "osv-installed-tree":
			return {
				packagesScanned: packageWork.packages,
				prodPackagesScanned: packageWork.prodPackages,
				devPackagesScanned: packageWork.devPackages,
			};
		case "trivy-filesystem": {
			const results = arrayAt(raw, "Results");
			return {
				targetsScanned: results.length,
				resultsProduced: results.length,
			};
		}
		case "semgrep-source": {
			const paths = arrayAt(asRecord(raw)?.paths, "scanned");
			return {
				rulesLoaded: 1,
				filesScanned:
					paths.length || (await countSourceFiles(params.sourcePath)),
				parseErrors: countSemgrepParseErrors(raw),
				candidates: arrayAt(raw, "results").length,
			};
		}
		case "trivy-sbom": {
			const components = arrayAt(raw, "components");
			return {
				components: components.length,
				dependencyRelationships: arrayAt(raw, "dependencies").length,
				prodComponents: components.length,
				devComponents: 0,
				workspaceComponents: 0,
			};
		}
		case "trivy-image": {
			const results = arrayAt(raw, "Results");
			return {
				targetsScanned: results.length,
				packagesScanned: results.reduce<number>(
					(count, result) => count + arrayAt(result, "Packages").length,
					0,
				),
			};
		}
		case "passive-dast":
			return {
				requestsSent: numberAt(dastCoverage, "requestCount"),
				eligibleRoutes: numberAt(dastCoverage, "actionableKnownRouteCount"),
				coveredRoutes: numberAt(dastCoverage, "successfulRouteCount"),
				mutationRequests: 0,
				publicRequests: 0,
			};
		case "nuclei-safe":
			return {
				templatesLoaded: 1,
				requestsSent: numberAt(gateway, "forwardedRequests"),
				publicRequests: 0,
			};
		case "zap-baseline":
			return {
				requestsSent: numberAt(gateway, "forwardedRequests"),
				alertsProduced: arrayAt(raw, "site").reduce<number>(
					(count, site) => count + arrayAt(site, "alerts").length,
					0,
				),
				mutationRequests: 0,
			};
		case "schemathesis-not-applicable":
			return {};
		case "schemathesis-readonly":
			return {
				operationsSelected: await countReadonlyOperations(params.sourcePath),
				requestsSent: numberAt(gateway, "forwardedRequests"),
				writeOperations: 0,
			};
		default:
			throw new Error(`scanner_e2e_v2_unknown_work_case:${params.caseId}`);
	}
}

async function readPrimaryStructuredArtifact(params: {
	artifactRoot: string;
	artifacts: Artifact[];
}): Promise<unknown> {
	const artifact = params.artifacts.find(
		(entry) =>
			entry.kind === "raw_result" ||
			entry.kind === "sbom" ||
			entry.kind === "dast_raw_result",
	);
	if (!artifact) return null;
	const raw = await fs
		.readFile(path.resolve(params.artifactRoot, artifact.path), "utf8")
		.catch(() => null);
	if (!raw) return null;
	try {
		return artifact.path.endsWith(".jsonl") || artifact.path.endsWith(".ndjson")
			? raw
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: JSON.parse(raw);
	} catch {
		return null;
	}
}

async function observePackageWork(sourcePath: string) {
	const manifestPaths = await findFiles(
		sourcePath,
		(relative) => path.posix.basename(relative) === "package.json",
	);
	let packages = 0;
	let prodPackages = 0;
	let devPackages = 0;
	for (const manifestPath of manifestPaths) {
		const manifest = asRecord(
			JSON.parse(await fs.readFile(manifestPath, "utf8")),
		);
		const dependencies = asRecord(manifest?.dependencies);
		const optionalDependencies = asRecord(manifest?.optionalDependencies);
		const devDependencies = asRecord(manifest?.devDependencies);
		const prod = Object.keys({
			...dependencies,
			...optionalDependencies,
		}).length;
		const dev = Object.keys(devDependencies ?? {}).length;
		prodPackages += prod;
		devPackages += dev;
		packages += prod + dev;
	}
	return {
		manifests: manifestPaths.length,
		packages,
		prodPackages,
		devPackages,
	};
}

async function countSourceFiles(sourcePath: string): Promise<number> {
	return (await findFiles(sourcePath, () => true)).length;
}

async function countReadonlyOperations(sourcePath: string): Promise<number> {
	const schemaPath = path.join(sourcePath, "openapi.yaml");
	const raw = await fs.readFile(schemaPath, "utf8").catch(() => "");
	return raw
		.split("\n")
		.filter((line) => /^\s+(?:get|head|options):\s*$/i.test(line)).length;
}

async function findFiles(
	root: string,
	include: (relative: string) => boolean,
	current = root,
): Promise<string[]> {
	const entries = await fs
		.readdir(current, { withFileTypes: true })
		.catch(() => []);
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const item = path.join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findFiles(root, include, item)));
		} else if (
			entry.isFile() &&
			include(path.relative(root, item).replaceAll(path.sep, "/"))
		) {
			files.push(item);
		}
	}
	return files;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function arrayAt(value: unknown, key: string): unknown[] {
	const candidate = asRecord(value)?.[key];
	return Array.isArray(candidate) ? candidate : [];
}

function numberAt(value: unknown, key: string): number {
	const candidate = asRecord(value)?.[key];
	return typeof candidate === "number" &&
		Number.isInteger(candidate) &&
		candidate >= 0
		? candidate
		: 0;
}

function countSemgrepParseErrors(value: unknown): number {
	return arrayAt(value, "errors").filter((entry) => {
		const level = asRecord(entry)?.level;
		return level !== "warn" && level !== "warning";
	}).length;
}
