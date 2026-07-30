import type { ApplicationModel } from "../../../shared/schemas/application-model.schema";
import {
	threatHypothesisSchema,
	type ThreatHypothesis,
} from "../../../shared/schemas/threat-model.schema";
import { canonicalJson } from "../scans/diff-scan-plan";

export function validateThreatHypothesisOutput(
	input: unknown,
	model: ApplicationModel,
): ThreatHypothesis {
	const hypothesis = threatHypothesisSchema.parse(input);
	if (hypothesis.modelSnapshotHash !== model.snapshotHash)
		throw new Error("threat_model_snapshot_mismatch");
	assertSubset(
		hypothesis.actorIds,
		new Set(model.actors.map((item) => item.id)),
		"actor",
	);
	assertSubset(
		hypothesis.assetIds,
		new Set(model.assets.map((item) => item.id)),
		"asset",
	);
	assertSubset(
		hypothesis.entrypointIds,
		new Set(model.entrypoints.map((item) => item.id)),
		"entrypoint",
	);
	const evidence = new Set(model.evidenceRefs.map(canonicalJson));
	for (const ref of hypothesis.evidenceRefs)
		if (!evidence.has(canonicalJson(ref)))
			throw new Error(`threat_external_evidence_ref:${ref.ref}`);
	if (
		hypothesis.status === "observed" &&
		hypothesis.validationKind === "unsupported"
	)
		throw new Error("unsupported_hypothesis_cannot_be_observed");
	return hypothesis;
}

function assertSubset(
	values: string[],
	allowed: Set<string>,
	kind: string,
): void {
	for (const value of values)
		if (!allowed.has(value))
			throw new Error(`threat_external_${kind}_id:${value}`);
}
