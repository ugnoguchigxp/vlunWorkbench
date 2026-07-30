import { z } from "zod";

export const activeHttpMethodSchema = z.enum([
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
]);

export const activeRequestSchema = z.object({
	method: activeHttpMethodSchema,
	path: z.string().startsWith("/").max(2000),
	headers: z
		.record(z.string(), z.string())
		.refine(
			(headers) =>
				Object.keys(headers).every(
					(name) =>
						!["authorization", "cookie", "proxy-authorization"].includes(
							name.toLowerCase(),
						),
				),
			"Secret-bearing headers must come from an encrypted auth context",
		)
		.default({}),
	body: z
		.union([
			z.record(z.string(), z.unknown()),
			z.array(z.unknown()),
			z.string().max(64_000),
			z.null(),
		])
		.default(null),
	expectedStatus: z.array(z.number().int().min(100).max(599)).min(1).max(20),
});

export const activeTransactionSchema = z.object({
	id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
	seed: z.array(activeRequestSchema).min(1).max(20),
	request: activeRequestSchema,
	cleanup: z.array(activeRequestSchema).min(1).max(20),
	maxRequests: z.number().int().min(3).max(100),
});

const matrixActorSchema = z.object({
	identityRole: z.string().min(1).max(100),
	authContextId: z.string().uuid(),
});
const matrixObjectSchema = z.object({
	id: z.string().min(1).max(100),
	ownerRole: z.string().min(1).max(100),
	path: z.string().startsWith("/").max(2000),
});
const matrixOperationSchema = z.object({
	id: z.string().min(1).max(100),
	method: z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]),
	pathTemplate: z.string().startsWith("/").includes("{objectId}").max(2000),
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
		for (const [index, object] of value.objects.entries()) {
			if (!roles.has(object.ownerRole)) {
				ctx.addIssue({
					code: "custom",
					path: ["objects", index, "ownerRole"],
					message: "Object owner role must reference an actor",
				});
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

const authorizationMatrixRunRequestSchema = activeRunBaseSchema.extend({
	kind: z.literal("authorization_matrix"),
	matrix: authorizationMatrixSchema,
	maxRequests: z.number().int().min(1).max(100),
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
