import { z } from "zod";
import { relativeHttpPathSchema } from "./http-target.schema";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const modelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,199}$/);

export const modelEvidenceRefSchema = z
	.object({
		kind: z.enum([
			"source",
			"openapi_operation",
			"database_table",
			"runtime_route",
			"scan_evidence",
		]),
		ref: z.string().min(1).max(1000),
		path: z.string().min(1).max(1000).optional(),
		line: z.number().int().positive().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.kind === "source" && (!value.path || !value.line)) {
			ctx.addIssue({
				code: "custom",
				message: "Source evidence requires path and line",
			});
		}
	});

const evidenceBoundNode = {
	id: modelIdSchema,
	evidenceRefs: z.array(modelEvidenceRefSchema).min(1).max(100),
};

const actorSchema = z.object({
	...evidenceBoundNode,
	name: z.string().min(1).max(200),
	kind: z.enum(["anonymous", "user", "service", "administrator", "external"]),
});

const assetSchema = z.object({
	...evidenceBoundNode,
	name: z.string().min(1).max(200),
	classification: z.enum(["public", "internal", "confidential", "restricted"]),
});

const entrypointSchema = z.object({
	...evidenceBoundNode,
	method: z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]),
	path: relativeHttpPathSchema,
	framework: z.string().min(1).max(100),
	authGuardIds: z.array(modelIdSchema).max(50),
});

const trustBoundarySchema = z.object({
	...evidenceBoundNode,
	name: z.string().min(1).max(200),
	sourceZone: z.string().min(1).max(100),
	targetZone: z.string().min(1).max(100),
});

const dataStoreSchema = z.object({
	...evidenceBoundNode,
	name: z.string().min(1).max(200),
	kind: z.enum(["database", "filesystem", "cache", "queue", "external"]),
});

const dataFlowSchema = z.object({
	...evidenceBoundNode,
	fromId: modelIdSchema,
	toId: modelIdSchema,
	dataClasses: z.array(z.string().min(1).max(100)).max(50),
});

const authorizationGuardSchema = z.object({
	...evidenceBoundNode,
	kind: z.enum(["authentication", "role", "ownership", "policy", "unknown"]),
	name: z.string().min(1).max(200),
});

const stateMachineSchema = z.object({
	...evidenceBoundNode,
	name: z.string().min(1).max(200),
	states: z.array(z.string().min(1).max(100)).min(1).max(100),
	transitions: z
		.array(
			z.object({
				from: z.string().min(1).max(100),
				to: z.string().min(1).max(100),
				entrypointId: modelIdSchema,
			}),
		)
		.max(200),
});

const assumptionSchema = z.object({
	...evidenceBoundNode,
	statement: z.string().min(1).max(2000),
	status: z.enum(["supported", "conflict", "unresolved"]),
});

export const applicationModelSchema = z
	.object({
		version: z.literal(1),
		projectId: z.string().uuid(),
		sourceFingerprint: sha256Schema,
		actors: z.array(actorSchema).max(200),
		assets: z.array(assetSchema).max(500),
		entrypoints: z.array(entrypointSchema).max(5000),
		trustBoundaries: z.array(trustBoundarySchema).max(500),
		dataStores: z.array(dataStoreSchema).max(500),
		dataFlows: z.array(dataFlowSchema).max(5000),
		authorizationGuards: z.array(authorizationGuardSchema).max(1000),
		stateMachines: z.array(stateMachineSchema).max(500),
		assumptions: z.array(assumptionSchema).max(1000),
		evidenceRefs: z.array(modelEvidenceRefSchema).min(1).max(10_000),
		unresolvedSuggestions: z
			.array(
				z.object({
					kind: z.string().min(1).max(100),
					value: z.string().min(1).max(2000),
					reasonCode: z.string().min(1).max(100),
				}),
			)
			.max(1000),
		snapshotHash: sha256Schema,
	})
	.strict();

export type ModelEvidenceRef = z.infer<typeof modelEvidenceRefSchema>;
export type ApplicationModel = z.infer<typeof applicationModelSchema>;
