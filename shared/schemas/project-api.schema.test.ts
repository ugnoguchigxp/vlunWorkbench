import { describe, expect, it } from "vitest";
import { projectListResponseSchema } from "./project-api.schema";

describe("project API wire contract", () => {
	it("rejects malformed identifiers and policy statuses", () => {
		const project = { id: "00000000-0000-4000-8000-000000000001", ownerUserId: "00000000-0000-4000-8000-000000000002", name: "fixture", repoPath: "/fixture", createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z", pathPolicy: { status: "blocked", reasonCode: "PROJECT_PATH_NOT_ALLOWED" } };
		expect(projectListResponseSchema.safeParse({ projects: [project] }).success).toBe(true);
		expect(projectListResponseSchema.safeParse({ projects: [{ ...project, id: "wrong" }] }).success).toBe(false);
		expect(projectListResponseSchema.safeParse({ projects: [{ ...project, pathPolicy: { status: "trusted", reasonCode: null } }] }).success).toBe(false);
	});
});
