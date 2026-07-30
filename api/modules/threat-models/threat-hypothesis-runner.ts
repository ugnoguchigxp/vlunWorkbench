import crypto from "node:crypto";
import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import type { ThreatHypothesis } from "../../../shared/schemas/threat-model.schema";
import { validateThreatHypothesisOutput } from "./threat-output-validator";

export type ThreatHypothesisGenerator = (
	model: ApplicationModel,
) => Promise<unknown[]>;

export async function generateThreatHypotheses(params: {
	model: ApplicationModel;
	llmGenerator?: ThreatHypothesisGenerator;
}): Promise<{
	status: "completed" | "completed_with_limitations";
	llmAvailable: boolean;
	limitations: string[];
	hypotheses: ThreatHypothesis[];
}> {
	const deterministic = deterministicHypotheses(params.model);
	if (!params.llmGenerator)
		return {
			status: "completed_with_limitations",
			llmAvailable: false,
			limitations: ["llm_unavailable_deterministic_catalog_used"],
			hypotheses: deterministic,
		};
	try {
		const generated = await params.llmGenerator(params.model);
		const validated = generated.map((item) =>
			validateThreatHypothesisOutput(item, params.model),
		);
		return {
			status: "completed",
			llmAvailable: true,
			limitations: [],
			hypotheses: mergeHypotheses(deterministic, validated),
		};
	} catch {
		return {
			status: "completed_with_limitations",
			llmAvailable: false,
			limitations: ["llm_output_invalid_deterministic_catalog_used"],
			hypotheses: deterministic,
		};
	}
}

function deterministicHypotheses(model: ApplicationModel): ThreatHypothesis[] {
	return model.entrypoints.map((entrypoint) => {
		const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(
			entrypoint.method,
		);
		return {
			id: `threat:${crypto
				.createHash("sha256")
				.update(`${entrypoint.method}:${entrypoint.path}`)
				.digest("hex")
				.slice(0, 20)}`,
			modelSnapshotHash: model.snapshotHash,
			title: stateChanging
				? `Validate authorization and state transition for ${entrypoint.method} ${entrypoint.path}`
				: `Validate disclosure boundary for ${entrypoint.method} ${entrypoint.path}`,
			category: stateChanging ? "tampering" : "information_disclosure",
			actorIds: model.actors.map((actor) => actor.id),
			assetIds: model.assets.map((asset) => asset.id).slice(0, 20),
			entrypointIds: [entrypoint.id],
			preconditions: ["Execute only within the saved assessment scope."],
			expectedImpact: stateChanging
				? "An unauthorized actor may alter protected state."
				: "An unauthorized actor may read protected information.",
			evidenceRefs: entrypoint.evidenceRefs,
			confidence: entrypoint.authGuardIds.length === 0 ? "medium" : "low",
			criticality: "unknown",
			validationKind: stateChanging
				? "bounded_transaction"
				: "authorization_matrix",
			status: "hypothesis",
		};
	});
}

function mergeHypotheses(
	left: ThreatHypothesis[],
	right: ThreatHypothesis[],
): ThreatHypothesis[] {
	return [
		...new Map([...left, ...right].map((item) => [item.id, item])).values(),
	].sort((a, b) => a.id.localeCompare(b.id));
}
