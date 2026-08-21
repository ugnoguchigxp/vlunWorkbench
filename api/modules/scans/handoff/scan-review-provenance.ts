export function compactToolProvenance(
	metadata: unknown,
): Record<string, unknown> {
	if (!metadata || typeof metadata !== "object") return {};
	const source = metadata as Record<string, unknown>;
	const persisted =
		source.provenance &&
		typeof source.provenance === "object" &&
		!Array.isArray(source.provenance)
			? (source.provenance as Record<string, unknown>)
			: {};
	const compact: Record<string, unknown> = {};
	for (const key of [
		"adapter",
		"runner",
		"image",
		"imageDigest",
		"policyId",
		"policyHash",
		"rulesetDigest",
		"manifestHash",
		"dataDigest",
		"dataKind",
		"dataState",
		"snapshotDate",
		"configSource",
		"reproducible",
		"toolVersion",
	]) {
		if (persisted[key] !== undefined) compact[key] = persisted[key];
		else if (source[key] !== undefined) compact[key] = source[key];
	}
	return compact;
}
