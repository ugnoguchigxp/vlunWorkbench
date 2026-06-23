import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createFindingsRoute } from "./findings.route";
import { HttpError } from "../modules/auth/errors";

describe("Findings Route", () => {
	const mockProjectRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return { id: "p-1", name: "Project 1", ownerUserId: "user-123" };
			}
			return null;
		}),
	};

	const mockFindingRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "f-1") {
				return { id: "f-1", projectId: "p-1", ruleId: "rule-1" };
			}
			return null;
		}),
		listEvidence: vi.fn().mockResolvedValue([{ id: "e-1", kind: "tool-output" }]),
	};

	const mockReviewRepo = {
		findLatestReview: vi.fn().mockResolvedValue({ id: "rev-123", status: "completed" }),
		listReviews: vi.fn().mockResolvedValue([{ id: "rev-123", status: "completed" }]),
		createReview: vi.fn().mockResolvedValue({ id: "rev-456", status: "running" }),
		updateReview: vi.fn().mockResolvedValue({ id: "rev-456", status: "completed" }),
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
		createFindingsRoute({
			findingRepository: mockFindingRepo as any,
			projectRepository: mockProjectRepo as any,
			reviewRepository: mockReviewRepo as any,
			env: { azureOpenAiDeployment: "test-deployment" } as any,
			db: {} as any,
		}),
	);

	it("GET /:findingId returns finding details with evidence and latestReview", async () => {
		const res = await app.request("/f-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.finding.id).toBe("f-1");
		expect(body.evidence.length).toBe(1);
		expect(body.latestReview.id).toBe("rev-123");
	});

	it("GET /:findingId returns 404 if finding not found", async () => {
		const res = await app.request("/f-missing");
		expect(res.status).toBe(404);
	});

	it("GET /:findingId/reviews returns reviews list", async () => {
		const res = await app.request("/f-1/reviews");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reviews).toHaveLength(1);
		expect(body.reviews[0].id).toBe("rev-123");
	});
});
