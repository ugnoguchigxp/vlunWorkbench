import { scanPreflightResultSchema } from "../../../../shared/schemas/scan-preflight.schema";

export function readScanPreflightDisplay(
	metadata: Record<string, unknown> | null | undefined,
) {
	const parsed = scanPreflightResultSchema.safeParse(metadata?.scanPreflight);
	return parsed.success ? parsed.data : null;
}
