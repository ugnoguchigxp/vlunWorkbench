import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";

type FindingsRouteDeps = {
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
};

export function createFindingsRoute(deps: FindingsRouteDeps) {
	const { findingRepository, projectRepository } = deps;

	return new Hono().get("/:findingId", async (c) => {
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

		return c.json({
			finding,
			evidence: list,
		});
	});
}
