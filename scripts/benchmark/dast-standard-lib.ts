import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runBoundedHttpAssessment } from "../../api/modules/dast/bounded-crawler";
import { evaluateDastCoverage } from "../../api/modules/dast/coverage-evaluator";
import { normalizeDastResult } from "../../api/modules/dast/dast-normalizer";
import { getDastProfile } from "../../api/modules/dast/profiles";
import type {
	DastRouteInventoryEntry,
	ValidatedDastTarget,
} from "../../api/modules/dast/types";
import {
	type DastStandardFixtureMode,
	startDastStandardFixture,
} from "../../tests/security-capability/dast-standard/app/server";

const policyPath = "spec/security-capability/dast-standard-policy.v1.json";
const groundTruthPath =
	"spec/security-capability/dast-standard-ground-truth.v1.json";
const fixtureRoot = "tests/security-capability/dast-standard/app";
const implementationInputs = [
	"api/modules/api-schema-fuzz",
	"api/modules/dast",
	"api/modules/runtime-scans",
	"api/modules/scans/tools",
	"api/modules/scans/coverage/runtime-assessment-coverage.ts",
	"shared/schemas/dast-coverage.schema.ts",
	"shared/schemas/dast.schema.ts",
	"shared/schemas/dast-auth.schema.ts",
];

type GroundTruth = {
	eligibleRoutePaths: string[];
	vulnerableFindings: Array<{ ruleId: string; path: string }>;
	fixedFindings: Array<{ ruleId: string; path: string }>;
};

type DastStandardPolicy = {
	policyId: string;
	limits: { ownedCrawlerRequests: number; maxDepth: number };
	minimums: {
		requiredSeedAttempt: number;
		routeDiscoveryRecall: number;
		routeDiscoveryPrecision: number;
		passiveCheckRecall: number;
		passiveCheckPrecision: number;
	};
	maximums: {
		allTransportErrorFalsePass: number;
		authFailureFalsePass: number;
		budgetExhaustionFalsePass: number;
		findingWithoutExecutableEvidence: number;
		secretCanaryLeakage: number;
		publicOrProductionRequests: number;
		fixtureDurationSeconds: number;
		aggregateRequestBudgetViolations: number;
	};
};

export type DastStandardBenchmarkReport = {
	schemaVersion: 1;
	benchmarkId: "owned-dast-standard-v1";
	generatedAt: string;
	gitCommit: string;
	policyId: string;
	hashes: {
		policy: string;
		groundTruth: string;
		fixture: string;
		implementation: string;
	};
	metrics: {
		requiredSeedAttempt: number;
		routeDiscoveryRecall: number;
		routeDiscoveryPrecision: number;
		passiveCheckRecall: number;
		passiveCheckPrecision: number;
		allTransportErrorFalsePass: number;
		authFailureFalsePass: number;
		budgetExhaustionFalsePass: number;
		findingWithoutExecutableEvidence: number;
		secretCanaryLeakage: number;
		publicOrProductionRequests: number;
		fixtureDurationSeconds: number;
		aggregateRequestBudgetViolations: number;
	};
	observations: {
		vulnerableVerdict: string;
		vulnerableCoverageStatus: string;
		fixedVerdict: string;
		fixedCoverageStatus: string;
		discoveredRouteCount: number;
		eligibleRouteCount: number;
		vulnerableFindingCount: number;
		fixedFindingCount: number;
		requestCount: number;
		limitationCodes: string[];
	};
	gates: Record<string, boolean>;
	gatePassed: boolean;
};

export async function measureDastStandardCapability(): Promise<DastStandardBenchmarkReport> {
	const startedAt = performance.now();
	const [policyBytes, groundTruthBytes] = await Promise.all([
		readFile(policyPath),
		readFile(groundTruthPath),
	]);
	const policy = JSON.parse(
		new TextDecoder().decode(policyBytes),
	) as DastStandardPolicy;
	const groundTruth = JSON.parse(
		new TextDecoder().decode(groundTruthBytes),
	) as GroundTruth;
	const vulnerable = await runFixture("vulnerable", policy);
	const fixed = await runFixture("fixed", policy);
	const routeMetrics = binaryMetrics(
		new Set(vulnerable.raw.routeInventory.map((entry) => entry.path)),
		new Set(groundTruth.eligibleRoutePaths),
	);
	const vulnerableActual = findingKeys(vulnerable.normalized.findings);
	const fixedActual = findingKeys(fixed.normalized.findings);
	const expectedVulnerable = new Set(
		groundTruth.vulnerableFindings.map(findingKey),
	);
	const expectedFixed = new Set(groundTruth.fixedFindings.map(findingKey));
	const expectedFindings = new Set([...expectedVulnerable, ...expectedFixed]);
	const actualFindings = new Set([...vulnerableActual, ...fixedActual]);
	const findingMetrics = binaryMetrics(actualFindings, expectedFindings);
	const required = vulnerable.raw.routeInventory.filter(
		(entry) => entry.required,
	);
	const requiredAttempted = required.filter((entry) =>
		isAttempted(entry.state),
	).length;
	const transportFalsePass = await measureTransportFalsePass(policy);
	const budgetFalsePass = await measureBudgetFalsePass(policy);
	const authFalsePass = measureAuthFailureFalsePass();
	const serializedEvidence = JSON.stringify({
		raw: vulnerable.raw,
		normalized: vulnerable.normalized,
	});
	const findingWithoutExecutableEvidence =
		vulnerable.normalized.findings.filter(
			(finding) =>
				finding.evidence.length === 0 ||
				finding.evidence.some(
					(evidence) =>
						evidence.artifactId === null ||
						typeof evidence.location?.path !== "string" ||
						evidence.location.path.length === 0,
				),
		).length;
	const requestCount = vulnerable.raw.requestCount + fixed.raw.requestCount;
	const metrics: DastStandardBenchmarkReport["metrics"] = {
		requiredSeedAttempt:
			required.length === 0 ? 0 : requiredAttempted / required.length,
		routeDiscoveryRecall: routeMetrics.recall,
		routeDiscoveryPrecision: routeMetrics.precision,
		passiveCheckRecall: findingMetrics.recall,
		passiveCheckPrecision: findingMetrics.precision,
		allTransportErrorFalsePass: transportFalsePass,
		authFailureFalsePass: authFalsePass,
		budgetExhaustionFalsePass: budgetFalsePass,
		findingWithoutExecutableEvidence,
		secretCanaryLeakage: serializedEvidence.includes("phase51-owned-fixture")
			? 1
			: 0,
		publicOrProductionRequests:
			vulnerable.nonLocalRequestCount + fixed.nonLocalRequestCount,
		fixtureDurationSeconds:
			Math.round((performance.now() - startedAt) / 10) / 100,
		aggregateRequestBudgetViolations:
			vulnerable.raw.requestCount > policy.limits.ownedCrawlerRequests ||
			fixed.raw.requestCount > policy.limits.ownedCrawlerRequests
				? 1
				: 0,
	};
	const gates = {
		requiredSeedAttempt:
			metrics.requiredSeedAttempt >= policy.minimums.requiredSeedAttempt,
		routeDiscoveryRecall:
			metrics.routeDiscoveryRecall >= policy.minimums.routeDiscoveryRecall,
		routeDiscoveryPrecision:
			metrics.routeDiscoveryPrecision >=
			policy.minimums.routeDiscoveryPrecision,
		passiveCheckRecall:
			metrics.passiveCheckRecall >= policy.minimums.passiveCheckRecall,
		passiveCheckPrecision:
			metrics.passiveCheckPrecision >= policy.minimums.passiveCheckPrecision,
		allTransportErrorFalsePass:
			metrics.allTransportErrorFalsePass <=
			policy.maximums.allTransportErrorFalsePass,
		authFailureFalsePass:
			metrics.authFailureFalsePass <= policy.maximums.authFailureFalsePass,
		budgetExhaustionFalsePass:
			metrics.budgetExhaustionFalsePass <=
			policy.maximums.budgetExhaustionFalsePass,
		findingWithoutExecutableEvidence:
			metrics.findingWithoutExecutableEvidence <=
			policy.maximums.findingWithoutExecutableEvidence,
		secretCanaryLeakage:
			metrics.secretCanaryLeakage <= policy.maximums.secretCanaryLeakage,
		publicOrProductionRequests:
			metrics.publicOrProductionRequests <=
			policy.maximums.publicOrProductionRequests,
		fixtureDuration:
			metrics.fixtureDurationSeconds <= policy.maximums.fixtureDurationSeconds,
		aggregateRequestBudget:
			metrics.aggregateRequestBudgetViolations <=
			policy.maximums.aggregateRequestBudgetViolations,
	};
	return {
		schemaVersion: 1,
		benchmarkId: "owned-dast-standard-v1",
		generatedAt: new Date().toISOString(),
		gitCommit: await gitCommit(),
		policyId: policy.policyId,
		hashes: {
			policy: sha256(policyBytes),
			groundTruth: sha256(groundTruthBytes),
			fixture: await hashTree([fixtureRoot]),
			implementation: await hashTree(implementationInputs),
		},
		metrics,
		observations: {
			vulnerableVerdict: vulnerable.normalized.verdict,
			vulnerableCoverageStatus: vulnerable.normalized.coverageStatus,
			fixedVerdict: fixed.normalized.verdict,
			fixedCoverageStatus: fixed.normalized.coverageStatus,
			discoveredRouteCount: new Set(
				vulnerable.raw.routeInventory.map((entry) => entry.path),
			).size,
			eligibleRouteCount: new Set(groundTruth.eligibleRoutePaths).size,
			vulnerableFindingCount: vulnerable.normalized.findings.length,
			fixedFindingCount: fixed.normalized.findings.length,
			requestCount,
			limitationCodes: [
				...new Set([
					...vulnerable.normalized.limitationCodes,
					...fixed.normalized.limitationCodes,
				]),
			].sort(),
		},
		gates,
		gatePassed: Object.values(gates).every(Boolean),
	};
}

export async function currentDastStandardHashes() {
	const [policyBytes, groundTruthBytes] = await Promise.all([
		readFile(policyPath),
		readFile(groundTruthPath),
	]);
	return {
		policy: sha256(policyBytes),
		groundTruth: sha256(groundTruthBytes),
		fixture: await hashTree([fixtureRoot]),
		implementation: await hashTree(implementationInputs),
	};
}

async function runFixture(
	mode: DastStandardFixtureMode,
	policy: DastStandardPolicy,
) {
	const fixture = startDastStandardFixture(mode);
	const profile = getDastProfile("web-passive-standard");
	if (!profile) throw new Error("dast_standard_profile_missing");
	const target = fixtureTarget(
		fixture.origin,
		policy.limits.ownedCrawlerRequests,
		policy.limits.maxDepth,
	);
	try {
		const raw = await runBoundedHttpAssessment({
			target,
			profile,
			profileConfigRoutes: ["/"],
			projectRoot: path.resolve(fixtureRoot),
			checkOptions: {
				aggregateRequestBudget: policy.limits.ownedCrawlerRequests,
				maxDepth: policy.limits.maxDepth,
				commonPathProbes: true,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: true,
				enforceRateLimit: false,
			},
			fetchImpl: fetch,
		});
		const normalized = normalizeDastResult({
			projectId: `owned-fixture-${mode}`,
			target,
			profile,
			result: raw,
			rawArtifactId: `owned-${mode}-raw-artifact`,
		});
		return {
			raw,
			normalized,
			nonLocalRequestCount: fixture.requests.filter(
				(request) => !request.path.startsWith("/"),
			).length,
		};
	} finally {
		await fixture.stop();
	}
}

async function measureTransportFalsePass(
	policy: DastStandardPolicy,
): Promise<number> {
	const profile = getDastProfile("web-passive-standard");
	if (!profile) throw new Error("dast_standard_profile_missing");
	const target = fixtureTarget("http://127.0.0.1:9", 5, policy.limits.maxDepth);
	const raw = await runBoundedHttpAssessment({
		target,
		profile,
		profileConfigRoutes: ["/"],
		checkOptions: {
			aggregateRequestBudget: 5,
			commonPathProbes: true,
			includeApplicationModelSeeds: false,
			includeOpenApiSeeds: false,
			enforceRateLimit: false,
		},
		fetchImpl: async () => {
			throw new Error("owned fixture connection refused");
		},
	});
	const result = normalizeDastResult({
		projectId: "transport-error-fixture",
		target,
		profile,
		result: raw,
		rawArtifactId: null,
	});
	return result.verdict === "no_findings_observed" ? 1 : 0;
}

async function measureBudgetFalsePass(
	policy: DastStandardPolicy,
): Promise<number> {
	const fixture = startDastStandardFixture("fixed");
	const profile = getDastProfile("web-passive-standard");
	if (!profile) throw new Error("dast_standard_profile_missing");
	const target = fixtureTarget(fixture.origin, 1, policy.limits.maxDepth);
	try {
		const raw = await runBoundedHttpAssessment({
			target,
			profile,
			profileConfigRoutes: ["/", "/api/health"],
			checkOptions: {
				aggregateRequestBudget: 1,
				commonPathProbes: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
				enforceRateLimit: false,
			},
			fetchImpl: fetch,
		});
		const result = normalizeDastResult({
			projectId: "budget-fixture",
			target,
			profile,
			result: raw,
			rawArtifactId: null,
		});
		return result.verdict === "no_findings_observed" ? 1 : 0;
	} finally {
		await fixture.stop();
	}
}

function measureAuthFailureFalsePass(): number {
	const route: DastRouteInventoryEntry = {
		method: "GET",
		path: "/auth",
		queryKeys: [],
		queryShapeHash: "empty",
		sources: ["configured"],
		depth: 0,
		required: true,
		authMode: "authenticated",
		state: "denied_unexpected",
		statusCode: 401,
		limitationCode: "authentication_failed",
	};
	const result = evaluateDastCoverage({
		routeInventory: [route],
		requestCount: 1,
		findingCount: 0,
		authRequired: true,
		authSucceeded: false,
	});
	return result.verdict === "no_findings_observed" ? 1 : 0;
}

function fixtureTarget(
	origin: string,
	maxRequests: number,
	maxDepth: number,
): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "owned-dast-standard-target",
		normalizedOrigin: origin,
		runnerOrigin: origin,
		allowedPaths: ["/"],
		excludedPaths: ["/excluded"],
		defaultHeaders: {},
		maxDepth,
		maxRequests,
		rateLimitPerSec: 1000,
		timeoutSec: 5,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
}

function findingKeys(
	findings: ReturnType<typeof normalizeDastResult>["findings"],
): Set<string> {
	return new Set(
		findings.map((finding) =>
			findingKey({
				ruleId: finding.ruleId,
				path:
					typeof finding.primaryLocation?.path === "string"
						? finding.primaryLocation.path
						: "",
			}),
		),
	);
}

function findingKey(value: { ruleId: string; path: string }): string {
	return `${value.ruleId}\0${value.path}`;
}

function binaryMetrics(actual: Set<string>, expected: Set<string>) {
	const truePositive = [...actual].filter((value) =>
		expected.has(value),
	).length;
	const falsePositive = [...actual].filter(
		(value) => !expected.has(value),
	).length;
	const falseNegative = [...expected].filter(
		(value) => !actual.has(value),
	).length;
	return {
		recall:
			truePositive + falseNegative === 0
				? 1
				: truePositive / (truePositive + falseNegative),
		precision:
			truePositive + falsePositive === 0
				? 1
				: truePositive / (truePositive + falsePositive),
	};
}

function isAttempted(state: DastRouteInventoryEntry["state"]): boolean {
	return [
		"attempted",
		"succeeded",
		"denied_expected",
		"denied_unexpected",
		"failed",
	].includes(state);
}

async function hashTree(inputs: string[]): Promise<string> {
	const files: string[] = [];
	for (const input of inputs) {
		const entries = await readdir(input, {
			recursive: true,
			withFileTypes: true,
		}).catch(() => null);
		if (entries === null) {
			files.push(input);
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			files.push(path.join(entry.parentPath, entry.name));
		}
	}
	const digest = crypto.createHash("sha256");
	for (const file of files.sort()) {
		digest.update(path.relative(process.cwd(), file));
		digest.update("\0");
		digest.update(await readFile(file));
		digest.update("\0");
	}
	return `sha256:${digest.digest("hex")}`;
}

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function gitCommit(): Promise<string> {
	const process = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await process.exited) !== 0) throw new Error("git_commit_unavailable");
	return (await new Response(process.stdout).text()).trim();
}
