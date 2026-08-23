import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const runtimeDependencyAdapterIdSchema = z.enum([
	"npm-package-lock-v1",
	"bun-lock-v1",
]);

export const runtimeDatabaseModeSchema = z.enum([
	"none",
	"sqlite_ephemeral",
	"postgres_ephemeral",
	"mysql_ephemeral",
]);

export const runtimeDatabaseBindingKeySchema = z.enum([
	"DATABASE_URL",
	"DB_URL",
	"POSTGRES_URL",
	"MYSQL_URL",
	"DB_HOST",
	"DB_PORT",
	"DB_NAME",
	"DB_USER",
	"DB_PASSWORD",
	"SQLITE_PATH",
]);

export const runtimeDatabaseBindingValueKindSchema = z.enum([
	"url",
	"host",
	"port",
	"database",
	"username",
	"password",
	"file_path",
	"file_url",
]);

export const runtimeDatabaseEnvironmentBindingSchema = z
	.object({
		key: runtimeDatabaseBindingKeySchema,
		valueKind: runtimeDatabaseBindingValueKindSchema,
	})
	.strict();

export const runtimeTargetRecipeV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		startPlannerId: z.literal("build.npm"),
		dependencyAdapterId: runtimeDependencyAdapterIdSchema,
		database: z
			.object({
				mode: runtimeDatabaseModeSchema,
				environmentBindings: z
					.array(runtimeDatabaseEnvironmentBindingSchema)
					.max(13),
			})
			.strict(),
		readinessPaths: z
			.array(z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/))
			.min(1)
			.max(5)
			.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		const bindings = value.database.environmentBindings;
		const duplicate = bindings.find(
			(binding, index) =>
				bindings.findIndex((candidate) => candidate.key === binding.key) !==
				index,
		);
		if (duplicate) {
			context.addIssue({
				code: "custom",
				path: ["database", "environmentBindings"],
				message: `Duplicate database environment binding: ${duplicate.key}`,
			});
		}
		if (value.database.mode === "none" && bindings.length > 0) {
			context.addIssue({
				code: "custom",
				path: ["database", "environmentBindings"],
				message: "database.mode=none must not declare environment bindings",
			});
		}
		const sqliteOnly = new Set(["file_path", "file_url"]);
		if (
			value.database.mode === "sqlite_ephemeral" &&
			bindings.some((binding) => !sqliteOnly.has(binding.valueKind))
		) {
			context.addIssue({
				code: "custom",
				path: ["database", "environmentBindings"],
				message: "SQLite bindings must use file_path or file_url",
			});
		}
		if (
			["postgres_ephemeral", "mysql_ephemeral"].includes(value.database.mode) &&
			bindings.some((binding) =>
				["file_path", "file_url"].includes(binding.valueKind),
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["database", "environmentBindings"],
				message: "Service database bindings must not use file values",
			});
		}
	});

export const runtimeIsolationImageDigestsSchema = z
	.object({
		namespaceOwnerImageDigest: sha256DigestSchema,
		nodeRuntimeImageDigest: sha256DigestSchema,
		materializerImageDigest: sha256DigestSchema,
		registryProxyImageDigest: sha256DigestSchema,
		probeImageDigest: sha256DigestSchema,
		httpExecutorImageDigest: sha256DigestSchema,
		databaseImageDigest: sha256DigestSchema.nullable(),
		scannerImageDigests: z.record(
			z.string().min(1).max(100),
			sha256DigestSchema,
		),
	})
	.strict();

export const runtimeIsolationPlanV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		profileId: z.string().min(1).max(160),
		source: z
			.object({
				sourceSnapshotDigest: sha256DigestSchema,
				runtimeProjectionDigest: sha256DigestSchema,
				projectionPolicyVersion: z.literal(1),
			})
			.strict(),
		recipe: z
			.object({
				recipeHash: sha256DigestSchema,
				startPlannerId: z.literal("build.npm"),
			})
			.strict(),
		dependency: z
			.object({
				adapterId: runtimeDependencyAdapterIdSchema,
				policyVersion: z.literal(1),
				lockDigest: sha256DigestSchema,
			})
			.strict(),
		images: runtimeIsolationImageDigestsSchema,
		start: z
			.object({
				executable: z.enum(["npm", "bun"]),
				args: z.array(z.string().min(1).max(200)).min(1).max(16),
				port: z.literal(18080),
				readinessPaths: z
					.array(z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/))
					.min(1)
					.max(5),
			})
			.strict(),
		database: z
			.object({
				mode: runtimeDatabaseModeSchema,
				policyVersion: z.literal(1),
				bindings: z.array(runtimeDatabaseEnvironmentBindingSchema).max(13),
			})
			.strict(),
		environment: z.object({ policyVersion: z.literal(1) }).strict(),
		network: z
			.object({
				kind: z.literal("container_namespace"),
				policyVersion: z.literal(1),
			})
			.strict(),
		limits: z
			.object({
				policyVersion: z.literal(1),
				targetMemoryMiB: z.literal(1024),
				targetPids: z.literal(256),
			})
			.strict(),
		cleanup: z
			.object({ required: z.literal(true), policyVersion: z.literal(1) })
			.strict(),
		dockerDaemonIdentityHash: sha256DigestSchema,
		qualificationHash: sha256DigestSchema,
	})
	.strict()
	.superRefine((value, context) => {
		const expectedExecutable =
			value.dependency.adapterId === "bun-lock-v1" ? "bun" : "npm";
		if (value.start.executable !== expectedExecutable) {
			context.addIssue({
				code: "custom",
				path: ["start", "executable"],
				message: "Start executable must match the qualified dependency adapter",
			});
		}
		const hasQualifiedRunShape =
			value.dependency.adapterId === "bun-lock-v1"
				? value.start.args[0] === "--bun" && value.start.args[1] === "run"
				: value.start.args[0] === "run";
		if (!hasQualifiedRunShape) {
			context.addIssue({
				code: "custom",
				path: ["start", "args"],
				message: "Start arguments must invoke a qualified package script",
			});
		}
	});

export const redactedRuntimeIsolationReceiptV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		bundleLeaseId: z.string().uuid(),
		planHash: sha256DigestSchema,
		roles: z.array(z.string().min(1).max(80)).max(32),
		databaseMode: runtimeDatabaseModeSchema,
		cleanupStatus: z.enum(["released", "quarantined"]),
	})
	.strict();

export type RuntimeDatabaseMode = z.infer<typeof runtimeDatabaseModeSchema>;
export type RuntimeDependencyAdapterId = z.infer<
	typeof runtimeDependencyAdapterIdSchema
>;
export type RuntimeDatabaseEnvironmentBinding = z.infer<
	typeof runtimeDatabaseEnvironmentBindingSchema
>;
export type RuntimeTargetRecipeV1 = z.infer<typeof runtimeTargetRecipeV1Schema>;
export type RuntimeIsolationPlanV1 = z.infer<
	typeof runtimeIsolationPlanV1Schema
>;
export type RedactedRuntimeIsolationReceiptV1 = z.infer<
	typeof redactedRuntimeIsolationReceiptV1Schema
>;
