import crypto from "node:crypto";
import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import {
	businessLogicScenarioSchema,
	type BusinessLogicScenario,
} from "../../../shared/schemas/business-logic.schema";
import type { ThreatHypothesis } from "../../../shared/schemas/threat-model.schema";

export function generateCatalogBusinessLogicScenario(params: {
	model: ApplicationModel;
	hypothesis: ThreatHypothesis;
	engagementId: string;
	targetConfigId: string;
	actorAuthContexts: Array<{ actorId: string; authContextId: string }>;
	cleanupPath?: string;
	cleanupMethod?:
		| "GET"
		| "HEAD"
		| "OPTIONS"
		| "POST"
		| "PUT"
		| "PATCH"
		| "DELETE";
	expectedBaselineHash?: string | null;
}): BusinessLogicScenario | null {
	const entrypoint = params.model.entrypoints.find((item) =>
		params.hypothesis.entrypointIds.includes(item.id),
	);
	const actor = params.actorAuthContexts.find((item) =>
		params.hypothesis.actorIds.includes(item.actorId),
	);
	if (!entrypoint || !actor) return null;
	const readOnly = ["GET", "HEAD", "OPTIONS"].includes(entrypoint.method);
	if (!readOnly && (!params.cleanupPath || !params.cleanupMethod)) return null;
	const requestPath = materializePath(entrypoint.path);
	const cleanupPath = params.cleanupPath ?? requestPath;
	const cleanupMethod = params.cleanupMethod ?? entrypoint.method;
	const controlId =
		entrypoint.method === "GET"
			? "owner-isolation"
			: "role-operation-separation";
	return businessLogicScenarioSchema.parse({
		id: `scenario:${crypto
			.createHash("sha256")
			.update(`${params.hypothesis.id}:${entrypoint.id}:${actor.actorId}`)
			.digest("hex")
			.slice(0, 20)}`,
		hypothesisId: params.hypothesis.id,
		controlId,
		engagementId: params.engagementId,
		targetConfigId: params.targetConfigId,
		actors: [actor],
		preconditions: [],
		seed: [],
		actions: [
			{
				actorId: actor.actorId,
				method: entrypoint.method,
				path: requestPath,
				headers: {},
				body: null,
				expectedStatus: [200, 201, 202, 204, 401, 403, 404],
			},
		],
		invariants: [
			{
				kind: "status_class",
				requestIndex: 0,
				expectedClass: 4,
			},
		],
		cleanup: [
			{
				actorId: actor.actorId,
				method: cleanupMethod,
				path: cleanupPath,
				headers: {},
				body: null,
				expectedStatus: [200, 201, 202, 204, 401, 403, 404],
			},
		],
		maxRequests: 2,
		timeoutSec: 120,
		expectedBaselineHash: params.expectedBaselineHash ?? null,
	});
}

function materializePath(template: string): string {
	return template.replace(/\{[^}]+\}/g, "fixture-object");
}
