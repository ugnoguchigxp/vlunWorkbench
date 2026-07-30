import crypto from "node:crypto";
import type { ActiveRequest } from "../../../shared/schemas/active-assessment.schema";
import type { DastAuthSecretPayload } from "../../../shared/schemas/dast-auth.schema";
import { canonicalJson } from "../scans/diff-scan-plan";
import { authHeadersFor } from "./auth-material";
import type { ActiveAssessmentRepository } from "./active-assessment-repository";
import {
	authorizeRulesOfEngagement,
	type ActiveAuthorization,
} from "./rules-of-engagement";
import { isUrlInDastScope } from "./target-validator";
import type { ValidatedDastTarget } from "./types";

export type ActiveRequestRuntime = {
	activeAssessmentRunId: string;
	engagement: ActiveAuthorization;
	target: ValidatedDastTarget;
	repository: ActiveAssessmentRepository;
	fetchImpl?: typeof fetch;
	requestCount: number;
	lastRequestAt: number;
};

type ExecutableAssessmentRequest = Omit<ActiveRequest, "method"> & {
	method: "GET" | "HEAD" | "OPTIONS" | ActiveRequest["method"];
};

export async function executeActiveRequest(params: {
	runtime: ActiveRequestRuntime;
	request: ExecutableAssessmentRequest;
	stage: string;
	identityRole: string | null;
	authSecret?: DastAuthSecretPayload;
	requireStateChanging?: boolean;
}): Promise<{ status: number; evidenceRef: string }> {
	const authorization = authorizeRulesOfEngagement({
		engagement: params.runtime.engagement,
		target: params.runtime.target,
		method: params.request.method,
		path: params.request.path,
		requestCount: params.runtime.requestCount,
		requireStateChanging: params.requireStateChanging,
	});
	params.runtime.requestCount += 1;
	const rateLimit = Math.min(
		authorization.rateLimitPerSec,
		params.runtime.target.rateLimitPerSec,
	);
	const waitMs = Math.max(
		0,
		Math.ceil(1000 / rateLimit) -
			(performance.now() - params.runtime.lastRequestAt),
	);
	if (params.runtime.lastRequestAt > 0 && waitMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
	const startedAt = performance.now();
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		params.runtime.target.timeoutSec * 1000,
	);
	let statusCode: number | null = null;
	let errorCode: string | null = null;
	try {
		const url = new URL(
			params.request.path,
			params.runtime.target.runnerOrigin,
		).toString();
		const body = requestBody(params.request);
		const response = await (params.runtime.fetchImpl ?? fetch)(url, {
			method: params.request.method,
			headers: {
				...params.runtime.target.defaultHeaders,
				...params.request.headers,
				...body.headers,
				...authHeadersFor(params.authSecret),
			},
			body: body.value,
			redirect: "manual",
			signal: controller.signal,
		});
		statusCode = response.status;
		const location = response.headers.get("location");
		if (
			location &&
			response.status >= 300 &&
			response.status < 400 &&
			!isUrlInDastScope(
				new URL(location, url).toString(),
				params.runtime.target,
			)
		) {
			errorCode = "active_redirect_out_of_scope";
		}
		await response.body?.cancel().catch(() => undefined);
	} catch (error) {
		errorCode =
			error instanceof Error && error.name === "AbortError"
				? "active_request_timeout"
				: "active_request_failed";
	} finally {
		clearTimeout(timer);
		params.runtime.lastRequestAt = performance.now();
	}
	const evidence = await params.runtime.repository.createEvidence({
		activeAssessmentRunId: params.runtime.activeAssessmentRunId,
		method: params.request.method,
		path: new URL(params.request.path, "http://scope.invalid").pathname,
		statusCode,
		identityRole: params.identityRole,
		stage: params.stage,
		requestSha256: requestHash(params.request),
		durationMs: Math.round(performance.now() - startedAt),
		errorCode,
	});
	if (errorCode) throw new Error(errorCode);
	if (statusCode === null) throw new Error("active_request_no_status");
	return { status: statusCode, evidenceRef: evidence.id };
}

function requestBody(request: ExecutableAssessmentRequest): {
	value: BodyInit | null;
	headers: Record<string, string>;
} {
	if (request.body === null) return { value: null, headers: {} };
	if (typeof request.body === "string") {
		return { value: request.body, headers: {} };
	}
	return {
		value: JSON.stringify(request.body),
		headers: { "content-type": "application/json" },
	};
}

function requestHash(request: ExecutableAssessmentRequest): string {
	return crypto
		.createHash("sha256")
		.update(
			canonicalJson({
				method: request.method,
				path: new URL(request.path, "http://scope.invalid").pathname,
				headers: Object.keys(request.headers)
					.map((name) => name.toLowerCase())
					.sort(),
				body: request.body,
				expectedStatus: request.expectedStatus,
			}),
		)
		.digest("hex");
}
