import { Hono } from "hono";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { ArtifactStorage } from "../modules/scans/artifact-storage";
import { buildMarkdownReport as defaultBuildMarkdownReport } from "../modules/scans/report-builder";
import type { ScanReportRepository } from "../modules/scans/report-repository";
import type {
	ArtifactRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

type ScanReportsRouteDeps = {
	scanReportRepository: ScanReportRepository;
	scanRepository: ScanRepository;
	projectRepository: ProjectRepository;
	artifactRepository: ArtifactRepository;
	artifactStorage: ArtifactStorage;
	db: AppDatabase;
	buildMarkdownReport?: typeof defaultBuildMarkdownReport;
};

export function createScanReportsRoute(deps: ScanReportsRouteDeps) {
	const {
		scanReportRepository,
		scanRepository,
		projectRepository,
		artifactRepository,
		artifactStorage,
		db,
	} = deps;
	const buildMarkdownReport =
		deps.buildMarkdownReport ?? defaultBuildMarkdownReport;

	const isMissingFileError = (err: unknown): boolean =>
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code?: unknown }).code === "ENOENT";

	const getBooleanOption = (
		options: unknown,
		key: "includeFalsePositives" | "includeDeferred" | "includeUndecided",
	) => {
		if (!options || typeof options !== "object") return true;
		const value = (options as Record<string, unknown>)[key];
		return typeof value === "boolean" ? value : true;
	};

	async function regenerateReportArtifact(report: {
		id: string;
		scanRunId: string;
		title: string;
		options: unknown;
	}) {
		const markdown = await buildMarkdownReport(db, report.scanRunId, {
			includeFalsePositives: getBooleanOption(
				report.options,
				"includeFalsePositives",
			),
			includeDeferred: getBooleanOption(report.options, "includeDeferred"),
			includeUndecided: getBooleanOption(report.options, "includeUndecided"),
			title: report.title,
		});
		const saveResult = await artifactStorage.saveTextArtifact(
			report.scanRunId,
			"reports",
			markdown,
			`report-${report.id}.md`,
		);
		const artifact = await artifactRepository.createArtifact({
			scanRunId: report.scanRunId,
			toolRunId: null,
			kind: "report",
			format: "markdown",
			path: saveResult.path,
			sha256: saveResult.sha256,
			sizeBytes: saveResult.sizeBytes,
			metadata: { reportId: report.id, regenerated: true },
		});
		await scanReportRepository.updateReportStatus(report.id, "completed", {
			artifactId: artifact.id,
			summary: markdown.slice(0, 500),
		});
		return markdown;
	}

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
				const content = await regenerateReportArtifact(report);
				return c.body(content, 200, buildDownloadHeaders(report));
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

			let content: string;
			try {
				content = await artifactStorage.readTextArtifact(artifact.path);
			} catch (err) {
				if (!isMissingFileError(err)) {
					throw err;
				}
				content = await regenerateReportArtifact(report);
			}
			return c.body(content, 200, buildDownloadHeaders(report));
		});
}

function buildDownloadHeaders(report: { id: string; title: string }) {
	const safeTitle = report.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.substring(0, 30);
	const filename = `${safeTitle || "report"}-${report.id.slice(0, 8)}.md`;

	return {
		"Content-Type": "text/markdown; charset=utf-8",
		"Content-Disposition": `attachment; filename="${filename}"`,
	};
}
