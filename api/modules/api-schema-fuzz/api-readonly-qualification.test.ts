import { describe, expect, it } from "vitest";
import { redactSecretText } from "../dast/auth-material";
import { buildGraphqlReadonlyOperationPolicy } from "./graphql-readonly-policy";
import {
	buildSchemathesisNamespaceGatewayInvocation,
	buildSchemathesisNamespaceGatewayPolicy,
	operationPoliciesMatch,
	sanitizeSchemathesisOutput,
} from "./schemathesis-runner";

const digest = `sha256:${"a".repeat(64)}`;

describe("API read-only qualification contract", () => {
	it("keeps auth material in the mounted policy and out of argv", () => {
		const secret = "qualification-secret-canary";
		const policy = buildSchemathesisNamespaceGatewayPolicy({
			targetOrigin: "http://127.0.0.1:18080",
			operationPolicy: buildGraphqlReadonlyOperationPolicy(digest),
			upstreamRequestHeaders: { Authorization: `Bearer ${secret}` },
			maxRequests: 30,
			rateLimitPerSec: 2,
		});
		const invocation = buildSchemathesisNamespaceGatewayInvocation(
			"/workspace/inputs/policy.json",
			[
				"run",
				"/workspace/inputs/schema.graphql",
				"--url",
				"http://127.0.0.1:18080/graphql",
			],
		);
		expect(policy).toMatchObject({
			graphqlQueryOnly: true,
			operations: [{ method: "POST", pathTemplate: "/graphql" }],
			maxRequests: 30,
		});
		expect(JSON.stringify(policy)).toContain(secret);
		expect(JSON.stringify(invocation)).not.toContain(secret);
	});

	it("rejects policy field tampering even when the claimed hash is unchanged", () => {
		const original = buildGraphqlReadonlyOperationPolicy(digest);
		expect(
			operationPoliciesMatch(
				{ ...original, maxRequests: 1 } as unknown as typeof original,
				original,
			),
		).toBe(false);
	});

	it("redacts reflected auth values before reports are persisted", () => {
		const secret = 'canary-"quoted"';
		const output = sanitizeSchemathesisOutput(
			JSON.stringify({
				response: secret,
				escaped: JSON.stringify(secret),
			}),
			(value) =>
				redactSecretText(value, {
					kind: "named_header",
					name: "X-Api-Key",
					value: secret,
				}),
		);
		expect(output).not.toContain("canary-");
		expect(() => JSON.parse(output)).not.toThrow();
	});
});
