import fs from "node:fs/promises";
import path from "node:path";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { FindingDecisionRepository } from "../modules/decisions/finding-decision-repository";
import {
	createNightworkersIntegrationRoutes,
	NightworkersIntegrationService,
} from "../modules/integrations/nightworkers";
import { NightworkersIntegrationRepository } from "../modules/integrations/nightworkers/nightworkers-integration.repository";
import { FindingReviewRepository } from "../modules/reviews/finding-review-repository";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { ScanReportRepository } from "../modules/scans/report-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
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
	if (runtime.env.nightworkersIntegrationEnabled) {
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
			}),
		);
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
			env: runtime.env,
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
			env: runtime.env,
		}),
	);
	app.route(
		"/api",
		createDynamicRoute({
			db: runtime.dbConnection.db,
			findingRepository,
			projectRepository,
			env: runtime.env,
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
