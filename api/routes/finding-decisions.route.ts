import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";

type FindingDecisionsRouteDeps = {
	decisionRepository: FindingDecisionRepository;
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
};

export function createFindingDecisionsRoute(deps: FindingDecisionsRouteDeps) {
	const { decisionRepository, findingRepository, projectRepository } = deps;

	return new Hono().get("/:decisionId", async (c) => {
		const authUser = getAuthContextUser(c);
		const decisionId = c.req.param("decisionId");

		const decision = await decisionRepository.findById(decisionId);
		if (!decision) {
			throw new HttpError(404, "Decision not found");
		}

		const finding = await findingRepository.findById(decision.findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found for this decision");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		return c.json({
			decision,
		});
	});
}
