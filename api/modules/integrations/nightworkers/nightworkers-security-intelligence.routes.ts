import { Hono } from "hono";
import { z } from "zod";
import {
	NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
	type NightworkersSecurityIntelligenceErrorCode,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import { securityIntelligenceSafeTextSchema } from "../../../../shared/schemas/security-intelligence-assessment-components.schema";
import type { IntegrationClientService } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import {
	createNightworkersAuthenticationMiddleware,
	type NightworkersHonoEnv,
	requestIdFor,
	requireNightworkersScope,
} from "./nightworkers-integration-auth.middleware";
import { NightworkersSecurityIntelligenceError } from "./nightworkers-security-intelligence.errors";
import type { NightworkersSecurityIntelligenceService } from "./nightworkers-security-intelligence.service";

const resourceRefSchema = z.string().uuid();

export function createNightworkersSecurityIntelligenceRoutes(deps: {
	integrationClientService: IntegrationClientService;
	service: Pick<NightworkersSecurityIntelligenceService, "assessment">;
}) {
	const app = new Hono<NightworkersHonoEnv>();
	app.use(
		"*",
		createNightworkersAuthenticationMiddleware(deps.integrationClientService),
	);
	app.get(
		"/scans/:scanRunRef/assessment",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const parsed = resourceRefSchema.safeParse(c.req.param("scanRunRef"));
			if (!parsed.success) {
				throw new NightworkersIntegrationError(
					"invalid_request",
					"Integration request is invalid.",
				);
			}
			const data = await deps.service.assessment(
				c.get("integrationClient"),
				parsed.data,
			);
			return c.json(
				nightworkersSecurityIntelligenceSuccessEnvelopeSchema.parse({
					contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
					requestId: requestIdFor(c),
					data,
				}),
			);
		},
	);

	app.onError((error, c) => {
		const safe = safeError(error);
		if (!safe.known) {
			console.error(
				JSON.stringify({
					version: 1,
					level: "error",
					event: "nightworkers.security_intelligence.request_failed",
					requestId: requestIdFor(c),
					errorName: error instanceof Error ? error.name : "UnknownError",
				}),
			);
		}
		return c.json(
			{
				contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
				requestId: requestIdFor(c),
				error: {
					code: safe.code,
					message: safe.message,
					retryable: safe.retryable,
				},
			},
			safe.status,
		);
	});
	return app;
}

function safeError(error: unknown): {
	known: boolean;
	code: NightworkersSecurityIntelligenceErrorCode;
	message: string;
	retryable: boolean;
	status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;
} {
	if (error instanceof NightworkersSecurityIntelligenceError) {
		return {
			known: true,
			code: error.code,
			message: safeMessage(error.message),
			retryable: error.retryable,
			status: integrationStatus(error.status),
		};
	}
	if (error instanceof NightworkersIntegrationError) {
		return {
			known: true,
			code: error.code,
			message: safeMessage(error.message),
			retryable: error.retryable,
			status: integrationStatus(error.status),
		};
	}
	return {
		known: false,
		code: "internal_error",
		message: "Security Intelligence integration request failed.",
		retryable: false,
		status: 500,
	};
}

function safeMessage(value: string): string {
	const parsed = securityIntelligenceSafeTextSchema.safeParse(value);
	return parsed.success
		? parsed.data
		: "Security Intelligence integration request failed.";
}

function integrationStatus(
	value: number,
): 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503 {
	if (
		value === 400 ||
		value === 401 ||
		value === 403 ||
		value === 404 ||
		value === 409 ||
		value === 413 ||
		value === 422 ||
		value === 429 ||
		value === 500 ||
		value === 503
	) {
		return value;
	}
	return 500;
}
