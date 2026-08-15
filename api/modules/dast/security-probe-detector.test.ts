import { describe, expect, test } from "bun:test";
import {
	detectSecurityProbe,
	type SecurityProbe,
} from "./security-probe-detector";

const context = {
	scenarioId: "juice-test",
	targetKind: "vulnerable" as const,
};

describe("security probe detector", () => {
	test("detects authorization and identity violations from observed state", () => {
		expect(
			detectSecurityProbe(
				{
					kind: "authorization",
					cwe: "CWE-639",
					status: 200,
					expectedDenied: true,
					actorRole: "user-a",
					ownerRole: "user-b",
					protectedObjectPresent: true,
				},
				context,
			)[0]?.ruleId,
		).toBe("AUTHORIZATION_BYPASS");
		expect(
			detectSecurityProbe(
				{
					kind: "identity_integrity",
					cwe: "CWE-862",
					status: 201,
					mutationAccepted: true,
					authenticatedUserId: "1",
					persistedUserId: "2",
					entityOwnerMismatch: false,
				},
				context,
			)[0]?.ruleId,
		).toBe("IDENTITY_INTEGRITY");
	});

	test("requires a differential signal for SQL injection", () => {
		const probe: SecurityProbe = {
			kind: "sql_authentication",
			cwe: "CWE-89",
			controlStatus: 401,
			probeStatus: 200,
			controlTokenPresent: false,
			probeTokenPresent: true,
		};
		expect(detectSecurityProbe(probe, context)[0]?.ruleId).toBe(
			"SQL_INJECTION",
		);
		expect(
			detectSecurityProbe({ ...probe, controlTokenPresent: true }, context),
		).toEqual([]);
	});

	test("does not create findings from observation-only or safe fixed signals", () => {
		expect(
			detectSecurityProbe(
				{
					kind: "observation_only",
					cwe: "CWE-79",
					status: 200,
					reliable: true,
				},
				context,
			),
		).toEqual([]);
		expect(
			detectSecurityProbe(
				{
					kind: "numeric_boundary",
					cwe: "CWE-20",
					status: 400,
					suppliedValue: 0,
					acceptedValue: null,
					minimum: 1,
				},
				{ ...context, targetKind: "fixed" },
			),
		).toEqual([]);
	});

	test("detects weak recovery, sensitive endpoints, and policy-bypassing redirects", () => {
		expect(
			detectSecurityProbe(
				{
					kind: "knowledge_factor_reset",
					cwe: "CWE-640",
					status: 200,
					unauthenticated: true,
					publiclyDiscoverableAnswerUsed: true,
					passwordChanged: true,
				},
				context,
			)[0]?.ruleId,
		).toBe("WEAK_PASSWORD_RECOVERY");
		expect(
			detectSecurityProbe(
				{
					kind: "sensitive_endpoint",
					cwe: "CWE-200",
					status: 200,
					unauthenticated: true,
					expectedPrivate: true,
					sensitiveContentFingerprintPresent: true,
				},
				context,
			)[0]?.ruleId,
		).toBe("SENSITIVE_ENDPOINT_EXPOSURE");
		const destination =
			"https://attacker.invalid/?next=https://github.com/juice-shop/juice-shop";
		expect(
			detectSecurityProbe(
				{
					kind: "redirect_policy",
					cwe: "CWE-601",
					status: 302,
					suppliedDestination: destination,
					redirectLocation: destination,
					destinationAllowedByPolicy: false,
				},
				context,
			)[0]?.ruleId,
		).toBe("REDIRECT_POLICY_BYPASS");
	});
});
