import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createFindingDecisionsRoute } from "./finding-decisions.route";
import { HttpError } from "../modules/auth/errors";

describe("Finding Decisions Route", () => {
	const mockProjectRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return { id: "p-1", name: "Project 1", ownerUserId: "user-123" };
			}
			if (id === "p-other") {
				return { id: "p-other", name: "Project Other", ownerUserId: "other-user" };
			}
			return null;
		}),
	};

	const mockFindingRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "f-1") {
				return { id: "f-1", projectId: "p-1", ruleId: "rule-1" };
			}
			if (id === "f-other") {
				return { id: "f-other", projectId: "p-other", ruleId: "rule-1" };
			}
			return null;
		}),
	};

	const mockDecisionRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "dec-1") {
				return {
					id: "dec-1",
					findingId: "f-1",
					decision: "accepted",
					reason: "confirmed_by_review",
				};
			}
			if (id === "dec-other") {
				return {
					id: "dec-other",
					findingId: "f-other",
					decision: "needs_fix",
					reason: "confirmed_by_evidence",
				};
			}
			return null;
		}),
	};

	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", { userId: "user-123", email: "user@example.com", role: "member" });
		await next();
	});
	app.onError((err, c) => {
		if (err instanceof HttpError) {
			return c.json({ message: err.message }, err.status as any);
		}
		return c.json({ message: err.message }, 500);
	});
	app.route(
		"/",
		createFindingDecisionsRoute({
			decisionRepository: mockDecisionRepo as any,
			findingRepository: mockFindingRepo as any,
			projectRepository: mockProjectRepo as any,
		}),
	);

	it("GET /:decisionId returns decision details when authorized", async () => {
		const res = await app.request("/dec-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.decision.id).toBe("dec-1");
		expect(body.decision.decision).toBe("accepted");
	});

	it("GET /:decisionId returns 404 if decision not found", async () => {
		const res = await app.request("/dec-missing");
		expect(res.status).toBe(404);
	});

	it("GET /:decisionId returns 403 if user does not own the project", async () => {
		const res = await app.request("/dec-other");
		expect(res.status).toBe(403);
	});
});
