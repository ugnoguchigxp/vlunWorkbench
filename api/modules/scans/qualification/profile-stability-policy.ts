import type { ScanProfileStabilityQualificationV1 } from "../../../../shared/schemas/scan-profile-stability-qualification.schema";

export const PROFILE_STABILITY_POLICY_DEFINITIONS = {
	"api-readonly-stable-v1": {
		profileId: "api-readonly",
		requiredCaseIds: [
			"openapi-3.0:vulnerable",
			"openapi-3.0:fixed",
			"openapi-3.1:vulnerable",
			"openapi-3.1:fixed",
			"swagger-2.0:vulnerable",
			"swagger-2.0:fixed",
			"operation-bypass",
			"path-bypass",
			"tool-fault",
			"cleanup",
		],
		metricExpectations: {
			operationSelectionCoveragePercent: 100,
			falseNegatives: 0,
			falsePositives: 0,
			stateChangingScanRequests: 0,
		},
	},
	"remediation-verification-stable-v1": {
		profileId: "remediation-verification",
		requiredCaseIds: [
			"gitleaks:vulnerable",
			"gitleaks:fixed",
			"osv:vulnerable",
			"osv:fixed",
			"trivy:vulnerable",
			"trivy:fixed",
			"semgrep:vulnerable",
			"semgrep:fixed",
			"identity-mismatch",
			"scanner-fault",
			"legacy",
		],
		metricExpectations: {
			supportedScannerCoverage: 4,
			falseFixed: 0,
			mismatchInconclusivePercent: 100,
		},
	},
	"dynamic-verification-stable-v1": {
		profileId: "dynamic-verification",
		requiredCaseIds: [
			...(["bun", "npm", "pytest", "cargo", "go"] as const).flatMap(
				(adapter) => [
					`${adapter}:pass`,
					`${adapter}:fail`,
					`${adapter}:no-tests`,
				],
			),
			"dependency-mismatch",
			"escape",
			"runtime-fault",
			"cleanup",
		],
		metricExpectations: {
			adapterCoverage: 5,
			outcomeClassificationPercent: 100,
			executionExternalRequests: 0,
			hostMutations: 0,
		},
	},
	"authenticated-web-stable-v1": {
		profileId: "authenticated-web",
		requiredCaseIds: [
			...(["cookie", "bearer", "basic", "form", "scripted"] as const).flatMap(
				(kind) => [`${kind}:valid`, `${kind}:invalid`, `${kind}:expired`],
			),
			"auth-differential",
			"redirect-bypass",
			"login-policy",
			"auth-fault",
			"cleanup",
		],
		metricExpectations: {
			authKindCoverage: 5,
			falseAuthenticated: 0,
			scanStateChangingRequests: 0,
			outOfScopeRequests: 0,
			secretLeaks: 0,
		},
	},
	"active-technical-lab-stable-v1": {
		profileId: "active-technical-lab",
		requiredCaseIds: [
			...(
				["authorization-matrix", "transaction", "zap-active"] as const
			).flatMap((variant) => [
				`${variant}:vulnerable`,
				`${variant}:fixed`,
				`${variant}:reset`,
				`${variant}:fault`,
			]),
			"roe-bypass",
			"budget-bypass",
			"cleanup",
		],
		metricExpectations: {
			variantCoverage: 3,
			roeEscapes: 0,
			resetLeaks: 0,
			cleanupLeaks: 0,
			securityReviewsApproved: 1,
		},
	},
	"business-logic-lab-stable-v1": {
		profileId: "business-logic-lab",
		requiredCaseIds: [
			...(
				[
					"forged-review",
					"captcha-bypass",
					"negative-order",
					"zero-stars",
					"deluxe-fraud",
				] as const
			).flatMap((scenario) => [`${scenario}:vulnerable`, `${scenario}:fixed`]),
			"actor-mismatch",
			"observer-missing",
			"invariant-fault",
			"reset",
			"scenario-fault",
		],
		metricExpectations: {
			scenarioCoverage: 5,
			falsePositives: 0,
			falseFixed: 0,
			unreviewedFinalFindings: 0,
			securityReviewsApproved: 1,
		},
	},
} as const;

export type ProfileStabilityPolicyId =
	keyof typeof PROFILE_STABILITY_POLICY_DEFINITIONS;

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();
const equalStrings = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((value, index) => value === right[index]);

export function policyForProfile(profileId: string) {
	return Object.entries(PROFILE_STABILITY_POLICY_DEFINITIONS).find(
		([, policy]) => policy.profileId === profileId,
	);
}

export function evaluateProfileStabilityQualification(
	receipt: ScanProfileStabilityQualificationV1,
) {
	const entry = policyForProfile(receipt.profileId);
	if (!entry || entry[0] !== receipt.metrics.policyId)
		return { ok: false as const, reason: "qualification_policy_mismatch" };
	const [policyId, policy] = entry;
	const requiredCaseIds = sortedUnique(policy.requiredCaseIds);
	const actualCaseIds = sortedUnique(receipt.tests.map((test) => test.caseId));
	if (!equalStrings(requiredCaseIds, actualCaseIds))
		return {
			ok: false as const,
			reason: "qualification_case_set_mismatch",
			missing: requiredCaseIds.filter((id) => !actualCaseIds.includes(id)),
			unexpected: actualCaseIds.filter((id) => !requiredCaseIds.includes(id)),
		};

	for (const caseId of requiredCaseIds) {
		const repetitions = receipt.tests
			.filter((test) => test.caseId === caseId)
			.map((test) => test.repetition)
			.sort();
		if (repetitions.join(",") !== "1,2,3")
			return {
				ok: false as const,
				reason: "qualification_repetitions_invalid",
				caseId,
			};
	}

	const expectedMetrics = policy.metricExpectations as Record<string, number>;
	const metricKeys = Object.keys(receipt.metrics.values).sort();
	const expectedMetricKeys = Object.keys(expectedMetrics).sort();
	if (!equalStrings(metricKeys, expectedMetricKeys))
		return { ok: false as const, reason: "qualification_metric_set_mismatch" };
	for (const [metric, expected] of Object.entries(expectedMetrics)) {
		if (receipt.metrics.values[metric] !== expected)
			return {
				ok: false as const,
				reason: "qualification_metric_failed",
				metric,
			};
	}

	const groups = new Map(
		receipt.repeatability.groups.map((group) => [group.caseId, group]),
	);
	if (!equalStrings([...groups.keys()].sort(), requiredCaseIds))
		return {
			ok: false as const,
			reason: "qualification_repeatability_case_set_mismatch",
		};
	for (const caseId of requiredCaseIds) {
		const group = groups.get(caseId);
		if (
			!group ||
			new Set(group.normalizedResultHashes).size !== 1 ||
			new Set(group.cleanupReceiptHashes).size !== 1
		)
			return {
				ok: false as const,
				reason: "qualification_repeatability_failed",
				caseId,
			};
	}
	return { ok: true as const, policyId };
}
