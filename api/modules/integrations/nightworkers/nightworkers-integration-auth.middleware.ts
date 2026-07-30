import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import {
	type IntegrationErrorCode,
	NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
	type NightworkersIntegrationScope,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import {
	IntegrationClientAuthenticationError,
	type IntegrationClientService,
} from "../../integrationClients/integration-client.service";

export type NightworkersHonoEnv = {
	Variables: {
		integrationClient: AuthenticatedIntegrationClient;
		integrationRequestId: string;
		integrationAuditContext: {
			scope: string;
			operation: string;
			pathHash?: string;
			idempotencyKeyHash?: string;
			resourceRef?: string;
		} | null;
	};
};

type RateWindow = { startedAt: number; count: number };

export function createNightworkersAuthenticationMiddleware(
	service: IntegrationClientService,
): MiddlewareHandler<NightworkersHonoEnv> {
	const rateWindows = new Map<string, RateWindow>();
	return async (c, next) => {
		const requestId = requestIdFor(c);
		c.set("integrationRequestId", requestId);
		c.set("integrationAuditContext", null);
		c.header("X-Request-Id", requestId);
		const authorization = c.req.header("authorization");
		const match = authorization?.match(/^Bearer ([^\s]+)$/);
		let client: AuthenticatedIntegrationClient | null = null;
		if (match) {
			try {
				client = await service.authenticate(match[1], {
					updateLastUsed: false,
				});
			} catch (error) {
				if (!(error instanceof IntegrationClientAuthenticationError)) {
					throw error;
				}
			}
		}
		if (!client) {
			return integrationErrorResponse(
				c,
				requestId,
				"integration_unauthorized",
				"Valid integration bearer authentication is required.",
				false,
				401,
			);
		}

		const now = Date.now();
		const current = rateWindows.get(client.id);
		const window =
			!current || now - current.startedAt >= client.rateLimitPolicy.windowMs
				? { startedAt: now, count: 0 }
				: current;
		window.count += 1;
		rateWindows.set(client.id, window);
		if (window.count > client.rateLimitPolicy.limit) {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil(
					(client.rateLimitPolicy.windowMs - (now - window.startedAt)) / 1_000,
				),
			);
			c.header("Retry-After", String(retryAfterSeconds));
			return integrationErrorResponse(
				c,
				requestId,
				"rate_limit_exceeded",
				"Integration client rate limit exceeded.",
				true,
				429,
				{ retryAfterSeconds },
			);
		}
		c.set("integrationClient", client);
		await service.markUsed(client.id);
		await next();
	};
}

export function requireNightworkersScope(
	scope: NightworkersIntegrationScope,
): MiddlewareHandler<NightworkersHonoEnv> {
	return async (c, next) => {
		const client = c.get("integrationClient");
		if (!client.scopes.includes(scope)) {
			return integrationErrorResponse(
				c,
				c.get("integrationRequestId"),
				"integration_scope_denied",
				"Integration credential does not grant the required scope.",
				false,
				403,
			);
		}
		await next();
	};
}

export function requestIdFor(c: {
	req: { header(name: string): string | undefined };
	res?: { headers: Headers };
}): string {
	const supplied =
		c.req.header("x-request-id") ?? c.res?.headers.get("x-request-id");
	return supplied && /^[A-Za-z0-9._:-]{1,64}$/.test(supplied)
		? supplied
		: randomUUID();
}

export function integrationErrorResponse(
	c: { json(value: unknown, status: number): Response },
	requestId: string,
	code: IntegrationErrorCode,
	message: string,
	retryable: boolean,
	status: number,
	details?: Record<string, unknown>,
): Response {
	return c.json(
		{
			contractVersion: NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
			requestId,
			error: {
				code,
				message,
				retryable,
				...(details ? { details } : {}),
			},
		},
		status,
	);
}
