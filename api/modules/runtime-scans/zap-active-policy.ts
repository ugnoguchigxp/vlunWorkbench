import {
	assessmentScopeSchema,
	rulesOfEngagementSchema,
} from "../../../shared/schemas/assessment.schema";
import type { ActiveResetStrategy } from "../../../shared/schemas/active-assessment.schema";
import { relativePathMatchesPrefix } from "../../../shared/schemas/http-target.schema";
import type { ValidatedDastTarget } from "../dast/types";
import type { ActiveAuthorization } from "../dast/rules-of-engagement";

export const ZAP_ACTIVE_POLICY_ID = "zap-active-disposable-v1";
export const ZAP_ACTIVE_DEFAULT_REQUEST_BUDGET = 500;
export const ZAP_ACTIVE_ABSOLUTE_REQUEST_BUDGET = 2_000;
export const ZAP_ACTIVE_DEFAULT_DURATION_SEC = 600;
export const ZAP_ACTIVE_ABSOLUTE_DURATION_SEC = 1_200;
export const ZAP_ACTIVE_MAX_RESPONSE_BYTES = 1024 * 1024;
export const ZAP_ACTIVE_MAX_REPORT_BYTES = 64 * 1024 * 1024;
export const ZAP_ACTIVE_ALLOWED_RULE_IDS = new Set([
	40003, 40012, 40014, 40018, 40019, 40021, 40023, 90019, 90020,
]);

export type ZapActiveAuthorization = ActiveAuthorization & {
	purpose: string;
};

export function authorizeZapActivePlan(params: {
	engagement: ZapActiveAuthorization;
	target: ValidatedDastTarget;
	methods: string[];
	paths: string[];
	plannedRequests: number;
	alreadyUsedRequests: number;
	resetStrategy: ActiveResetStrategy | null;
	featureEnabled: boolean;
	now?: Date;
}): {
	policyId: typeof ZAP_ACTIVE_POLICY_ID;
	requestBudget: number;
	rateLimitPerSec: number;
} {
	if (!params.featureEnabled) throw new Error("zap_active_feature_disabled");
	const engagement = params.engagement;
	if (engagement.status !== "active") throw new Error("roe_not_active");
	if (engagement.purpose !== "internal")
		throw new Error("zap_active_internal_only");
	if (!["local", "ephemeral"].includes(engagement.environment))
		throw new Error("zap_active_disposable_environment_required");
	const now = params.now ?? new Date();
	if (
		new Date(engagement.startsAt).getTime() > now.getTime() ||
		new Date(engagement.expiresAt).getTime() <= now.getTime()
	)
		throw new Error("roe_engagement_expired");
	if (!params.resetStrategy) throw new Error("zap_active_reset_required");
	if (params.methods.length === 0 || params.paths.length === 0)
		throw new Error("zap_active_scope_empty");
	if (
		!Number.isInteger(params.plannedRequests) ||
		params.plannedRequests < 1 ||
		params.plannedRequests > ZAP_ACTIVE_ABSOLUTE_REQUEST_BUDGET
	)
		throw new Error("zap_active_request_budget_invalid");
	const scope = assessmentScopeSchema.parse(engagement.scope);
	const roe = rulesOfEngagementSchema.parse(engagement.rulesOfEngagement);
	if (Date.parse(roe.expiresAt) <= now.getTime())
		throw new Error("roe_expired");
	if (!scope.origins.includes(params.target.normalizedOrigin))
		throw new Error("engagement_scope_origin_not_allowed");
	for (const method of new Set(
		params.methods.map((value) => value.toUpperCase()),
	)) {
		if (
			!scope.methods.includes(method as never) ||
			!roe.allowedMethods.includes(method as never)
		)
			throw new Error(`zap_active_method_not_allowed:${method}`);
	}
	for (const requestPath of new Set(params.paths)) {
		if (
			!scope.paths.some((prefix) =>
				relativePathMatchesPrefix(requestPath, prefix),
			) ||
			!roe.allowedPaths.some((prefix) =>
				relativePathMatchesPrefix(requestPath, prefix),
			)
		)
			throw new Error(`zap_active_path_not_allowed:${requestPath}`);
	}
	const remaining = roe.requestBudget - params.alreadyUsedRequests;
	if (params.plannedRequests > remaining)
		throw new Error("roe_request_budget_exhausted");
	if (roe.requestBudget > ZAP_ACTIVE_ABSOLUTE_REQUEST_BUDGET)
		throw new Error("zap_active_absolute_budget_exceeded");
	return {
		policyId: ZAP_ACTIVE_POLICY_ID,
		requestBudget: Math.min(params.plannedRequests, remaining),
		rateLimitPerSec: Math.min(roe.rateLimitPerSec, 2),
	};
}
