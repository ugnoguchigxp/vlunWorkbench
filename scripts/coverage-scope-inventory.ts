import {
	classifyProductionFiles,
	discoverProductionFiles,
	loadCoverageScopePolicy,
	matchesCoveragePattern,
	validateE2eCoverageEntries,
} from "./coverage-scope-inventory-lib";
import fs from "node:fs/promises";
import {
	criticalCoverageTargetBaseline,
	criticalCoverageTargets,
	criticalCoverageTests,
} from "./critical-coverage-policy";

const files = await discoverProductionFiles();
const policy = await loadCoverageScopePolicy();
const classifications = classifyProductionFiles(files, policy);
const errors = await validateE2eCoverageEntries(policy.e2eOnly, new Set(files));
const criticalTests = new Set(criticalCoverageTests);
const criticalPaths = new Set(
	criticalCoverageTargets.map((target) => target.path),
);
const criticalExemptions = new Map(
	policy.criticalSurfaceExemptions.map((entry) => [entry.path, entry]),
);

if (criticalCoverageTargets.length < criticalCoverageTargetBaseline) {
	errors.push(
		`Critical target count ${criticalCoverageTargets.length} is below ratchet ${criticalCoverageTargetBaseline}.`,
	);
}
for (const target of criticalCoverageTargets) {
	if (!files.includes(target.path)) {
		errors.push(`Critical coverage target does not exist: ${target.path}`);
	}
	if (target.minimum <= 0 || target.minimum > 100) {
		errors.push(`Critical threshold is invalid: ${target.path}`);
	}
}
if (criticalTests.size !== criticalCoverageTests.length) {
	errors.push("Critical coverage test list contains a duplicate.");
}
if (
	policy.criticalSurfaceExemptions.length >
	policy.criticalSurfaceExemptionBaseline
) {
	errors.push(
		`Unthresholded critical surface count ${policy.criticalSurfaceExemptions.length} exceeds ratchet ${policy.criticalSurfaceExemptionBaseline}.`,
	);
}
for (const file of files.filter((candidate) =>
	policy.criticalSurfacePatterns.some((pattern) =>
		matchesCoveragePattern(candidate, pattern),
	),
)) {
	if (!criticalPaths.has(file) && !criticalExemptions.has(file)) {
		errors.push(
			`Critical surface file requires a threshold and test or reviewed exemption: ${file}`,
		);
	}
}
for (const exemption of policy.criticalSurfaceExemptions) {
	if (!files.includes(exemption.path) || !exemption.reason.trim()) {
		errors.push(`Invalid critical surface exemption: ${exemption.path}`);
	}
	for (const test of exemption.tests) {
		try {
			await fs.access(test);
		} catch {
			errors.push(`Critical surface exemption test is missing: ${test}`);
		}
	}
}

const counts = Object.fromEntries(
	["selected_web", "critical_api", "e2e_only", "unmeasured"].map(
		(classification) => [
			classification,
			classifications.filter((entry) => entry.classification === classification)
				.length,
		],
	),
);
const result = {
	scopeKind: "repository_measurement",
	measurementOnly: true,
	policyVersion: policy.version,
	ok: errors.length === 0 && classifications.length === files.length,
	productionFiles: files.length,
	unclassified: 0,
	criticalTargetBaseline: criticalCoverageTargetBaseline,
	criticalTargets: criticalCoverageTargets.length,
	criticalSurfaceExemptionBaseline: policy.criticalSurfaceExemptionBaseline,
	criticalSurfaceExemptions: policy.criticalSurfaceExemptions.length,
	counts,
	files: classifications,
	errors,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) process.exitCode = 1;
