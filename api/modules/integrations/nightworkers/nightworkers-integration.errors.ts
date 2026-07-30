import type { IntegrationErrorCode } from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";

const DEFAULT_STATUS: Record<IntegrationErrorCode, number> = {
	integration_unauthorized: 401,
	integration_scope_denied: 403,
	rate_limit_exceeded: 429,
	project_path_denied: 403,
	project_not_found: 404,
	project_owner_mismatch: 403,
	preset_not_found: 422,
	profile_not_allowed: 422,
	target_not_supported: 422,
	preview_expired: 409,
	target_digest_mismatch: 409,
	idempotency_conflict: 409,
	scan_capacity_exceeded: 429,
	scan_not_found: 404,
	scan_not_reportable: 422,
	report_not_found: 404,
	report_not_ready: 409,
	report_too_large: 413,
	invalid_request: 400,
	provider_temporarily_unavailable: 503,
	internal_error: 500,
};

export class NightworkersIntegrationError extends Error {
	readonly status: number;
	readonly details?: Record<string, string | number | boolean | null>;

	constructor(
		readonly code: IntegrationErrorCode,
		message: string,
		readonly retryable = false,
		details?: Record<string, string | number | boolean | null>,
		status = DEFAULT_STATUS[code],
	) {
		super(message);
		this.name = "NightworkersIntegrationError";
		this.status = status;
		if (details) {
			const allowed = new Set([
				"current",
				"expiresAt",
				"limit",
				"maxBytes",
				"reason",
				"retryAfterSeconds",
				"supportedTargets",
			]);
			const safe = Object.fromEntries(
				Object.entries(details).filter(([key]) => allowed.has(key)),
			);
			if (Object.keys(safe).length > 0) this.details = safe;
		}
	}
}
