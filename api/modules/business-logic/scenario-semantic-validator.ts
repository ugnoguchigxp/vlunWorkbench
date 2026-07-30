import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import {
	businessLogicScenarioSchema,
	type BusinessLogicScenario,
} from "../../../shared/schemas/business-logic.schema";
import type { ThreatHypothesis } from "../../../shared/schemas/threat-model.schema";
import { relativePathMatchesPrefix } from "../../../shared/schemas/http-target.schema";

export function validateBusinessLogicScenario(params: {
	input: unknown;
	model: ApplicationModel;
	hypothesis: ThreatHypothesis;
	allowedMethods: string[];
	allowedPaths: string[];
	maxRequests: number;
}): BusinessLogicScenario {
	const scenario = businessLogicScenarioSchema.parse(params.input);
	if (scenario.hypothesisId !== params.hypothesis.id)
		throw new Error("business_logic_hypothesis_mismatch");
	const modelActors = new Set(params.model.actors.map((actor) => actor.id));
	for (const actor of scenario.actors)
		if (!modelActors.has(actor.actorId))
			throw new Error(`business_logic_external_actor:${actor.actorId}`);
	const scenarioActors = new Set(scenario.actors.map((actor) => actor.actorId));
	const endpointKeys = new Set(
		params.model.entrypoints.map(
			(entrypoint) => `${entrypoint.method}:${entrypoint.path}`,
		),
	);
	for (const request of [
		...scenario.seed,
		...scenario.actions,
		...scenario.cleanup,
	]) {
		if (!scenarioActors.has(request.actorId))
			throw new Error(`business_logic_unbound_actor:${request.actorId}`);
		if (!params.allowedMethods.includes(request.method))
			throw new Error(`business_logic_method_out_of_scope:${request.method}`);
		if (
			!params.allowedPaths.some((allowed) =>
				relativePathMatchesPrefix(request.path, allowed),
			)
		)
			throw new Error(`business_logic_path_out_of_scope:${request.path}`);
		const templateMatch = [...endpointKeys].some((key) =>
			requestMatchesEndpoint(request.method, request.path, key),
		);
		if (!templateMatch)
			throw new Error(
				`business_logic_endpoint_not_in_model:${request.method}:${request.path}`,
			);
	}
	if (scenario.maxRequests > params.maxRequests || scenario.maxRequests > 100)
		throw new Error("business_logic_budget_exceeded");
	return scenario;
}

function requestMatchesEndpoint(
	method: string,
	requestPath: string,
	endpointKey: string,
): boolean {
	const [endpointMethod, template] = endpointKey.split(":", 2);
	if (method !== endpointMethod) return false;
	const expression = new RegExp(
		`^${template
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\\\{[^}]+\\\}/g, "[^/]+")}$`,
	);
	return expression.test(requestPath);
}
