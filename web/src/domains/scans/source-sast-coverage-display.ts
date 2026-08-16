import { sourceSastCoverageSchema } from "../../../../shared/schemas/source-sast-coverage.schema";

export function readSourceSastCoverageDisplay(
	metadata: Record<string, unknown> | null | undefined,
) {
	const parsed = sourceSastCoverageSchema.safeParse(
		metadata?.sourceSastCoverage,
	);
	return parsed.success ? parsed.data : null;
}
