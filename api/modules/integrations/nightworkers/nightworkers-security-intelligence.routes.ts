import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
	NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
	type NightworkersSecurityIntelligenceErrorCode,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import {
	createProviderWorkspaceTargetGrantRequestSchema,
	nightworkersSecurityIntelligenceBindingProofEnvelopeSchema,
	nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema,
	providerWorkspaceTargetGrantEnvelopeSchema,
	providerWorkspaceTargetPreviewEnvelopeSchema,
	providerWorkspaceTargetPreviewRequestSchema,
	providerWorkspaceTargetStartEnvelopeSchema,
	providerWorkspaceTargetStartRequestSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
import { securityIntelligenceSafeTextSchema } from "../../../../shared/schemas/security-intelligence-assessment-components.schema";
import type { IntegrationClientService } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import type { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";
import { sha256 } from "./nightworkers-integration-support";
import {
	createNightworkersAuthenticationMiddleware,
	type NightworkersHonoEnv,
	requestIdFor,
	requireNightworkersScope,
} from "./nightworkers-integration-auth.middleware";
import { NightworkersSecurityIntelligenceError } from "./nightworkers-security-intelligence.errors";
import type { NightworkersSecurityIntelligenceService } from "./nightworkers-security-intelligence.service";
import type { NightworkersWorkspaceTargetGrantService } from "./nightworkers-workspace-target-grant.service";

const resourceRefSchema = z.string().uuid();
const workspaceGrantRefSchema = z.string().regex(/^siwg:v1:[a-f0-9]{64}$/);
const idempotencyKeySchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);

export function createNightworkersSecurityIntelligenceRoutes(deps: {
	integrationClientService: IntegrationClientService;
	auditRepository: Pick<NightworkersIntegrationRepository, "recordAudit">;
	service: Pick<
		NightworkersSecurityIntelligenceService,
		"assessment" | "bindingProof" | "capabilities"
	>;
	workspaceGrantService?: Pick<
		NightworkersWorkspaceTargetGrantService,
		"createGrant" | "preview" | "start"
	>;
	maxRequestBytes?: number;
}) {
	const app = new Hono<NightworkersHonoEnv>();
	app.use("*", async (c, next) => {
		c.header("Cache-Control", "private, no-store");
		c.header("Pragma", "no-cache");
		await next();
		const vary = c.res.headers.get("Vary");
		const fields = new Set(
			(vary ?? "")
				.split(",")
				.map((field) => field.trim())
				.filter(Boolean),
		);
		if (![...fields].some((field) => field.toLowerCase() === "authorization")) {
			fields.add("Authorization");
		}
		c.header("Vary", [...fields].join(", "));
	});
	app.use(
		"*",
		createNightworkersAuthenticationMiddleware(deps.integrationClientService),
	);
	app.use(
		"*",
		bodyLimit({
			maxSize: deps.maxRequestBytes ?? 16 * 1024,
			onError: (c) =>
				c.json(
					{
						contractVersion:
							NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
						requestId: requestIdFor(c),
						error: {
							code: "invalid_request",
							message: "Integration request body exceeds the size limit.",
							retryable: false,
						},
					},
					413,
				),
		}),
	);
	app.get(
		"/capabilities",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "security_intelligence_capabilities_read",
			});
			const response = c.json(
				nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema.parse({
					contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
					requestId: requestIdFor(c),
					data: deps.service.capabilities(),
				}),
			);
			await recordAudit(deps.auditRepository, c, "accepted");
			return response;
		},
	);
	app.post(
		"/workspace-target-grants",
		requireNightworkersScope("nightworkers:security-scan:write"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_grant_create",
			});
			const service = requireWorkspaceGrantService(deps.workspaceGrantService);
			const input = await parseJson(
				c,
				createProviderWorkspaceTargetGrantRequestSchema,
			);
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_grant_create",
				resourceRef: input.providerProjectRef,
			});
			const data = await service.createGrant(c.get("integrationClient"), input);
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_grant_create",
				resourceRef: data.grantRef,
			});
			const envelope = providerWorkspaceTargetGrantEnvelopeSchema.parse({
				contractVersion: 1,
				requestId: requestIdFor(c),
				data,
			});
			await recordAudit(deps.auditRepository, c, "accepted");
			return c.json(envelope, 201);
		},
	);
	app.post(
		"/workspace-target-grants/:grantRef/preview",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "workspace_target_grant_preview",
			});
			const service = requireWorkspaceGrantService(deps.workspaceGrantService);
			const grantRef = parseGrantRef(c.req.param("grantRef"));
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "workspace_target_grant_preview",
				resourceRef: grantRef,
			});
			const input = await parseJson(
				c,
				providerWorkspaceTargetPreviewRequestSchema,
			);
			const data = await service.preview(
				c.get("integrationClient"),
				grantRef,
				input,
			);
			const envelope = providerWorkspaceTargetPreviewEnvelopeSchema.parse({
				contractVersion: 1,
				requestId: requestIdFor(c),
				data,
			});
			await recordAudit(deps.auditRepository, c, "accepted");
			return c.json(envelope);
		},
	);
	app.post(
		"/workspace-target-grants/:grantRef/scans",
		requireNightworkersScope("nightworkers:security-scan:write"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_scan_start",
			});
			const service = requireWorkspaceGrantService(deps.workspaceGrantService);
			const grantRef = parseGrantRef(c.req.param("grantRef"));
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_scan_start",
				resourceRef: grantRef,
			});
			const input = await parseJson(
				c,
				providerWorkspaceTargetStartRequestSchema,
			);
			const idempotencyKey = idempotencyKeySchema.safeParse(
				c.req.header("idempotency-key"),
			);
			if (!idempotencyKey.success) {
				throw new NightworkersIntegrationError(
					"invalid_request",
					"A valid Idempotency-Key header is required.",
				);
			}
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "workspace_target_scan_start",
				resourceRef: grantRef,
				idempotencyKeyHash: sha256(idempotencyKey.data),
			});
			const data = await service.start(
				c.get("integrationClient"),
				grantRef,
				input,
				idempotencyKey.data,
			);
			const envelope = providerWorkspaceTargetStartEnvelopeSchema.parse({
				contractVersion: 1,
				requestId: requestIdFor(c),
				data,
			});
			await recordAudit(
				deps.auditRepository,
				c,
				data.replayed ? "replayed" : "accepted",
			);
			return c.json(envelope, data.replayed ? 200 : 202);
		},
	);
	app.get(
		"/scans/:scanRunRef/binding-proof",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "security_intelligence_binding_proof_read",
			});
			const parsed = resourceRefSchema.safeParse(c.req.param("scanRunRef"));
			if (!parsed.success) {
				throw new NightworkersIntegrationError(
					"invalid_request",
					"Integration request is invalid.",
				);
			}
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "security_intelligence_binding_proof_read",
				resourceRef: parsed.data,
			});
			const data = await deps.service.bindingProof(
				c.get("integrationClient"),
				parsed.data,
			);
			const envelope =
				nightworkersSecurityIntelligenceBindingProofEnvelopeSchema.parse({
					contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
					requestId: requestIdFor(c),
					data,
				});
			await recordAudit(deps.auditRepository, c, "accepted");
			return c.json(envelope);
		},
	);
	app.get(
		"/scans/:scanRunRef/assessment",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "security_intelligence_assessment_read",
			});
			const parsed = resourceRefSchema.safeParse(c.req.param("scanRunRef"));
			if (!parsed.success) {
				throw new NightworkersIntegrationError(
					"invalid_request",
					"Integration request is invalid.",
				);
			}
			setAuditContext(c, {
				scope: "nightworkers:security-scan:read",
				operation: "security_intelligence_assessment_read",
				resourceRef: parsed.data,
			});
			const data = await deps.service.assessment(
				c.get("integrationClient"),
				parsed.data,
			);
			const envelope =
				nightworkersSecurityIntelligenceSuccessEnvelopeSchema.parse({
					contractVersion: NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
					requestId: requestIdFor(c),
					data,
				});
			await recordAudit(deps.auditRepository, c, "accepted");
			return c.json(envelope);
		},
	);

	app.onError(async (error, c) => {
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
		await recordAudit(deps.auditRepository, c, "rejected", safe.code);
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

function setAuditContext(
	c: Context<NightworkersHonoEnv>,
	value: NonNullable<
		NightworkersHonoEnv["Variables"]["integrationAuditContext"]
	>,
): void {
	c.set("integrationAuditContext", value);
}

async function recordAudit(
	repository: Pick<NightworkersIntegrationRepository, "recordAudit">,
	c: Context<NightworkersHonoEnv>,
	outcome: "accepted" | "replayed" | "rejected",
	errorCode?: string,
): Promise<void> {
	const audit = c.get("integrationAuditContext");
	const client = c.get("integrationClient");
	if (!audit || !client) return;
	try {
		await repository.recordAudit({
			integrationClientId: client.id,
			ownerUserId: client.ownerUserId,
			scope: audit.scope,
			operation: audit.operation,
			requestId: c.get("integrationRequestId"),
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
				event: "nightworkers.security_intelligence.audit_write_failed",
				requestId: c.get("integrationRequestId"),
				errorName: error instanceof Error ? error.name : "UnknownError",
			}),
		);
	}
}

function requireWorkspaceGrantService(
	service:
		| Pick<
				NightworkersWorkspaceTargetGrantService,
				"createGrant" | "preview" | "start"
		  >
		| undefined,
) {
	if (!service) {
		throw new NightworkersIntegrationError(
			"provider_temporarily_unavailable",
			"Workspace target grants are unavailable.",
		);
	}
	return service;
}

function parseGrantRef(value: string): string {
	const parsed = workspaceGrantRefSchema.safeParse(value);
	if (!parsed.success) {
		throw new NightworkersIntegrationError(
			"invalid_request",
			"Workspace target grant reference is invalid.",
		);
	}
	return parsed.data;
}

async function parseJson<T extends z.ZodTypeAny>(
	c: { req: { json(): Promise<unknown> } },
	schema: T,
): Promise<z.infer<T>> {
	let value: unknown;
	try {
		value = await c.req.json();
	} catch {
		throw new NightworkersIntegrationError(
			"invalid_request",
			"Integration request JSON is invalid.",
		);
	}
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new NightworkersIntegrationError(
			"invalid_request",
			"Integration request is invalid.",
		);
	}
	return parsed.data;
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
