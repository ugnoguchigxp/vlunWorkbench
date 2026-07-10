import type { IntelligenceCapabilityReadiness } from "../../../../shared/schemas/static-intelligence-module.schema";

export function readinessPresentation(
	readiness: IntelligenceCapabilityReadiness,
): {
	label: string;
	nextAction: string | null;
} {
	switch (readiness.status) {
		case "available":
			return { label: "Available", nextAction: null };
		case "stale":
			return {
				label: "Stale",
				nextAction: "Refresh derived analysis for the selected scan.",
			};
		case "degraded":
			return {
				label: "Degraded",
				nextAction: "Review reason codes; usable partial data may remain.",
			};
		case "missing":
			return {
				label: "Missing",
				nextAction:
					"Refresh derived analysis to create a persisted generation.",
			};
		case "failed":
			return {
				label: "Failed",
				nextAction: "Keep the previous generation visible and retry refresh.",
			};
	}
}
