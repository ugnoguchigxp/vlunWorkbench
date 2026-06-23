import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";
import type { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import { FindingReviewRunner } from "../modules/reviews/finding-review-runner";
import type { LlmProvider } from "../providers/types";
import type { AppEnv } from "../app/env";

type FindingsRouteDeps = {
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
	reviewRepository: FindingReviewRepository;
	llmProvider?: LlmProvider;
	env: AppEnv;
	db: any;
};

export function createFindingsRoute(deps: FindingsRouteDeps) {
	const {
		findingRepository,
		projectRepository,
		reviewRepository,
		llmProvider,
		env,
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

		return c.json({
			finding,
			evidence: list,
			latestReview,
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

		const runner = new FindingReviewRunner(db, llmProvider);
		const result = await runner.run(findingId, {
			createdByUserId: authUser.userId,
			modelName: env.azureOpenAiDeployment,
		});

		return c.json({
			ok: result.ok,
			reviewId: result.reviewId,
			status: result.status,
			error: result.error,
		});
	});

	return route;
}
