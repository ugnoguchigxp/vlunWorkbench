import { z } from "zod";
import type { AppEnv } from "../app/env";

export const RUNTIME_SETTINGS_KEY = "global";

export const RUNTIME_SETTINGS_DEFAULTS = {
	scanDockerImage: "vuln-workbench-toolbox:local",
	dockerMemory: "4g",
	dockerCpus: 2,
	dockerPidsLimit: 512,
	scannerStdoutLimitBytes: 64 * 1024 * 1024,
	scannerStderrLimitBytes: 8 * 1024 * 1024,
	webProcessConcurrency: 2,
	webScanQueueLimit: 32,
	webScanStepTimeoutMaxSec: 3_600,
	webScanWallClockTimeoutSec: 21_600,
	codexSdkTimeoutMs: 600_000,
	runtimeIsolation: {
		qualificationVersion: 1,
		namespaceOwnerImage: "",
		nodeImage: "",
		materializerImage: "",
		registryProxyImage: "",
		probeImage: "",
		httpExecutorImage: "",
		dockerDaemonIdentityHash: "",
		qualificationHash: "",
		postgresImage: "",
		mysqlImage: "",
		nucleiImage: "",
		zapImage: "",
		schemathesisImage: "",
	},
} as const;

const immutableImageReferenceSchema = z
	.string()
	.trim()
	.max(512)
	.refine(
		(value) => value === "" || /^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/.test(value),
		"Runtime isolation images must be empty, a local sha256:<image-id>, or pinned as image@sha256:<digest>.",
	);

const optionalSha256DigestSchema = z
	.string()
	.trim()
	.refine(
		(value) => value === "" || /^sha256:[a-f0-9]{64}$/.test(value),
		"Runtime isolation verification hashes must be empty or use sha256:<64 lowercase hex characters>.",
	);

export const RuntimeIsolationSettingsSchema = z.object({
	qualificationVersion: z.union([z.literal(1), z.literal(2)]).default(1),
	namespaceOwnerImage: immutableImageReferenceSchema,
	nodeImage: immutableImageReferenceSchema,
	materializerImage: immutableImageReferenceSchema,
	registryProxyImage: immutableImageReferenceSchema,
	probeImage: immutableImageReferenceSchema,
	httpExecutorImage: immutableImageReferenceSchema,
	dockerDaemonIdentityHash: optionalSha256DigestSchema,
	qualificationHash: optionalSha256DigestSchema,
	postgresImage: immutableImageReferenceSchema,
	mysqlImage: immutableImageReferenceSchema,
	nucleiImage: immutableImageReferenceSchema,
	zapImage: immutableImageReferenceSchema,
	schemathesisImage: immutableImageReferenceSchema,
});

export type RuntimeIsolationSettings = z.infer<
	typeof RuntimeIsolationSettingsSchema
>;

const GENERATED_RUNTIME_IMAGE_KEYS = [
	"namespaceOwnerImage",
	"nodeImage",
	"materializerImage",
	"registryProxyImage",
	"probeImage",
	"httpExecutorImage",
] as const satisfies ReadonlyArray<keyof RuntimeIsolationSettings>;

/**
 * Auto-configuration originally persisted a local image ID as
 * `vuln-workbench-runtime@sha256:...`. Docker does not resolve that syntax for
 * a locally built image. Migrate only the unmistakable generated six-role
 * configuration to Docker's content-addressable `sha256:...` reference.
 */
export function normalizeLegacyLocalRuntimeImageReferences(
	settings: RuntimeIsolationSettings,
): RuntimeIsolationSettings {
	const references = GENERATED_RUNTIME_IMAGE_KEYS.map((key) => settings[key]);
	if (new Set(references).size !== 1) return settings;
	const digest = /^vuln-workbench-runtime@(sha256:[a-f0-9]{64})$/.exec(
		references[0] ?? "",
	)?.[1];
	if (!digest) return settings;
	return {
		...settings,
		...Object.fromEntries(
			GENERATED_RUNTIME_IMAGE_KEYS.map((key) => [key, digest]),
		),
	};
}

export const RUNTIME_ISOLATION_REQUIRED_SETTING_KEYS = [
	"namespaceOwnerImage",
	"nodeImage",
	"materializerImage",
	"registryProxyImage",
	"probeImage",
	"httpExecutorImage",
	"dockerDaemonIdentityHash",
	"qualificationHash",
] as const satisfies ReadonlyArray<keyof RuntimeIsolationSettings>;

export function missingRuntimeIsolationSettings(
	settings: RuntimeIsolationSettings,
): string[] {
	return RUNTIME_ISOLATION_REQUIRED_SETTING_KEYS.filter(
		(key) => settings[key].length === 0,
	);
}

const dockerMemorySchema = z
	.string()
	.trim()
	.regex(
		/^\d+(?:\.\d+)?[kmgt](?:i?b)?$/i,
		"Docker memory must use a numeric k, m, g, or t suffix.",
	)
	.superRefine((value, context) => {
		const match = value.match(/^(\d+(?:\.\d+)?)([kmgt])/i);
		if (!match) return;
		const power = { k: 1, m: 2, g: 3, t: 4 }[
			match[2]?.toLowerCase() as "k" | "m" | "g" | "t"
		];
		const bytes = Number(match[1]) * 1024 ** power;
		if (bytes < 512 * 1024 * 1024 || bytes > 8 * 1024 * 1024 * 1024) {
			context.addIssue({
				code: "custom",
				message: "Docker memory must be between 512 MiB and 8 GiB.",
			});
		}
	});

export const RuntimeSettingsBaseSchema = z.object({
	scanExecutionMode: z.enum(["host", "docker"]),
	allowHostScannerExecution: z.boolean(),
	scanDockerImage: z.string().trim().min(1).max(512),
	dockerMemory: dockerMemorySchema,
	dockerCpus: z.number().min(0.25).max(4),
	dockerPidsLimit: z.number().int().min(64).max(1_024),
	scannerStdoutLimitBytes: z
		.number()
		.int()
		.positive()
		.max(256 * 1024 * 1024),
	scannerStderrLimitBytes: z
		.number()
		.int()
		.positive()
		.max(32 * 1024 * 1024),
	webProcessConcurrency: z
		.number()
		.int()
		.min(1)
		.max(8)
		.default(RUNTIME_SETTINGS_DEFAULTS.webProcessConcurrency),
	webScanQueueLimit: z
		.number()
		.int()
		.min(1)
		.max(256)
		.default(RUNTIME_SETTINGS_DEFAULTS.webScanQueueLimit),
	webScanStepTimeoutMaxSec: z
		.number()
		.int()
		.min(60)
		.max(86_400)
		.default(RUNTIME_SETTINGS_DEFAULTS.webScanStepTimeoutMaxSec),
	webScanWallClockTimeoutSec: z
		.number()
		.int()
		.min(300)
		.max(86_400)
		.default(RUNTIME_SETTINGS_DEFAULTS.webScanWallClockTimeoutSec),
	codexSdkTimeoutMs: z.number().int().min(1_000).max(3_600_000),
	runtimeIsolation: RuntimeIsolationSettingsSchema.default(
		RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation,
	),
});

const dastAuthEncryptionKeySchema = z
	.string()
	.trim()
	.refine(
		(value) => Buffer.from(value, "base64").length === 32,
		"DAST auth encryption key must be a base64-encoded 32-byte key.",
	);

const optionalDastAuthEncryptionKeySchema = z.preprocess((value) => {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}, dastAuthEncryptionKeySchema.optional());

export const RuntimeSettingsSchema = RuntimeSettingsBaseSchema.extend({
	dastAuthEncryptionKey: dastAuthEncryptionKeySchema.optional(),
	dastAuthPreviousEncryptionKeys: z
		.array(dastAuthEncryptionKeySchema)
		.default([]),
});

export const RuntimeSettingsUpdateSchema = RuntimeSettingsBaseSchema.omit({
	runtimeIsolation: true,
}).extend({
	// Older clients do not send this field. Omission must preserve the current
	// SQLite or legacy bootstrap value rather than resetting it to empty.
	runtimeIsolation: RuntimeIsolationSettingsSchema.optional(),
	dastAuthEncryptionKey: optionalDastAuthEncryptionKeySchema,
});

export type RuntimeSettingsBase = z.infer<typeof RuntimeSettingsBaseSchema>;
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;

/** Keeps invalid legacy environment entries fail-closed without hiding valid ones. */
export function runtimeIsolationSettingsFromBootstrap(
	settings: RuntimeIsolationSettings | undefined,
): RuntimeIsolationSettings {
	const candidate = settings ?? RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation;
	const normalized = Object.fromEntries(
		(
			Object.keys(RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation) as Array<
				keyof RuntimeIsolationSettings
			>
		).map((key) => {
			const parsed = RuntimeIsolationSettingsSchema.shape[key].safeParse(
				candidate[key],
			);
			return [
				key,
				parsed.success
					? parsed.data
					: RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation[key],
			];
		}),
	);
	return normalizeLegacyLocalRuntimeImageReferences(
		RuntimeIsolationSettingsSchema.parse(normalized),
	);
}

export type RuntimeSettingsResponse = RuntimeSettingsBase & {
	dastAuthEncryptionKey: "";
	dastAuthEncryptionKeyConfigured: boolean;
	dastAuthEncryptionKeySource: "environment" | "settings" | "none";
	runtimeIsolationConfigured: boolean;
	runtimeIsolationMissingFields: string[];
	updatedAt: string | null;
};

export function runtimeSettingsFromAppEnv(env: AppEnv): RuntimeSettings {
	return RuntimeSettingsSchema.parse({
		scanExecutionMode:
			env.scanExecutionMode ??
			(env.nodeEnv === "production" ? "docker" : "host"),
		allowHostScannerExecution:
			env.allowHostScannerExecution ?? env.nodeEnv !== "production",
		scanDockerImage:
			env.scanDockerImage ?? RUNTIME_SETTINGS_DEFAULTS.scanDockerImage,
		dockerMemory: env.dockerMemory ?? RUNTIME_SETTINGS_DEFAULTS.dockerMemory,
		dockerCpus: env.dockerCpus ?? RUNTIME_SETTINGS_DEFAULTS.dockerCpus,
		dockerPidsLimit:
			env.dockerPidsLimit ?? RUNTIME_SETTINGS_DEFAULTS.dockerPidsLimit,
		scannerStdoutLimitBytes:
			env.scannerStdoutLimitBytes ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStdoutLimitBytes,
		scannerStderrLimitBytes:
			env.scannerStderrLimitBytes ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStderrLimitBytes,
		webProcessConcurrency:
			env.webProcessConcurrency ??
			RUNTIME_SETTINGS_DEFAULTS.webProcessConcurrency,
		webScanQueueLimit:
			env.webScanQueueLimit ?? RUNTIME_SETTINGS_DEFAULTS.webScanQueueLimit,
		webScanStepTimeoutMaxSec:
			env.webScanStepTimeoutMaxSec ??
			RUNTIME_SETTINGS_DEFAULTS.webScanStepTimeoutMaxSec,
		webScanWallClockTimeoutSec:
			env.webScanWallClockTimeoutSec ??
			RUNTIME_SETTINGS_DEFAULTS.webScanWallClockTimeoutSec,
		codexSdkTimeoutMs: env.codexSdkTimeoutMs,
		runtimeIsolation: runtimeIsolationSettingsFromBootstrap(
			env.runtimeIsolation,
		),
		dastAuthEncryptionKey: env.dastAuthEncryptionKey,
		dastAuthPreviousEncryptionKeys: env.dastAuthPreviousEncryptionKeys ?? [],
	});
}

export function applyRuntimeSettings(
	env: AppEnv,
	settings: RuntimeSettings,
): AppEnv {
	return {
		...env,
		scanExecutionMode: settings.scanExecutionMode,
		allowHostScannerExecution: settings.allowHostScannerExecution,
		scanDockerImage: settings.scanDockerImage,
		dockerMemory: settings.dockerMemory,
		dockerCpus: settings.dockerCpus,
		dockerPidsLimit: settings.dockerPidsLimit,
		scannerStdoutLimitBytes: settings.scannerStdoutLimitBytes,
		scannerStderrLimitBytes: settings.scannerStderrLimitBytes,
		webProcessConcurrency: settings.webProcessConcurrency,
		webScanQueueLimit: settings.webScanQueueLimit,
		webScanStepTimeoutMaxSec: settings.webScanStepTimeoutMaxSec,
		webScanWallClockTimeoutSec: settings.webScanWallClockTimeoutSec,
		codexSdkTimeoutMs: settings.codexSdkTimeoutMs,
		runtimeIsolation: settings.runtimeIsolation,
		dastAuthEncryptionKey: settings.dastAuthEncryptionKey,
		dastAuthPreviousEncryptionKeys: settings.dastAuthPreviousEncryptionKeys,
	};
}
