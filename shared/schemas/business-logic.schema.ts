import { z } from "zod";
import { relativeHttpPathSchema } from "./http-target.schema";

const scenarioHeaderSchema = z
	.record(z.string().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/), z.string())
	.refine(
		(headers) =>
			Object.keys(headers).every(
				(name) =>
					![
						"authorization",
						"cookie",
						"proxy-authorization",
						"x-api-key",
						"x-auth-token",
						"host",
					].includes(name.toLowerCase()),
			),
		"Secret-bearing headers are not allowed in scenario plans",
	);

export const scenarioRequestSchema = z.object({
	actorId: z.string().min(1).max(200),
	method: z.enum(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]),
	path: relativeHttpPathSchema,
	headers: scenarioHeaderSchema.default({}),
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

export const scenarioAssertionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("status_class"),
		requestIndex: z.number().int().min(0),
		expectedClass: z.number().int().min(1).max(5),
	}),
	z.object({
		kind: z.literal("json_primitive"),
		requestIndex: z.number().int().min(0),
		jsonPointer: z.string().startsWith("/").max(500),
		operator: z.enum(["eq", "neq"]),
		value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
	}),
	z.object({
		kind: z.literal("count_delta"),
		subject: z.string().min(1).max(200),
		min: z.number().int(),
		max: z.number().int(),
	}),
	z.object({
		kind: z.literal("state_transition"),
		subject: z.string().min(1).max(200),
		from: z.string().min(1).max(100),
		to: z.string().min(1).max(100),
	}),
	z.object({
		kind: z.literal("numeric_delta"),
		subject: z.string().min(1).max(200),
		min: z.number(),
		max: z.number(),
	}),
	z.object({
		kind: z.literal("duplicate_side_effect_count"),
		subject: z.string().min(1).max(200),
		max: z.number().int().min(0),
	}),
	z.object({
		kind: z.literal("fixture_hash"),
		expectedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	}),
]);

export const businessLogicScenarioSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,199}$/),
		hypothesisId: z.string().min(1).max(200),
		controlId: z.string().min(1).max(200),
		engagementId: z.string().uuid(),
		targetConfigId: z.string().uuid(),
		actors: z
			.array(
				z.object({
					actorId: z.string().min(1).max(200),
					authContextId: z.string().uuid(),
				}),
			)
			.max(20),
		preconditions: z.array(scenarioAssertionSchema).max(50),
		seed: z.array(scenarioRequestSchema).max(20),
		actions: z.array(scenarioRequestSchema).min(1).max(20),
		invariants: z.array(scenarioAssertionSchema).min(1).max(50),
		cleanup: z.array(scenarioRequestSchema).min(1).max(20),
		maxRequests: z.number().int().min(2).max(100),
		timeoutSec: z.number().int().min(1).max(1200),
		expectedBaselineHash: z
			.string()
			.regex(/^sha256:[a-f0-9]{64}$/)
			.nullable(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const required =
			value.seed.length + value.actions.length + value.cleanup.length;
		if (value.maxRequests < required) {
			ctx.addIssue({
				code: "custom",
				path: ["maxRequests"],
				message: `maxRequests must reserve all actions and cleanup (${required})`,
			});
		}
	});

export type ScenarioRequest = z.infer<typeof scenarioRequestSchema>;
export type ScenarioAssertion = z.infer<typeof scenarioAssertionSchema>;
export type BusinessLogicScenario = z.infer<typeof businessLogicScenarioSchema>;
