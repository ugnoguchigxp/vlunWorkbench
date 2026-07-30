import { describe, expect, it } from "bun:test";
import type { AuthorizationMatrix } from "../../../shared/schemas/active-assessment.schema";
import { runAuthorizationMatrix } from "./authorization-matrix-runner";

const matrix: AuthorizationMatrix = {
	actors: [
		{
			identityRole: "user-a",
			authContextId: "11111111-1111-4111-8111-111111111111",
		},
		{
			identityRole: "user-b",
			authContextId: "22222222-2222-4222-8222-222222222222",
		},
		{
			identityRole: "admin",
			authContextId: "33333333-3333-4333-8333-333333333333",
		},
	],
	objects: [
		{ id: "object-a", ownerRole: "user-a", path: "/objects/object-a" },
		{ id: "object-b", ownerRole: "user-b", path: "/objects/object-b" },
	],
	operations: [
		{
			id: "read",
			method: "GET",
			pathTemplate: "/objects/{objectId}",
			allowedRoles: ["admin"],
			ownerAllowed: true,
		},
	],
};

describe("runAuthorizationMatrix", () => {
	it("detects cross-owner access in a vulnerable fixture", async () => {
		const result = await runAuthorizationMatrix({
			matrix,
			maxRequests: 20,
			execute: async ({ actor, object }) => ({
				status:
					actor.identityRole === "admin" ||
					actor.identityRole === object.ownerRole ||
					(actor.identityRole === "user-a" && object.id === "object-b")
						? 200
						: 403,
				evidenceRef: `${actor.identityRole}:${object.id}`,
			}),
		});
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0].ruleId).toBe("BOLA");
	});

	it("produces no finding for the fixed access matrix", async () => {
		const result = await runAuthorizationMatrix({
			matrix,
			maxRequests: 20,
			execute: async ({ actor, object }) => ({
				status:
					actor.identityRole === "admin" ||
					actor.identityRole === object.ownerRole
						? 200
						: 403,
				evidenceRef: `${actor.identityRole}:${object.id}`,
			}),
		});
		expect(result.findings).toHaveLength(0);
	});
});
