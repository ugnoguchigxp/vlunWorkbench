import fs from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import {
	createNightworkersIntegrationRoutes,
	createNightworkersSecurityIntelligenceRoutes,
	NightworkersIntegrationService,
	NightworkersSecurityIntelligenceService,
} from "../modules/integrations/nightworkers";
import { NightworkersIntegrationRepository } from "../modules/integrations/nightworkers/nightworkers-integration.repository";
import { NightworkersRequestGuard } from "../modules/integrations/nightworkers/nightworkers-integration-auth.middleware";
import { emitNightworkersSecurityIntelligenceTelemetry } from "../modules/integrations/nightworkers/nightworkers-security-intelligence-telemetry";
import { NightworkersWorkspaceTargetGrantRepository } from "../modules/integrations/nightworkers/nightworkers-workspace-target-grant.repository";
import { NightworkersWorkspaceTargetGrantService } from "../modules/integrations/nightworkers/nightworkers-workspace-target-grant.service";
import { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { ProjectDeletionService } from "../modules/scans/project-deletion-service";
import { ScanReportRepository } from "../modules/scans/report-repository";
import { ReportViewStateRepository } from "../modules/scans/report-view-state-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { ScanDeletionService } from "../modules/scans/scan-deletion-service";
import { createAssessmentsRoute } from "../routes/assessments.route";
import { createBusinessLogicRoute } from "../routes/business-logic.route";
import { createDastRoute } from "../routes/dast.route";
import { createDastAuthRoute } from "../routes/dast-auth.route";
import { createDiagnosticsRoute } from "../routes/diagnostics.route";
import { createDynamicRoute } from "../routes/dynamic.route";
import { createFindingDecisionsRoute } from "../routes/finding-decisions.route";
import { createFindingReviewsRoute } from "../routes/finding-reviews.route";
import { createFindingsRoute } from "../routes/findings.route";
import { createProjectsRoute } from "../routes/projects.route";
import { createReproductionsRoute } from "../routes/reproductions.route";
import { createScanProfilesRoute } from "../routes/scan-profiles.route";
import { createScanReportsRoute } from "../routes/scan-reports.route";
import { createScansRoute } from "../routes/scans.route";
import { createStaticIntelligenceRoute } from "../routes/static-intelligence.route";
import { createThreatModelsRoute } from "../routes/threat-models.route";

import type { AppRuntime } from "./hono-runtime";

const distWebIndex = path.resolve(process.cwd(), "dist-web/index.html");
export function registerScanRoutes(app: Hono, runtime: AppRuntime): void {
	const projectRepository = new ProjectRepository(runtime.dbConnection.db);
	const scanRepository = new ScanRepository(runtime.dbConnection.db);
	const artifactRepository = new ArtifactRepository(runtime.dbConnection.db);
	const findingRepository = new FindingRepository(runtime.dbConnection.db);
	const findingReviewRepository = new FindingReviewRepository(
		runtime.dbConnection.db,
	);
	const findingDecisionRepository = new FindingDecisionRepository(
		runtime.dbConnection.db,
	);
	const scanReportRepository = new ScanReportRepository(
		runtime.dbConnection.db,
	);
	const artifactStorage = new ArtifactStorage();
	const projectDeletionService = new ProjectDeletionService({
		db: runtime.dbConnection.db,
		projectRepository,
		cleanupRunner: runtime.projectArtifactCleanupRunner,
	});
	const scanDeletionService = new ScanDeletionService({
		db: runtime.dbConnection.db,
		projectRepository,
		scanRepository,
		cleanupRunner: runtime.projectArtifactCleanupRunner,
	});
	if (runtime.env.nightworkersIntegrationEnabled) {
		const nightworkersRequestGuard = new NightworkersRequestGuard();
		const nightworkersRepository = new NightworkersIntegrationRepository(
			runtime.dbConnection.db,
		);
		const nightworkersService = new NightworkersIntegrationService({
			db: runtime.dbConnection.db,
			env: runtime.env,
			projectRepository,
			scanRepository,
			findingRepository,
			reportRepository: scanReportRepository,
			artifactRepository,
			artifactStorage,
			reportRunner: runtime.scanReportRunner,
			integrationRepository: nightworkersRepository,
			scanSupervisor: runtime.scanSupervisor,
		});
		app.route(
			"/api/integrations/nightworkers/v1",
			createNightworkersIntegrationRoutes({
				integrationClientService: runtime.integrationClientService,
				auditRepository: nightworkersRepository,
				service: nightworkersService,
				maxRequestBytes: runtime.env.nightworkersIntegrationMaxRequestBytes,
				requestGuard: nightworkersRequestGuard,
			}),
		);
		if (runtime.env.nightworkersSecurityIntelligenceEnabled) {
			const workspaceGrantRepository =
				new NightworkersWorkspaceTargetGrantRepository(runtime.dbConnection.db);
			const workspaceGrantService = new NightworkersWorkspaceTargetGrantService(
				{
					env: runtime.env,
					projectRepository,
					scanRepository,
					grantRepository: workspaceGrantRepository,
					scanSupervisor: runtime.scanSupervisor,
				},
			);
			const securityIntelligenceService =
				new NightworkersSecurityIntelligenceService({
					db: runtime.dbConnection.db,
					env: runtime.env,
					integrationRepository: nightworkersRepository,
					scanRepository,
					artifactStorage,
					telemetry: emitNightworkersSecurityIntelligenceTelemetry,
				});
			app.route(
				"/api/integrations/nightworkers/security-intelligence/v1",
				createNightworkersSecurityIntelligenceRoutes({
					integrationClientService: runtime.integrationClientService,
					auditRepository: nightworkersRepository,
					service: securityIntelligenceService,
					workspaceGrantService,
					maxRequestBytes:
						runtime.env
							.nightworkersSecurityIntelligenceWorkspaceGrantMaxRequestBytes,
					requestGuard: nightworkersRequestGuard,
				}),
			);
		}
	}

	app.route(
		"/api",
		createStaticIntelligenceRoute({
			db: runtime.dbConnection.db,
			projectRepository,
			scanRepository,
		}),
	);
	// Register the static intelligence routes before /api/projects/:projectId.
	// Hono resolves matching routes in registration order, and otherwise treats
	// "intelligence-summaries" as a project ID.
	app.route(
		"/api/projects",
		createProjectsRoute({
			projectRepository,
			scanRepository,
			scanSupervisor: runtime.scanSupervisor,
			processCapacity: runtime.webProcessCapacity,
			env: runtime.env,
			projectDeletionService,
		}),
	);
	app.route("/api/scan-profiles", createScanProfilesRoute());
	app.route(
		"/api/scans",
		createScansRoute({
			scanRepository,
			projectRepository,
			artifactRepository,
			findingRepository,
			decisionRepository: findingDecisionRepository,
			scanReportRepository,
			artifactStorage,
			db: runtime.dbConnection.db,
			llmRouter: runtime.llmRouter,
			scanSupervisor: runtime.scanSupervisor,
			scanReportRunner: runtime.scanReportRunner,
			scanDiagnosticRunner: runtime.scanDiagnosticRunner,
			scanDeletionService,
		}),
	);
	app.route(
		"/api/scan-reports",
		createScanReportsRoute({
			scanReportRepository,
			scanRepository,
			projectRepository,
			artifactRepository,
			artifactStorage,
			db: runtime.dbConnection.db,
			reportViewStateRepository: new ReportViewStateRepository(
				runtime.dbConnection.db,
			),
		}),
	);
	app.route(
		"/api/findings",
		createFindingsRoute({
			findingRepository,
			projectRepository,
			reviewRepository: findingReviewRepository,
			decisionRepository: findingDecisionRepository,
			llmProvider: runtime.llmProvider,
			llmRouter: runtime.llmRouter,
			env: runtime.env,
			db: runtime.dbConnection.db,
		}),
	);
	app.route(
		"/api/finding-reviews",
		createFindingReviewsRoute({
			reviewRepository: findingReviewRepository,
			findingRepository,
			projectRepository,
		}),
	);
	app.route(
		"/api/finding-decisions",
		createFindingDecisionsRoute({
			decisionRepository: findingDecisionRepository,
			findingRepository,
			projectRepository,
		}),
	);
	app.route(
		"/api",
		createReproductionsRoute({
			db: runtime.dbConnection.db,
			findingRepository,
			projectRepository,
			processCapacity: runtime.webProcessCapacity,
		}),
	);
	app.route(
		"/api",
		createDynamicRoute({
			db: runtime.dbConnection.db,
			findingRepository,
			projectRepository,
			processCapacity: runtime.webProcessCapacity,
		}),
	);
	app.route(
		"/api",
		createAssessmentsRoute({
			db: runtime.dbConnection.db,
			projectRepository,
			scanRepository,
			activeAssessmentRunner: runtime.activeAssessmentRunner,
			scanDiagnosticRunner: runtime.scanDiagnosticRunner,
			processCapacity: runtime.webProcessCapacity,
		}),
	);
	app.route(
		"/api",
		createBusinessLogicRoute({
			db: runtime.dbConnection.db,
			env: runtime.env,
			projectRepository,
			runner: runtime.businessLogicRunner,
		}),
	);
	app.route(
		"/api",
		createDastAuthRoute({
			db: runtime.dbConnection.db,
			env: runtime.env,
			projectRepository,
		}),
	);
	app.route(
		"/api",
		createDastRoute({
			db: runtime.dbConnection.db,
			projectRepository,
			env: runtime.env,
			processCapacity: runtime.webProcessCapacity,
		}),
	);
	app.route(
		"/api",
		createDiagnosticsRoute({
			db: runtime.dbConnection.db,
			projectRepository,
			scanRepository,
			artifactRepository,
			artifactStorage,
		}),
	);
	app.route(
		"/api",
		createThreatModelsRoute({
			db: runtime.dbConnection.db,
			env: runtime.env,
			projectRepository,
		}),
	);

	app.use("/assets/*", serveStatic({ root: "./dist-web" }));
	app.use("/favicon.ico", serveStatic({ root: "./dist-web" }));
	app.get("*", async (c) => {
		if (c.req.path.startsWith("/api/")) {
			return c.notFound();
		}
		try {
			const html = await fs.readFile(distWebIndex, "utf8");
			return c.html(html);
		} catch {
			return c.text(
				"Frontend is not built. Run `bun run build:web` or `bun run dev`.",
				404,
			);
		}
	});
}
