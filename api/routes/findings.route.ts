import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";
import type { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import type { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import { FindingReviewRunner } from "../modules/reviews/finding-review-runner";
import type { LlmProvider } from "../providers/types";
import type { AppEnv } from "../app/env";
import type { LlmRouter } from "../providers/llmRouter";
import type { AppDatabase } from "../db";
import {
	createFindingDecisionSchema,
	type CreateFindingDecisionInput,
} from "../../shared/schemas/scan.schema";
import { z } from "zod";

type FindingsRouteDeps = {
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
	reviewRepository: FindingReviewRepository;
	decisionRepository: FindingDecisionRepository;
	llmProvider?: LlmProvider;
	llmRouter?: LlmRouter;
	env: AppEnv;
	db: AppDatabase;
};

export function createFindingsRoute(deps: FindingsRouteDeps) {
	const {
		findingRepository,
		projectRepository,
		reviewRepository,
		decisionRepository,
		llmProvider,
		llmRouter,
		db,
	} = deps;
	const route = new Hono();

	route.get("/:findingId", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");
		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const list = await findingRepository.listEvidence(findingId);
		const latestReview = await reviewRepository.findLatestReview(findingId);
		const latestDecision =
			await decisionRepository.findLatestDecisionForFinding(findingId);

		return c.json({
			finding,
			evidence: list,
			latestReview,
			latestDecision,
		});
	});

	route.get("/:findingId/reviews", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");
		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const reviewsList = await reviewRepository.listReviews(findingId);
		return c.json({
			reviews: reviewsList,
		});
	});

	route.post("/:findingId/reviews", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");
		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const runner = new FindingReviewRunner(
			db,
			llmRouter ? { llmRouter } : llmProvider,
		);
		const result = await runner.run(findingId, {
			createdByUserId: authUser.userId,
		});

		return c.json({
			ok: result.ok,
			reviewId: result.reviewId,
			status: result.status,
			error: result.error,
		});
	});

	route.get("/:findingId/decisions", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");
		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const decisionsList =
			await decisionRepository.listDecisionsForFinding(findingId);
		return c.json({
			decisions: decisionsList,
		});
	});

	route.post("/:findingId/decisions", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");
		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		let parsed: CreateFindingDecisionInput;
		try {
			const body = await c.req.json();
			parsed = createFindingDecisionSchema.parse(body);
		} catch (err) {
			const message =
				err instanceof z.ZodError
					? err.issues.map((issue) => issue.message).join("; ")
					: err instanceof Error
						? err.message
						: String(err);
			throw new HttpError(400, `Invalid decision request: ${message}`);
		}

		try {
			const decision = await decisionRepository.createDecision({
				findingId,
				decision: parsed.decision,
				reason: parsed.reason,
				comment: parsed.comment,
				linkedReviewId: parsed.linkedReviewId,
				decidedByUserId: authUser.userId,
			});

			return c.json({
				decision,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new HttpError(400, msg);
		}
	});

	return route;
}
