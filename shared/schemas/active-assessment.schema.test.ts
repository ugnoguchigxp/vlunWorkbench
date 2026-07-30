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
});
