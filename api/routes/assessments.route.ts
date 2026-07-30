import { Hono } from "hono";
import { z } from "zod";
import {
	assessmentEngagementStatusSchema,
	createAssessmentEngagementSchema,
} from "../../shared/schemas/assessment.schema";
import { runActiveAssessmentRequestSchema } from "../../shared/schemas/active-assessment.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { AssessmentRepository } from "../modules/assessments/assessment-repository";
import { COVERAGE_CATALOG } from "../modules/assessments/coverage-catalog";
import { ActiveAssessmentRepository } from "../modules/dast/active-assessment-repository";
import type { ActiveAssessmentRunner } from "../modules/dast/active-assessment-runner";
import type { ScanDiagnosticRunner } from "../modules/scans/scan-diagnostic-runner";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

export function createAssessmentsRoute(deps: {
	db: AppDatabase;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	activeAssessmentRunner?: ActiveAssessmentRunner;
	scanDiagnosticRunner?: ScanDiagnosticRunner;
}) {
	const repository = new AssessmentRepository(deps.db);
	const activeRepository = new ActiveAssessmentRepository(deps.db);
	const route = new Hono();

	const assertProjectOwner = async (projectId: string, userId: string) => {
		const project = await deps.projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
	};

	route.get("/assessment-controls", (c) =>
		c.json({ controls: COVERAGE_CATALOG }),
	);
	route.get("/projects/:projectId/assessments", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, user.userId);
		return c.json({
			engagements: await repository.listEngagements(projectId, user.userId),
		});
	});
	route.post("/projects/:projectId/assessments", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, user.userId);
		const parsed = createAssessmentEngagementSchema.safeParse(
			await c.req.json(),
		);
		if (!parsed.success || parsed.data.projectId !== projectId) {
			throw new HttpError(
				400,
				parsed.success
					? "projectId must match the route"
					: parsed.error.issues.map((issue) => issue.message).join("; "),
			);
		}
		const engagement = await repository.createEngagement({
			...parsed.data,
			ownerUserId: user.userId,
		});
		return c.json({ engagement }, 201);
	});
	route.patch("/assessments/:assessmentId/status", async (c) => {
		const user = getAuthContextUser(c);
		const parsed = z
			.object({ status: assessmentEngagementStatusSchema })
			.safeParse(await c.req.json());
		if (!parsed.success) throw new HttpError(400, "Invalid assessment status");
		const engagement = await repository.setEngagementStatus(
			c.req.param("assessmentId"),
			user.userId,
			parsed.data.status,
		);
		if (!engagement) throw new HttpError(404, "Assessment not found");
		return c.json({ engagement });
	});
	route.get("/scans/:scanRunId/coverage", async (c) => {
		const user = getAuthContextUser(c);
		const scan = await deps.scanRepository.findById(c.req.param("scanRunId"));
		if (!scan) throw new HttpError(404, "Scan run not found");
		await assertProjectOwner(scan.projectId, user.userId);
		return c.json({
			controls: COVERAGE_CATALOG,
			results: await repository.listCoverageResults(scan.id),
		});
	});
	route.get("/projects/:projectId/active-assessment-runs", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, user.userId);
		return c.json({
			runs: await activeRepository.listRuns(projectId, user.userId),
		});
	});
	route.post("/projects/:projectId/active-assessment-runs", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, user.userId);
		if (!deps.activeAssessmentRunner) {
			throw new HttpError(409, "Active assessment runner is not configured");
		}
		const parsed = runActiveAssessmentRequestSchema.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success) {
			throw new HttpError(
				400,
				parsed.error.issues.map((issue) => issue.message).join("; "),
			);
		}
		const result = await deps.activeAssessmentRunner
			.run({
				projectId,
				createdByUserId: user.userId,
				request: parsed.data,
			})
			.catch((error) => {
				throw new HttpError(
					409,
					error instanceof Error ? error.message : String(error),
				);
			});
		if (deps.scanDiagnosticRunner) {
			const started = await deps.scanDiagnosticRunner.start(result.scanRunId);
			void started.completion.catch((error) => {
				console.error(
					`Automated diagnostic ${started.diagnosticRunId} failed after active assessment:`,
					error,
				);
			});
		}
		return c.json({ result }, 201);
	});
	route.get(
		"/projects/:projectId/active-assessment-runs/:activeAssessmentRunId",
		async (c) => {
			const user = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			await assertProjectOwner(projectId, user.userId);
			const run = await activeRepository.findOwnedRun(
				c.req.param("activeAssessmentRunId"),
				projectId,
				user.userId,
			);
			if (!run) throw new HttpError(404, "Active assessment run not found");
			return c.json({
				run,
				evidence: await activeRepository.listEvidence(run.id),
			});
		},
	);
	return route;
}
