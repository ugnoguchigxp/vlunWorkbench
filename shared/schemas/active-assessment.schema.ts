import { z } from "zod";
import {
	objectPathTemplateSchema,
	relativeHttpPathSchema,
	relativePathMatchesPrefix,
} from "./http-target.schema";

export const activeHttpMethodSchema = z.enum([
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
]);

const SECRET_HEADER_NAMES = new Set([
	"authorization",
	"cookie",
	"proxy-authorization",
	"x-api-key",
	"x-auth-token",
	"x-csrf-token",
	"host",
	"content-length",
	"transfer-encoding",
	"connection",
	"upgrade",
	"te",
	"trailer",
]);
const headerRecordSchema = z
	.record(
		z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/),
		z.string().max(16_384),
	)
	.refine((headers) => Object.keys(headers).length <= 50, {
		message: "At most 50 request headers are allowed",
	})
	.refine(
		(headers) =>
			Object.keys(headers).every(
				(name) => !SECRET_HEADER_NAMES.has(name.toLowerCase()),
			),
		"Secret-bearing and transport-controlled headers are not allowed",
	);

export const activeRequestSchema = z
	.object({
		method: activeHttpMethodSchema,
		path: relativeHttpPathSchema,
		headers: headerRecordSchema.default({}),
		body: z
			.union([
				z.record(z.string(), z.unknown()),
				z.array(z.unknown()),
				z.string().max(64_000),
				z.null(),
			])
			.default(null),
		expectedStatus: z.array(z.number().int().min(100).max(599)).min(1).max(20),
	})
	.superRefine((value, ctx) => {
		let serialized: string;
		try {
			serialized =
				typeof value.body === "string"
					? value.body
					: JSON.stringify(value.body);
		} catch {
			ctx.addIssue({
				code: "custom",
				path: ["body"],
				message: "Request body must be JSON serializable",
			});
			return;
		}
		if (new TextEncoder().encode(serialized).byteLength > 64_000) {
			ctx.addIssue({
				code: "custom",
				path: ["body"],
				message: "Serialized request body must not exceed 64000 bytes",
			});
		}
	});

export const activeTransactionSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
		seed: z.array(activeRequestSchema).min(1).max(20),
		request: activeRequestSchema,
		cleanup: z.array(activeRequestSchema).min(1).max(20),
		maxRequests: z.number().int().min(3).max(100),
	})
	.superRefine((value, ctx) => {
		const required = value.seed.length + 1 + value.cleanup.length;
		if (value.maxRequests < required) {
			ctx.addIssue({
				code: "custom",
				path: ["maxRequests"],
				message: `maxRequests must be at least ${required} so cleanup can always run`,
			});
		}
	});

const matrixActorSchema = z.object({
	identityRole: z.string().min(1).max(100),
	authContextId: z.string().uuid(),
});
const matrixObjectSchema = z.object({
	id: z.string().min(1).max(100),
	ownerRole: z.string().min(1).max(100),
	path: relativeHttpPathSchema,
});
const matrixOperationSchema = z.object({
	id: z.string().min(1).max(100),
	method: z.enum(["GET", "HEAD", "OPTIONS"]),
	pathTemplate: objectPathTemplateSchema,
	allowedRoles: z.array(z.string().min(1).max(100)).max(20),
	ownerAllowed: z.boolean(),
});

export const authorizationMatrixSchema = z
	.object({
		actors: z.array(matrixActorSchema).min(2).max(20),
		objects: z.array(matrixObjectSchema).min(2).max(100),
		operations: z.array(matrixOperationSchema).min(1).max(50),
	})
	.superRefine((value, ctx) => {
		const roles = new Set(value.actors.map((actor) => actor.identityRole));
		if (roles.size !== value.actors.length) {
			ctx.addIssue({
				code: "custom",
				path: ["actors"],
				message: "Actor roles must be unique",
			});
		}
		if (
			new Set(value.objects.map((object) => object.id)).size !==
			value.objects.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["objects"],
				message: "Object IDs must be unique",
			});
		}
		if (
			new Set(value.operations.map((operation) => operation.id)).size !==
			value.operations.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["operations"],
				message: "Operation IDs must be unique",
			});
		}
		for (const [index, object] of value.objects.entries()) {
			if (!roles.has(object.ownerRole)) {
				ctx.addIssue({
					code: "custom",
					path: ["objects", index, "ownerRole"],
					message: "Object owner role must reference an actor",
				});
			}
		}
		for (const [operationIndex, operation] of value.operations.entries()) {
			const allowedRoles = new Set(operation.allowedRoles);
			if (allowedRoles.size !== operation.allowedRoles.length) {
				ctx.addIssue({
					code: "custom",
					path: ["operations", operationIndex, "allowedRoles"],
					message: "Allowed roles must be unique",
				});
			}
			for (const [roleIndex, role] of operation.allowedRoles.entries()) {
				if (!roles.has(role)) {
					ctx.addIssue({
						code: "custom",
						path: ["operations", operationIndex, "allowedRoles", roleIndex],
						message: "Allowed roles must reference configured actors",
					});
				}
			}
			for (const [objectIndex, object] of value.objects.entries()) {
				const resolvedPath = operation.pathTemplate.replace(
					"{objectId}",
					encodeURIComponent(object.id),
				);
				if (!relativePathMatchesPrefix(resolvedPath, object.path)) {
					ctx.addIssue({
						code: "custom",
						path: ["operations", operationIndex, "pathTemplate"],
						message: `Resolved path for object ${objectIndex} must remain under its declared object path`,
					});
				}
			}
		}
	});

const activeRunBaseSchema = z.object({
	engagementId: z.string().uuid(),
	targetConfigId: z.string().uuid(),
});

const activeTransactionRunRequestSchema = activeRunBaseSchema
	.extend({
		kind: z.literal("transaction"),
		transaction: activeTransactionSchema,
		authContextId: z.string().uuid().optional(),
		identityRole: z.string().min(1).max(100).optional(),
	})
	.superRefine((value, ctx) => {
		if (
			(value.authContextId && !value.identityRole) ||
			(!value.authContextId && value.identityRole)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["authContextId"],
				message: "authContextId and identityRole must be provided together",
			});
		}
	});

const authorizationMatrixRunRequestSchema = activeRunBaseSchema
	.extend({
		kind: z.literal("authorization_matrix"),
		matrix: authorizationMatrixSchema,
		maxRequests: z.number().int().min(1).max(100),
	})
	.superRefine((value, ctx) => {
		const required =
			value.matrix.actors.length *
			value.matrix.objects.length *
			value.matrix.operations.length;
		if (value.maxRequests < required) {
			ctx.addIssue({
				code: "custom",
				path: ["maxRequests"],
				message: `maxRequests must cover the complete matrix (${required} requests)`,
			});
		}
	});

export const runActiveAssessmentRequestSchema = z.union([
	activeTransactionRunRequestSchema,
	authorizationMatrixRunRequestSchema,
]);

export const activeAssessmentRunStatusSchema = z.enum([
	"running",
	"completed",
	"inconclusive",
	"failed_cleanup",
	"failed",
]);

export const activeAssessmentRunSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid(),
	engagementId: z.string().uuid(),
	targetConfigId: z.string().uuid(),
	kind: z.enum(["transaction", "authorization_matrix"]),
	status: activeAssessmentRunStatusSchema,
	requestCount: z.number().int().min(0),
	findingCount: z.number().int().min(0),
	summary: z.string().nullable(),
	result: z.record(z.string(), z.unknown()),
	errorMessage: z.string().nullable(),
	createdByUserId: z.string().uuid().nullable(),
	startedAt: z.union([z.string(), z.date()]),
	completedAt: z.union([z.string(), z.date()]).nullable(),
	createdAt: z.union([z.string(), z.date()]),
	updatedAt: z.union([z.string(), z.date()]),
});

export type ActiveRequest = z.infer<typeof activeRequestSchema>;
export type ActiveTransaction = z.infer<typeof activeTransactionSchema>;
export type AuthorizationMatrix = z.infer<typeof authorizationMatrixSchema>;
export type RunActiveAssessmentRequest = z.infer<
	typeof runActiveAssessmentRequestSchema
>;
