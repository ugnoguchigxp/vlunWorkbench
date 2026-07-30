import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
	integrationCapabilitiesRequestSchema,
	integrationPreviewRequestSchema,
	integrationSeveritySchema,
	integrationStartReportRequestSchema,
	integrationStartScanRequestSchema,
	NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { IntegrationClientService } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import type { NightworkersIntegrationRepository } from "./nightworkers-integration.repository";
import type { NightworkersIntegrationService } from "./nightworkers-integration.service";
import {
	createNightworkersAuthenticationMiddleware,
	integrationErrorResponse,
	type NightworkersHonoEnv,
	requestIdFor,
	requireNightworkersScope,
} from "./nightworkers-integration-auth.middleware";

const idempotencyKeySchema = z.string().uuid();
const resourceRefSchema = z.string().uuid();

export function createNightworkersIntegrationRoutes(deps: {
	integrationClientService: IntegrationClientService;
	auditRepository: Pick<NightworkersIntegrationRepository, "recordAudit">;
	service: NightworkersIntegrationService;
	maxRequestBytes: number;
}) {
	const app = new Hono<NightworkersHonoEnv>();
	app.use(
		"*",
		createNightworkersAuthenticationMiddleware(deps.integrationClientService),
	);
	app.use(
		"*",
		bodyLimit({
			maxSize: deps.maxRequestBytes,
			onError: (c) =>
				integrationErrorResponse(
					c,
					requestIdFor(c),
					"invalid_request",
					"Integration request body exceeds the configured size limit.",
					false,
					413,
					{ maxBytes: deps.maxRequestBytes },
				),
		}),
	);

	app.post(
		"/capabilities",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const input = await parseJson(c, integrationCapabilitiesRequestSchema);
			const data = await deps.service.capabilities(
				c.get("integrationClient"),
				input.projectPath,
			);
			return c.json(envelope(c, data));
		},
	);
	app.post(
		"/scans/preview",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const input = await parseJson(c, integrationPreviewRequestSchema);
			const data = await deps.service.preview(
				c.get("integrationClient"),
				input,
			);
			return c.json(envelope(c, data));
		},
	);
	app.post(
		"/scans",
		requireNightworkersScope("nightworkers:security-scan:write"),
		async (c) => {
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "scan_start",
				idempotencyKey: c.req.header("idempotency-key"),
			});
			const input = await parseJson(c, integrationStartScanRequestSchema);
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "scan_start",
				projectPath: input.projectPath,
				idempotencyKey: c.req.header("idempotency-key"),
			});
			const key = parseIdempotencyKey(c.req.header("idempotency-key"));
			const data = await deps.service.startScan({
				client: c.get("integrationClient"),
				request: input,
				idempotencyKey: key,
				requestId: requestIdFor(c),
			});
			return c.json(envelope(c, data), 202);
		},
	);
	app.get(
		"/scans/:scanRunRef",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			const data = await deps.service.scanDetail(
				c.get("integrationClient"),
				ref,
			);
			return c.json(envelope(c, data));
		},
	);
	app.get(
		"/scans/:scanRunRef/events",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			const query = z
				.object({
					afterSeq: z.coerce.number().int().nonnegative().default(0),
					limit: z.coerce.number().int().positive().default(100),
				})
				.safeParse({
					afterSeq: c.req.query("afterSeq"),
					limit: c.req.query("limit"),
				});
			if (!query.success) throw invalidRequestError();
			const data = await deps.service.events(
				c.get("integrationClient"),
				ref,
				query.data.afterSeq,
				query.data.limit,
			);
			return c.json(envelope(c, data));
		},
	);
	app.post(
		"/scans/:scanRunRef/cancel",
		requireNightworkersScope("nightworkers:security-scan:write"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			setAuditContext(c, {
				scope: "nightworkers:security-scan:write",
				operation: "scan_cancel",
				resourceRef: ref,
			});
			const data = await deps.service.cancel(
				c.get("integrationClient"),
				ref,
				requestIdFor(c),
			);
			return c.json(envelope(c, data));
		},
	);
	app.get(
		"/scans/:scanRunRef/findings",
		requireNightworkersScope("nightworkers:security-scan:read"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			const query = z
				.object({
					cursor: z.string().max(4_096).optional(),
					limit: z.coerce.number().int().positive().default(100),
					severity: integrationSeveritySchema.optional(),
					tool: z.string().trim().min(1).max(128).optional(),
				})
				.safeParse({
					cursor: c.req.query("cursor"),
					limit: c.req.query("limit"),
					severity: c.req.query("severity"),
					tool: c.req.query("tool"),
				});
			if (!query.success) throw invalidRequestError();
			const data = await deps.service.findings({
				client: c.get("integrationClient"),
				scanRunId: ref,
				...query.data,
			});
			return c.json(envelope(c, data));
		},
	);
	app.get(
		"/scans/:scanRunRef/reports",
		requireNightworkersScope("nightworkers:security-report:read"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			const data = await deps.service.listReports(
				c.get("integrationClient"),
				ref,
			);
			return c.json(envelope(c, data));
		},
	);
	app.post(
		"/scans/:scanRunRef/reports",
		requireNightworkersScope("nightworkers:security-report:write"),
		async (c) => {
			const ref = parseResourceRef(c.req.param("scanRunRef"));
			setAuditContext(c, {
				scope: "nightworkers:security-report:write",
				operation: "report_start",
				resourceRef: ref,
				idempotencyKey: c.req.header("idempotency-key"),
			});
			await parseJson(c, integrationStartReportRequestSchema);
			const key = parseIdempotencyKey(c.req.header("idempotency-key"));
			const data = await deps.service.startReport({
				client: c.get("integrationClient"),
				scanRunId: ref,
				idempotencyKey: key,
				requestId: requestIdFor(c),
			});
			return c.json(envelope(c, data), 202);
		},
	);
	app.get(
		"/scans/:scanRunRef/reports/:reportRef",
		requireNightworkersScope("nightworkers:security-report:read"),
		async (c) => {
			const scanRef = parseResourceRef(c.req.param("scanRunRef"));
			const reportRef = parseResourceRef(c.req.param("reportRef"));
			const data = await deps.service.reportDetail(
				c.get("integrationClient"),
				scanRef,
				reportRef,
			);
			return c.json(envelope(c, data));
		},
	);
	app.get(
		"/scans/:scanRunRef/reports/:reportRef/content",
		requireNightworkersScope("nightworkers:security-report:read"),
		async (c) => {
			const scanRef = parseResourceRef(c.req.param("scanRunRef"));
			const reportRef = parseResourceRef(c.req.param("reportRef"));
			const data = await deps.service.reportContent(
				c.get("integrationClient"),
				scanRef,
				reportRef,
			);
			const filename = `${sanitizeFilename(data.title)}-${reportRef.slice(0, 8)}.md`;
			return c.body(data.content, 200, {
				"Content-Type": "text/markdown; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
			});
		},
	);

	app.onError(async (error, c) => {
		const safe =
			error instanceof NightworkersIntegrationError
				? error
				: new NightworkersIntegrationError(
						"internal_error",
						"Integration request failed.",
					);
		if (!(error instanceof NightworkersIntegrationError)) {
			logIntegrationFailure(
				"nightworkers.integration.request_failed",
				c.get("integrationRequestId"),
				error,
			);
		}
		const audit = c.get("integrationAuditContext");
		const client = c.get("integrationClient");
		if (audit && client) {
			await deps.auditRepository
				.recordAudit({
					integrationClientId: client.id,
					ownerUserId: client.ownerUserId,
					scope: audit.scope,
					operation: audit.operation,
					requestId: c.get("integrationRequestId"),
					pathHash: audit.pathHash ?? null,
					idempotencyKeyHash: audit.idempotencyKeyHash ?? null,
					resourceRef: audit.resourceRef ?? null,
					outcome: "rejected",
					errorCode: safe.code,
				})
				.catch((auditError) => {
					logIntegrationFailure(
						"nightworkers.integration.audit_write_failed",
						c.get("integrationRequestId"),
						auditError,
					);
				});
		}
		return integrationErrorResponse(
			c,
			requestIdFor(c),
			safe.code,
			safe.message,
			safe.retryable,
			safe.status,
			safe.details,
		);
	});
	return app;
}

async function parseJson<T>(
	c: { req: { json(): Promise<unknown> } },
	schema: z.ZodType<T>,
): Promise<T> {
	const body = await c.req.json().catch(() => null);
	const parsed = schema.safeParse(body);
	if (!parsed.success) throw invalidRequestError();
	return parsed.data;
}

function parseIdempotencyKey(value: string | undefined): string {
	const parsed = idempotencyKeySchema.safeParse(value);
	if (!parsed.success) throw invalidRequestError();
	return parsed.data;
}

function parseResourceRef(value: string): string {
	const parsed = resourceRefSchema.safeParse(value);
	if (!parsed.success) throw invalidRequestError();
	return parsed.data;
}

function invalidRequestError() {
	return new NightworkersIntegrationError(
		"invalid_request",
		"Integration request is invalid.",
	);
}

function envelope(c: Parameters<typeof requestIdFor>[0], data: unknown) {
	return {
		contractVersion: NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION,
		requestId: requestIdFor(c),
		data,
	};
}

function sanitizeFilename(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "security-report"
	);
}

function setAuditContext(
	c: {
		set(
			key: "integrationAuditContext",
			value: NightworkersHonoEnv["Variables"]["integrationAuditContext"],
		): void;
	},
	params: {
		scope: string;
		operation: string;
		projectPath?: string;
		idempotencyKey?: string;
		resourceRef?: string;
	},
): void {
	c.set("integrationAuditContext", {
		scope: params.scope,
		operation: params.operation,
		...(params.projectPath ? { pathHash: sha256(params.projectPath) } : {}),
		...(params.idempotencyKey
			? { idempotencyKeyHash: sha256(params.idempotencyKey) }
			: {}),
		...(params.resourceRef ? { resourceRef: params.resourceRef } : {}),
	});
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function logIntegrationFailure(
	event: string,
	requestId: string,
	error: unknown,
): void {
	console.error(
		JSON.stringify({
			version: 1,
			level: "error",
			event,
			requestId,
			errorName: error instanceof Error ? error.name : "UnknownError",
		}),
	);
}
