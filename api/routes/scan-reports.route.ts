import { Hono } from "hono";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { ScanReportRepository } from "../modules/scans/report-repository";
import type {
	ScanRepository,
	ProjectRepository,
	ArtifactRepository,
} from "../modules/scans/repositories";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";

type ScanReportsRouteDeps = {
	scanReportRepository: ScanReportRepository;
	scanRepository: ScanRepository;
	projectRepository: ProjectRepository;
	artifactRepository: ArtifactRepository;
	artifactStorage: ArtifactStorage;
};

export function createScanReportsRoute(deps: ScanReportsRouteDeps) {
	const {
		scanReportRepository,
		scanRepository,
		projectRepository,
		artifactRepository,
		artifactStorage,
	} = deps;

	async function checkReportOwnership(reportId: string, userId: string) {
		const report = await scanReportRepository.findById(reportId);
		if (!report) {
			throw new HttpError(404, "Report not found");
		}
		const scan = await scanRepository.findById(report.scanRunId);
		if (!scan) {
			throw new HttpError(404, "Scan run not found");
		}
		const project = await projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return { report, scan };
	}

	return new Hono()
		.get("/:id", async (c) => {
			const authUser = getAuthContextUser(c);
			const reportId = c.req.param("id");
			const { report } = await checkReportOwnership(reportId, authUser.userId);
			return c.json({ report });
		})
		.get("/:id/download", async (c) => {
			const authUser = getAuthContextUser(c);
			const reportId = c.req.param("id");
			const { report } = await checkReportOwnership(reportId, authUser.userId);

			if (report.status !== "completed") {
				throw new HttpError(400, "Only completed reports can be downloaded");
			}

			if (!report.artifactId) {
				throw new HttpError(404, "Report artifact not found");
			}

			// Retrieve the scan artifact metadata
			const artifactsList = await artifactRepository.listArtifacts(
				report.scanRunId,
			);
			const artifact = artifactsList.find((a) => a.id === report.artifactId);
			if (!artifact) {
				throw new HttpError(404, "Artifact metadata not found");
			}
			const metadata =
				artifact.metadata && typeof artifact.metadata === "object"
					? (artifact.metadata as Record<string, unknown>)
					: {};
			if (
				artifact.kind !== "report" ||
				artifact.format !== "markdown" ||
				metadata.reportId !== report.id
			) {
				throw new HttpError(404, "Report artifact metadata mismatch");
			}

			const content = await artifactStorage.readTextArtifact(artifact.path);

			const safeTitle = report.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.substring(0, 30);
			const filename = `${safeTitle || "report"}-${report.id.slice(0, 8)}.md`;

			return c.body(content, 200, {
				"Content-Type": "text/markdown; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
			});
		});
}
