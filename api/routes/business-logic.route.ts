import crypto from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { businessLogicScenarioSchema } from "../../shared/schemas/business-logic.schema";
import { rulesOfEngagementSchema } from "../../shared/schemas/assessment.schema";
import type { AppEnv } from "../app/env";
import type { AppDatabase } from "../db";
import { AssessmentRepository } from "../modules/assessments/assessment-repository";
import { BusinessLogicRepository } from "../modules/business-logic/business-logic-repository";
import type { BusinessLogicRunner } from "../modules/business-logic/business-logic-runner";
import { generateCatalogBusinessLogicScenario } from "../modules/business-logic/business-logic-scenario-generator";
import { validateBusinessLogicScenario } from "../modules/business-logic/scenario-semantic-validator";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { DastRepository } from "../modules/dast/dast-repository";
import { canonicalJson } from "../modules/scans/diff-scan-plan";
import type { ProjectRepository } from "../modules/scans/repositories";

const generateRequestSchema = z
	.object({
		hypothesisId: z.string().min(1).max(200),
		engagementId: z.string().uuid(),
		targetConfigId: z.string().uuid(),
		actorAuthContexts: z
			.array(
				z.object({
					actorId: z.string().min(1).max(200),
					authContextId: z.string().uuid(),
				}),
			)
			.min(1)
			.max(20),
		cleanupPath: z.string().startsWith("/").optional(),
		cleanupMethod: z
			.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])
			.optional(),
		expectedBaselineHash: z
			.string()
			.regex(/^sha256:[a-f0-9]{64}$/)
			.nullable()
			.optional(),
	})
	.superRefine((value, ctx) => {
		if (Boolean(value.cleanupPath) !== Boolean(value.cleanupMethod)) {
			ctx.addIssue({
				code: "custom",
				path: ["cleanupPath"],
				message: "cleanupPath and cleanupMethod must be provided together",
			});
		}
	});

export function createBusinessLogicRoute(deps: {
	db: AppDatabase;
	env: AppEnv;
	projectRepository: ProjectRepository;
	runner: BusinessLogicRunner;
}) {
	const route = new Hono();
	const repository = new BusinessLogicRepository(deps.db);
	const assessments = new AssessmentRepository(deps.db);
	const dast = new DastRepository(deps.db);

	const assertOwner = async (projectId: string, ownerUserId: string) => {
		const project = await deps.projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== ownerUserId)
			throw new HttpError(403, "Forbidden");
	};

	route.get("/projects/:projectId/business-logic-scenarios", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertOwner(projectId, user.userId);
		return c.json({
			scenarios: await repository.listOwnedScenarios(projectId, user.userId),
		});
	});
	route.post(
		"/projects/:projectId/business-logic-scenarios/generate",
		async (c) => {
			if (!deps.env.businessLogicEnabled)
				throw new HttpError(409, "Business logic capability is disabled");
			const user = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			await assertOwner(projectId, user.userId);
			const parsed = generateRequestSchema.safeParse(
				await c.req.json().catch(() => null),
			);
			if (!parsed.success)
				throw new HttpError(
					400,
					parsed.error.issues[0]?.message ?? "Invalid input",
				);
			const owned = await repository.findOwnedHypothesis(
				projectId,
				user.userId,
				parsed.data.hypothesisId,
			);
			if (!owned) throw new HttpError(404, "Threat hypothesis not found");
			const scenario = generateCatalogBusinessLogicScenario({
				model: owned.snapshot.model,
				hypothesis: owned.record.hypothesis,
				...parsed.data,
			});
			if (!scenario)
				throw new HttpError(409, "No safe executable scenario was generated");
			const saved = await validateAndSave({
				projectId,
				ownerUserId: user.userId,
				scenario,
				hypothesisRecordId: owned.record.id,
				model: owned.snapshot.model,
				hypothesis: owned.record.hypothesis,
			});
			return c.json({ scenario: saved }, 201);
		},
	);
	route.post("/projects/:projectId/business-logic-scenarios", async (c) => {
		if (!deps.env.businessLogicEnabled)
			throw new HttpError(409, "Business logic capability is disabled");
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertOwner(projectId, user.userId);
		const parsed = businessLogicScenarioSchema.safeParse(
			await c.req.json().catch(() => null),
		);
		if (!parsed.success)
			throw new HttpError(
				400,
				parsed.error.issues[0]?.message ?? "Invalid input",
			);
		const owned = await repository.findOwnedHypothesis(
			projectId,
			user.userId,
			parsed.data.hypothesisId,
		);
		if (!owned) throw new HttpError(404, "Threat hypothesis not found");
		const saved = await validateAndSave({
			projectId,
			ownerUserId: user.userId,
			scenario: parsed.data,
			hypothesisRecordId: owned.record.id,
			model: owned.snapshot.model,
			hypothesis: owned.record.hypothesis,
		});
		return c.json({ scenario: saved }, 201);
	});
	route.post("/business-logic-scenarios/:scenarioId/runs", async (c) => {
		if (!deps.env.businessLogicEnabled)
			throw new HttpError(409, "Business logic capability is disabled");
		const user = getAuthContextUser(c);
		const scenario = await repository.findOwnedScenario(
			c.req.param("scenarioId"),
			user.userId,
		);
		if (!scenario)
			throw new HttpError(404, "Business logic scenario not found");
		const result = await deps.runner
			.run({
				scenarioId: scenario.id,
				projectId: scenario.projectId,
				ownerUserId: user.userId,
			})
			.catch((error) => {
				throw new HttpError(
					409,
					error instanceof Error ? error.message : String(error),
				);
			});
		return c.json({ result }, 201);
	});
	return route;

	async function validateAndSave(params: {
		projectId: string;
		ownerUserId: string;
		scenario: z.infer<typeof businessLogicScenarioSchema>;
		hypothesisRecordId: string;
		model: Parameters<typeof validateBusinessLogicScenario>[0]["model"];
		hypothesis: Parameters<
			typeof validateBusinessLogicScenario
		>[0]["hypothesis"];
	}) {
		const [engagement, target] = await Promise.all([
			assessments.findEngagement(params.scenario.engagementId),
			dast.getTargetConfig(params.scenario.targetConfigId),
		]);
		if (
			!engagement ||
			engagement.projectId !== params.projectId ||
			engagement.ownerUserId !== params.ownerUserId
		)
			throw new HttpError(409, "Assessment engagement not found");
		if (
			engagement.purpose !== "internal" ||
			!["local", "ephemeral"].includes(engagement.environment)
		)
			throw new HttpError(
				409,
				"Business logic scenarios require an internal disposable target",
			);
		if (!target || target.projectId !== params.projectId)
			throw new HttpError(409, "DAST target not found");
		const roe = rulesOfEngagementSchema.parse(engagement.rulesOfEngagement);
		const validated = validateBusinessLogicScenario({
			input: params.scenario,
			model: params.model,
			hypothesis: params.hypothesis,
			allowedMethods: roe.allowedMethods,
			allowedPaths: roe.allowedPaths,
			maxRequests: Math.min(roe.requestBudget, target.maxRequests),
		});
		const planHash = `sha256:${crypto
			.createHash("sha256")
			.update(canonicalJson(validated))
			.digest("hex")}`;
		return await repository.saveScenario({
			projectId: params.projectId,
			ownerUserId: params.ownerUserId,
			hypothesisRecordId: params.hypothesisRecordId,
			scenario: validated,
			planHash,
		});
	}
}
