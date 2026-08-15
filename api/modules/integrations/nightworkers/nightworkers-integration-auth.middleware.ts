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
import type { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";

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

type RateWindow = {
	startedAt: number;
	count: number;
	windowMs: number;
	rejectionAudited: boolean;
};

const ANONYMOUS_AUDIT_WINDOW_MS = 60_000;
const ANONYMOUS_AUDIT_LIMIT = 60;

export class NightworkersRequestGuard {
	private readonly rateWindows = new Map<string, RateWindow>();
	private anonymousAuditWindow = { startedAt: 0, count: 0 };

	shouldAuditAnonymousRejection(now = Date.now()): boolean {
		if (
			now - this.anonymousAuditWindow.startedAt >=
			ANONYMOUS_AUDIT_WINDOW_MS
		) {
			this.anonymousAuditWindow = { startedAt: now, count: 0 };
		}
		if (this.anonymousAuditWindow.count >= ANONYMOUS_AUDIT_LIMIT) {
			return false;
		}
		this.anonymousAuditWindow.count += 1;
		return true;
	}

	consumeRateLimit(
		client: Pick<AuthenticatedIntegrationClient, "id" | "rateLimitPolicy">,
		now = Date.now(),
	):
		| { allowed: true }
		| {
				allowed: false;
				retryAfterSeconds: number;
				shouldAudit: boolean;
		  } {
		if (this.rateWindows.size >= 1_024) {
			for (const [clientId, candidate] of this.rateWindows) {
				if (now - candidate.startedAt >= candidate.windowMs) {
					this.rateWindows.delete(clientId);
				}
			}
		}
		const current = this.rateWindows.get(client.id);
		const window =
			!current ||
			current.windowMs !== client.rateLimitPolicy.windowMs ||
			now - current.startedAt >= current.windowMs
				? {
						startedAt: now,
						count: 0,
						windowMs: client.rateLimitPolicy.windowMs,
						rejectionAudited: false,
					}
				: current;
		window.count += 1;
		this.rateWindows.set(client.id, window);
		if (window.count <= client.rateLimitPolicy.limit) {
			return { allowed: true };
		}
		const shouldAudit = !window.rejectionAudited;
		window.rejectionAudited = true;
		return {
			allowed: false,
			retryAfterSeconds: Math.max(
				1,
				Math.ceil((window.windowMs - (now - window.startedAt)) / 1_000),
			),
			shouldAudit,
		};
	}
}

export function createNightworkersAuthenticationMiddleware(
	service: IntegrationClientService,
	auditRepository?: Pick<NightworkersIntegrationRepository, "recordAudit">,
	requestGuard = new NightworkersRequestGuard(),
): MiddlewareHandler<NightworkersHonoEnv> {
	return async (c, next) => {
		const requestId = requestIdFor(c);
		c.set("integrationRequestId", requestId);
		c.set("integrationAuditContext", {
			scope: "nightworkers:integration",
			operation: "integration_authentication",
		});
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
			if (requestGuard.shouldAuditAnonymousRejection()) {
				await recordNightworkersAudit(
					auditRepository,
					c,
					"rejected",
					"integration_unauthorized",
				);
			}
			return integrationErrorResponse(
				c,
				requestId,
				"integration_unauthorized",
				"Valid integration bearer authentication is required.",
				false,
				401,
			);
		}
		c.set("integrationClient", client);

		const rateLimit = requestGuard.consumeRateLimit(client);
		if (!rateLimit.allowed) {
			c.set("integrationAuditContext", {
				scope: "nightworkers:integration",
				operation: "integration_rate_limit",
			});
			if (rateLimit.shouldAudit) {
				await recordNightworkersAudit(
					auditRepository,
					c,
					"rejected",
					"rate_limit_exceeded",
				);
			}
			c.header("Retry-After", String(rateLimit.retryAfterSeconds));
			return integrationErrorResponse(
				c,
				requestId,
				"rate_limit_exceeded",
				"Integration client rate limit exceeded.",
				true,
				429,
				{ retryAfterSeconds: rateLimit.retryAfterSeconds },
			);
		}
		await service.markUsed(client.id);
		await next();
	};
}

export function requireNightworkersScope(
	scope: NightworkersIntegrationScope,
	auditRepository?: Pick<NightworkersIntegrationRepository, "recordAudit">,
	operation = "integration_request",
): MiddlewareHandler<NightworkersHonoEnv> {
	return async (c, next) => {
		c.set("integrationAuditContext", { scope, operation });
		const client = c.get("integrationClient");
		if (!client.scopes.includes(scope)) {
			await recordNightworkersAudit(
				auditRepository,
				c,
				"rejected",
				"integration_scope_denied",
			);
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

export async function recordNightworkersAudit(
	repository:
		| Pick<NightworkersIntegrationRepository, "recordAudit">
		| undefined,
	c: Parameters<typeof requestIdFor>[0] & {
		get(
			key: "integrationAuditContext",
		): NightworkersHonoEnv["Variables"]["integrationAuditContext"];
		get(key: "integrationClient"): AuthenticatedIntegrationClient | undefined;
		get(key: "integrationRequestId"): string | undefined;
	},
	outcome: "accepted" | "replayed" | "rejected",
	errorCode?: string,
): Promise<void> {
	if (!repository) return;
	const audit = c.get("integrationAuditContext");
	if (!audit) return;
	const client = c.get("integrationClient");
	try {
		await repository.recordAudit({
			integrationClientId: client?.id ?? null,
			ownerUserId: client?.ownerUserId ?? null,
			scope: audit.scope,
			operation: audit.operation,
			requestId: c.get("integrationRequestId") ?? requestIdFor(c),
			pathHash: audit.pathHash ?? null,
			idempotencyKeyHash: audit.idempotencyKeyHash ?? null,
			resourceRef: audit.resourceRef ?? null,
			outcome,
			errorCode: errorCode ?? null,
		});
	} catch (error) {
		console.error(
			JSON.stringify({
				version: 1,
				level: "error",
				event: "nightworkers.integration.audit_write_failed",
				requestId: c.get("integrationRequestId") ?? requestIdFor(c),
				errorName: error instanceof Error ? error.name : "UnknownError",
			}),
		);
	}
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
