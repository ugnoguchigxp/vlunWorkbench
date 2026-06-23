import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";

type FindingReviewsRouteDeps = {
	reviewRepository: FindingReviewRepository;
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
};

export function createFindingReviewsRoute(deps: FindingReviewsRouteDeps) {
	const { reviewRepository, findingRepository, projectRepository } = deps;

	return new Hono().get("/:reviewId", async (c) => {
		const authUser = getAuthContextUser(c);
		const reviewId = c.req.param("reviewId");

		const review = await reviewRepository.findById(reviewId);
		if (!review) {
			throw new HttpError(404, "Review not found");
		}

		const finding = await findingRepository.findById(review.findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found for this review");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		return c.json({
			review,
		});
	});
}
