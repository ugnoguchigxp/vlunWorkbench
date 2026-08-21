import {
	type ScanPreflightCheck,
	type ScanPreflightResult,
	scanPreflightResultSchema,
} from "../../../../shared/schemas/scan-preflight.schema";

export function readScanPreflightDisplay(
	metadata: Record<string, unknown> | null | undefined,
) {
	const parsed = scanPreflightResultSchema.safeParse(metadata?.scanPreflight);
	return parsed.success ? parsed.data : null;
}

function formatCheckObservation(check: ScanPreflightCheck): string {
	const observations: string[] = [];
	if (check.expectedVersion) {
		observations.push(`expected version ${check.expectedVersion}`);
		observations.push(`observed ${check.observedVersion ?? "unavailable"}`);
	} else if (check.observedVersion) {
		observations.push(`observed ${check.observedVersion}`);
	}
	if (check.expectedDigest) {
		observations.push(`expected digest ${check.expectedDigest}`);
		observations.push(
			`observed digest ${check.observedDigest ?? "unavailable"}`,
		);
	}
	if (check.expectedPlatform) {
		observations.push(`expected platform ${check.expectedPlatform}`);
		observations.push(
			`observed platform ${check.observedPlatform ?? "unavailable"}`,
		);
	}
	if (check.action) observations.push(`action ${check.action}`);
	return observations.length > 0 ? ` (${observations.join(", ")})` : "";
}

export function formatScanPreflightFailure(
	preflight: ScanPreflightResult,
): string {
	const blocked = preflight.checks.filter(
		(check) => check.status === "blocked",
	);
	if (blocked.length === 0) {
		return `scan preflight failed: ${preflight.limitationCodes.join(", ") || "unknown preflight failure"}`;
	}
	return `scan preflight failed: ${blocked
		.map((check) => {
			const subject = check.scannerId
				? `${check.scannerId} [${check.stepId}]`
				: check.stepId;
			return `${subject}: ${check.reasonCode ?? "preflight_failed"}${formatCheckObservation(check)}`;
		})
		.join(" / ")}`;
}
