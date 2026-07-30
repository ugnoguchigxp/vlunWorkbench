import { isIP } from "node:net";
import {
	rulesOfEngagementSchema,
	type AssessmentEnvironment,
} from "../../../shared/schemas/assessment.schema";
import type { ValidatedDastTarget } from "./types";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type ActiveAuthorization = {
	engagementId: string;
	projectId: string;
	status: string;
	environment: AssessmentEnvironment;
	startsAt: Date | string;
	expiresAt: Date | string;
	rulesOfEngagement: unknown;
};

export function authorizeRulesOfEngagement(params: {
	engagement: ActiveAuthorization;
	target: ValidatedDastTarget;
	method: string;
	path: string;
	requestCount: number;
	requireStateChanging?: boolean;
	now?: Date;
}): {
	engagementId: string;
	method: string;
	path: string;
	remainingRequestBudget: number;
	rateLimitPerSec: number;
} {
	const now = params.now ?? new Date();
	const engagement = params.engagement;
	if (engagement.status !== "active") throw new Error("roe_not_active");
	if (
		new Date(engagement.startsAt).getTime() > now.getTime() ||
		new Date(engagement.expiresAt).getTime() <= now.getTime()
	) {
		throw new Error("roe_engagement_expired");
	}
	if (engagement.environment === "production") {
		throw new Error("active_scan_production_rejected");
	}
	if (!["local", "ephemeral", "staging"].includes(engagement.environment)) {
		throw new Error("active_scan_environment_rejected");
	}
	if (params.target.resolvedAddresses.some(isPublicAddress)) {
		throw new Error("active_scan_public_target_rejected");
	}
	const roe = rulesOfEngagementSchema.parse(engagement.rulesOfEngagement);
	if (Date.parse(roe.expiresAt) <= now.getTime())
		throw new Error("roe_expired");
	const method = params.method.toUpperCase();
	if (params.requireStateChanging !== false && READ_ONLY_METHODS.has(method)) {
		throw new Error("active_policy_requires_state_changing_method");
	}
	if (!roe.allowedMethods.includes(method as never)) {
		throw new Error("roe_method_not_allowed");
	}
	if (!pathAllowed(params.path, roe.allowedPaths)) {
		throw new Error("roe_path_not_allowed");
	}
	if (params.requestCount >= roe.requestBudget) {
		throw new Error("roe_request_budget_exhausted");
	}
	return {
		engagementId: engagement.engagementId,
		method,
		path: params.path,
		remainingRequestBudget: roe.requestBudget - params.requestCount - 1,
		rateLimitPerSec: roe.rateLimitPerSec,
	};
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
	const normalized = new URL(path, "http://scope.invalid").pathname;
	return allowedPaths.some((allowed) => {
		const prefix = new URL(allowed, "http://scope.invalid").pathname;
		return (
			normalized === prefix ||
			normalized.startsWith(`${prefix.replace(/\/$/, "")}/`)
		);
	});
}

function isPublicAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const parts = address.split(".").map(Number);
		return !(
			parts[0] === 10 ||
			parts[0] === 127 ||
			(parts[0] === 169 && parts[1] === 254) ||
			(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
			(parts[0] === 192 && parts[1] === 168)
		);
	}
	if (isIP(address) === 6) {
		const lower = address.toLowerCase();
		return !(
			lower === "::1" ||
			lower.startsWith("fc") ||
			lower.startsWith("fd") ||
			lower.startsWith("fe8") ||
			lower.startsWith("fe9") ||
			lower.startsWith("fea") ||
			lower.startsWith("feb")
		);
	}
	return true;
}
