import { findingRiskContextSchema } from "../../../../shared/schemas/finding-risk.schema";

export function compactReviewFindingMetadata(
	metadata: unknown,
): Record<string, unknown> {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return {};
	}
	const source = metadata as Record<string, unknown>;
	const compact: Record<string, unknown> = {};
	const risk = findingRiskContextSchema.safeParse(source.risk);
	if (risk.success) compact.risk = risk.data;
	copySafeScalars(source, compact, [
		"evidenceStrength",
		"actorRole",
		"objectId",
		"operationId",
		"expected",
		"observed",
		"statusCode",
		"activeEvidenceId",
	]);
	return compact;
}

export function compactReviewEvidenceMetadata(
	metadata: unknown,
): Record<string, unknown> {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return {};
	}
	const source = metadata as Record<string, unknown>;
	const compact: Record<string, unknown> = {};
	copySafeScalars(source, compact, [
		"activeAssessmentEvidenceId",
		"statusCode",
		"verificationKind",
		"evidenceStrength",
	]);
	return compact;
}

function copySafeScalars(
	source: Record<string, unknown>,
	target: Record<string, unknown>,
	keys: string[],
): void {
	for (const key of keys) {
		const value = source[key];
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			target[key] =
				typeof value === "string" ? truncateScalar(value, 500) : value;
		}
	}
}

function truncateScalar(value: string, maxChars: number): string {
	return value.length <= maxChars
		? value
		: `${value.slice(0, maxChars)}\n[truncated]`;
}
