import { describe, expect, it } from "vitest";
import {
	activeTransactionSchema,
	authorizationMatrixSchema,
	runActiveAssessmentRequestSchema,
} from "./active-assessment.schema";

describe("active assessment schemas", () => {
	it("requires seed and cleanup around a bounded write", () => {
		expect(
			activeTransactionSchema.safeParse({
				id: "create-delete",
				seed: [
					{
						method: "POST",
						path: "/fixtures",
						expectedStatus: [201],
					},
				],
				request: {
					method: "PATCH",
					path: "/fixtures/1",
					expectedStatus: [200],
				},
				cleanup: [
					{
						method: "DELETE",
						path: "/fixtures/1",
						expectedStatus: [204],
					},
				],
				maxRequests: 3,
			}).success,
		).toBe(true);
	});

	it("rejects plaintext authorization headers", () => {
		const parsed = activeTransactionSchema.safeParse({
			id: "unsafe",
			seed: [
				{
					method: "POST",
					path: "/fixtures",
					headers: { Authorization: "Bearer canary" },
					expectedStatus: [201],
				},
			],
			request: {
				method: "PATCH",
				path: "/fixtures/1",
				expectedStatus: [200],
			},
			cleanup: [
				{
					method: "DELETE",
					path: "/fixtures/1",
					expectedStatus: [204],
				},
			],
			maxRequests: 3,
		});
		expect(parsed.success).toBe(false);
	});

	it("rejects ambiguous paths, secret aliases, and oversized JSON bodies", () => {
		const request = {
			method: "POST" as const,
			path: "/fixtures",
			expectedStatus: [201],
		};
		for (const path of [
			"//evil.example/path",
			"/../admin",
			"/%2e%2e/admin",
			"/safe?admin=true",
			"/safe\\admin",
		]) {
			expect(
				activeTransactionSchema.safeParse({
					id: "unsafe-path",
					seed: [{ ...request, path }],
					request: { ...request, method: "PATCH" },
					cleanup: [{ ...request, method: "DELETE" }],
					maxRequests: 3,
				}).success,
			).toBe(false);
		}
		expect(
			activeTransactionSchema.safeParse({
				id: "unsafe-header",
				seed: [{ ...request, headers: { "X-Api-Key": "canary" } }],
				request: { ...request, method: "PATCH" },
				cleanup: [{ ...request, method: "DELETE" }],
				maxRequests: 3,
			}).success,
		).toBe(false);
		expect(
			activeTransactionSchema.safeParse({
				id: "oversized-body",
				seed: [{ ...request, body: { value: "x".repeat(64_001) } }],
				request: { ...request, method: "PATCH" },
				cleanup: [{ ...request, method: "DELETE" }],
				maxRequests: 3,
			}).success,
		).toBe(false);
	});

	it("reserves enough transaction budget to execute every cleanup step", () => {
		const step = {
			method: "POST" as const,
			path: "/fixtures",
			expectedStatus: [201],
		};
		expect(
			activeTransactionSchema.safeParse({
				id: "insufficient-cleanup-budget",
				seed: [step, step],
				request: { ...step, method: "PATCH" },
				cleanup: [{ ...step, method: "DELETE" }, { ...step, method: "DELETE" }],
				maxRequests: 4,
			}).success,
		).toBe(false);
	});

	it("requires matrix object owners to reference configured actors", () => {
		const parsed = authorizationMatrixSchema.safeParse({
			actors: [
				{
					identityRole: "user-a",
					authContextId: "11111111-1111-4111-8111-111111111111",
				},
				{
					identityRole: "user-b",
					authContextId: "22222222-2222-4222-8222-222222222222",
				},
			],
			objects: [
				{ id: "a", ownerRole: "user-a", path: "/objects/a" },
				{ id: "x", ownerRole: "unknown", path: "/objects/x" },
			],
			operations: [
				{
					id: "read",
					method: "GET",
					pathTemplate: "/objects/{objectId}",
					allowedRoles: ["user-a"],
					ownerAllowed: true,
				},
			],
		});
		expect(parsed.success).toBe(false);
	});

	it("requires a complete, read-only matrix with declared unique roles", () => {
		const base = {
			engagementId: "11111111-1111-4111-8111-111111111111",
			targetConfigId: "22222222-2222-4222-8222-222222222222",
			kind: "authorization_matrix" as const,
			matrix: {
				actors: [
					{
						identityRole: "user-a",
						authContextId: "33333333-3333-4333-8333-333333333333",
					},
					{
						identityRole: "admin",
						authContextId: "44444444-4444-4444-8444-444444444444",
					},
				],
				objects: [
					{ id: "a", ownerRole: "user-a", path: "/objects/a" },
					{ id: "b", ownerRole: "user-a", path: "/objects/b" },
				],
				operations: [
					{
						id: "read",
						method: "GET" as const,
						pathTemplate: "/objects/{objectId}",
						allowedRoles: ["admin"],
						ownerAllowed: true,
					},
				],
			},
			maxRequests: 4,
		};
		expect(runActiveAssessmentRequestSchema.safeParse(base).success).toBe(true);
		expect(
			runActiveAssessmentRequestSchema.safeParse({
				...base,
				maxRequests: 3,
			}).success,
		).toBe(false);
		expect(
			runActiveAssessmentRequestSchema.safeParse({
				...base,
				matrix: {
					...base.matrix,
					operations: [
						{
							...base.matrix.operations[0],
							method: "POST",
						},
					],
				},
			}).success,
		).toBe(false);
		expect(
			runActiveAssessmentRequestSchema.safeParse({
				...base,
				matrix: {
					...base.matrix,
					operations: [
						{
							...base.matrix.operations[0],
							pathTemplate: "/objects/{objectId}/{objectId}",
							allowedRoles: ["missing-role"],
						},
					],
				},
			}).success,
		).toBe(false);
	});

	it("requires transaction auth context and identity role as a pair", () => {
		const parsed = runActiveAssessmentRequestSchema.safeParse({
			kind: "transaction",
			engagementId: "11111111-1111-4111-8111-111111111111",
			targetConfigId: "22222222-2222-4222-8222-222222222222",
			authContextId: "33333333-3333-4333-8333-333333333333",
			transaction: {
				id: "paired-auth",
				seed: [
					{ method: "POST", path: "/fixtures", expectedStatus: [201] },
				],
				request: {
					method: "PATCH",
					path: "/fixtures/1",
					expectedStatus: [200],
				},
				cleanup: [
					{
						method: "DELETE",
						path: "/fixtures/1",
						expectedStatus: [204],
					},
				],
				maxRequests: 3,
			},
		});
		expect(parsed.success).toBe(false);
	});

	it("validates an explicit bounded ZAP active profile and reset contract", () => {
		const parsed = runActiveAssessmentRequestSchema.safeParse({
			kind: "zap_active",
			profileId: "api-zap-active-lab",
			engagementId: "11111111-1111-4111-8111-111111111111",
			targetConfigId: "22222222-2222-4222-8222-222222222222",
			allowedMethods: ["GET", "POST"],
			allowedPaths: ["/api"],
			requestBudget: 100,
			durationSec: 600,
			ruleIds: [40012, 40018],
			resetStrategy: {
				kind: "http_transaction",
				seedRequests: [
					{ method: "POST", path: "/api/reset", expectedStatus: [204] },
				],
				cleanupRequests: [
					{ method: "DELETE", path: "/api/reset", expectedStatus: [204] },
				],
				baselineAssertions: [{ path: "/api/health", expectedStatus: 200 }],
			},
		});
		expect(parsed.success).toBe(true);
		expect(
			runActiveAssessmentRequestSchema.safeParse({
				...(parsed.success ? parsed.data : {}),
				ruleIds: [40012, 40012],
			}).success,
		).toBe(false);
	});
});
