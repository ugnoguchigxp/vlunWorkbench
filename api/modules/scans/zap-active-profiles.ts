import type { ScanProfile } from "../../../shared/schemas/scan-profile.schema";

export const ZAP_ACTIVE_DEDICATED_PROFILES = [
	{
		id: "runtime-zap-active-lab",
		name: "ZAP Active Disposable Web Lab",
		description:
			"Dedicated active-assessment API profile for an internal local/ephemeral target with RoE, explicit rules, bounded gateway, and reset contract. It is intentionally unavailable to the generic scan launcher.",
		category: "detailed",
		enabled: false,
		defaultTimeoutSec: 1_200,
		tools: [],
		steps: [],
	},
	{
		id: "api-zap-active-lab",
		name: "ZAP Active Disposable API Lab",
		description:
			"Dedicated OpenAPI-aware active-assessment API profile with the same disposable-target and reset requirements. It is intentionally unavailable to the generic scan launcher.",
		category: "detailed",
		enabled: false,
		defaultTimeoutSec: 1_200,
		tools: [],
		steps: [],
	},
] satisfies ScanProfile[];
