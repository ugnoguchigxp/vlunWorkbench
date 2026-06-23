import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	ScanRepository,
	ProjectRepository,
	ArtifactRepository,
	FindingRepository,
} from "../modules/scans/repositories";

type ScansRouteDeps = {
	scanRepository: ScanRepository;
	projectRepository: ProjectRepository;
	artifactRepository: ArtifactRepository;
	findingRepository: FindingRepository;
};

export function createScansRoute(deps: ScansRouteDeps) {
	const {
		scanRepository,
		projectRepository,
		artifactRepository,
		findingRepository,
	} = deps;

	async function checkScanOwnership(scanRunId: string, userId: string) {
		const scan = await scanRepository.findById(scanRunId);
		if (!scan) {
			throw new HttpError(404, "Scan run not found");
		}
		const project = await projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return scan;
	}

	return new Hono()
		.get("/", async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.query("projectId");
			if (!projectId) {
				throw new HttpError(400, "Missing projectId query parameter");
			}
			const project = await projectRepository.findById(projectId);
			if (!project || project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}
			const list = await scanRepository.listScanRunsByProject(projectId);
			return c.json({ scans: list });
		})
		.get("/:scanRunId", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			const scan = await checkScanOwnership(scanRunId, authUser.userId);
			return c.json({ scan });
		})
		.get("/:scanRunId/events", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const events = await scanRepository.listScanEvents(scanRunId);
			return c.json({ events });
		})
		.get("/:scanRunId/artifacts", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await artifactRepository.listArtifacts(scanRunId);
			return c.json({ artifacts: list });
		})
		.get("/:scanRunId/findings", async (c) => {
			const authUser = getAuthContextUser(c);
			const scanRunId = c.req.param("scanRunId");
			await checkScanOwnership(scanRunId, authUser.userId);
			const list = await findingRepository.listFindings(scanRunId);
			return c.json({ findings: list });
		});
}
