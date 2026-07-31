import { z } from "zod";
import { httpOriginSchema, relativeHttpPathSchema } from "./http-target.schema";

export const dastAuthKindSchema = z.enum([
	"bearer_token",
	"named_header",
	"basic_auth",
	"cookie_set",
	"playwright_storage_state",
]);

const bearerPayloadSchema = z.object({
	kind: z.literal("bearer_token"),
	token: z.string().min(1).max(16_384),
});
const headerPayloadSchema = z.object({
	kind: z.literal("named_header"),
	name: z
		.string()
		.regex(/^[A-Za-z0-9-]+$/)
		.refine(
			(value) =>
				![
					"host",
					"content-length",
					"cookie",
					"transfer-encoding",
					"connection",
					"upgrade",
					"te",
					"trailer",
				].includes(value.toLowerCase()),
		),
	value: z.string().min(1).max(16_384),
});
const basicPayloadSchema = z.object({
	kind: z.literal("basic_auth"),
	username: z.string().min(1).max(500),
	password: z.string().min(1).max(16_384),
});
const cookiePayloadSchema = z.object({
	kind: z.literal("cookie_set"),
	cookies: z
		.array(
			z.object({
				name: z.string().min(1).max(500),
				value: z.string().min(1).max(16_384),
				domain: z.string().max(500).optional(),
				path: relativeHttpPathSchema.optional(),
				secure: z.boolean().optional(),
				httpOnly: z.boolean().optional(),
				sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
			}),
		)
		.min(1)
		.max(100),
});
const storageStatePayloadSchema = z.object({
	kind: z.literal("playwright_storage_state"),
	storageState: z.object({
		cookies: z
			.array(
				z.object({
					name: z.string().min(1).max(500),
					value: z.string().max(16_384),
					domain: z.string().min(1).max(500),
					path: relativeHttpPathSchema,
					expires: z.number(),
					httpOnly: z.boolean(),
					secure: z.boolean(),
					sameSite: z.enum(["Strict", "Lax", "None"]),
				}),
			)
			.max(1000)
			.default([]),
		origins: z
			.array(
				z.object({
					origin: httpOriginSchema,
					localStorage: z
						.array(
							z.object({
								name: z.string().min(1).max(500),
								value: z.string().max(16_384),
							}),
						)
						.max(1000),
				}),
			)
			.max(100)
			.default([]),
	}),
});

export const dastAuthSecretPayloadSchema = z.discriminatedUnion("kind", [
	bearerPayloadSchema,
	headerPayloadSchema,
	basicPayloadSchema,
	cookiePayloadSchema,
	storageStatePayloadSchema,
]);

const selectorSchema = z.string().min(1).max(500);
export const dastLoginActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("navigate"),
		path: relativeHttpPathSchema,
	}),
	z.object({
		action: z.literal("fill_secret"),
		selector: selectorSchema,
		secretField: z.enum(["token", "username", "password"]),
	}),
	z.object({ action: z.literal("click"), selector: selectorSchema }),
	z.object({
		action: z.literal("wait_for_url"),
		pathPattern: relativeHttpPathSchema,
	}),
	z.object({
		action: z.literal("wait_for_selector"),
		selector: selectorSchema,
	}),
]);

export const dastAuthSuccessAssertionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("url"),
		pathPattern: relativeHttpPathSchema,
	}),
	z.object({
		kind: z.literal("selector"),
		selector: selectorSchema,
	}),
	z.object({
		kind: z.literal("status"),
		path: relativeHttpPathSchema,
		expected: z.array(z.number().int().min(200).max(399)).min(1).max(20),
	}),
]);

export const createDastAuthContextSchema = z
	.object({
		targetConfigId: z.string().uuid(),
		identityRole: z.string().min(1).max(100),
		label: z.string().min(1).max(200),
		secret: dastAuthSecretPayloadSchema,
		loginFlow: z.array(dastLoginActionSchema).max(20).default([]),
		successAssertions: z
			.array(dastAuthSuccessAssertionSchema)
			.max(10)
			.default([]),
		expiresAt: z.string().datetime(),
	})
	.superRefine((value, ctx) => {
		if (
			value.secret.kind !== "playwright_storage_state" &&
			value.loginFlow.length > 0
		) {
			const allowedFields =
				value.secret.kind === "basic_auth"
					? new Set(["username", "password"])
					: new Set(["token"]);
			for (const [index, action] of value.loginFlow.entries()) {
				if (
					action.action === "fill_secret" &&
					!allowedFields.has(action.secretField)
				) {
					ctx.addIssue({
						code: "custom",
						path: ["loginFlow", index, "secretField"],
						message:
							"Login flow references a secret field unavailable for this auth kind",
					});
				}
			}
		}
	});

export const rotateDastAuthContextSchema = z.object({
	secret: dastAuthSecretPayloadSchema,
	expiresAt: z.string().datetime(),
});

export type DastAuthSecretPayload = z.infer<typeof dastAuthSecretPayloadSchema>;
export type DastLoginAction = z.infer<typeof dastLoginActionSchema>;
export type DastAuthSuccessAssertion = z.infer<
	typeof dastAuthSuccessAssertionSchema
>;
export type CreateDastAuthContextInput = z.infer<
	typeof createDastAuthContextSchema
>;
