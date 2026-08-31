import type { RuntimeSettingsResponse } from "./core-types";

export type RuntimeIsolationSettings =
	RuntimeSettingsResponse["runtimeIsolation"];

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

export type RuntimeSettingsResponseInput = Omit<
	RuntimeSettingsResponse,
	| "runtimeIsolation"
	| "runtimeIsolationConfigured"
	| "runtimeIsolationMissingFields"
> & {
	runtimeIsolation?: Partial<RuntimeIsolationSettings> | null;
	runtimeIsolationConfigured?: boolean;
	runtimeIsolationMissingFields?: string[] | null;
};

/**
 * Keeps the settings UI compatible with API processes that still return the
 * response shape from before isolated runtime settings were added.
 */
export function normalizeRuntimeSettingsResponse(
	settings: RuntimeSettingsResponseInput,
): RuntimeSettingsResponse {
	const runtimeIsolation = normalizeRuntimeIsolationSettings(
		settings.runtimeIsolation,
	);
	const derivedMissingFields = RUNTIME_ISOLATION_REQUIRED_SETTING_KEYS.filter(
		(key) => runtimeIsolation[key].trim().length === 0,
	);
	const reportedMissingFields = Array.isArray(
		settings.runtimeIsolationMissingFields,
	)
		? settings.runtimeIsolationMissingFields.filter(
				(field): field is string => typeof field === "string",
			)
		: [];
	const runtimeIsolationMissingFields = Array.from(
		new Set([...derivedMissingFields, ...reportedMissingFields]),
	);
	const reportedConfigured =
		typeof settings.runtimeIsolationConfigured === "boolean"
			? settings.runtimeIsolationConfigured
			: true;

	return {
		...settings,
		runtimeIsolation,
		runtimeIsolationConfigured:
			reportedConfigured && runtimeIsolationMissingFields.length === 0,
		runtimeIsolationMissingFields,
	};
}

function normalizeRuntimeIsolationSettings(
	settings: Partial<RuntimeIsolationSettings> | null | undefined,
): RuntimeIsolationSettings {
	return {
		...(settings ?? {}),
		qualificationVersion: settings?.qualificationVersion === 2 ? 2 : 1,
		namespaceOwnerImage: stringSetting(settings?.namespaceOwnerImage),
		nodeImage: stringSetting(settings?.nodeImage),
		materializerImage: stringSetting(settings?.materializerImage),
		registryProxyImage: stringSetting(settings?.registryProxyImage),
		probeImage: stringSetting(settings?.probeImage),
		httpExecutorImage: stringSetting(settings?.httpExecutorImage),
		dockerDaemonIdentityHash: stringSetting(settings?.dockerDaemonIdentityHash),
		qualificationHash: stringSetting(settings?.qualificationHash),
		postgresImage: stringSetting(settings?.postgresImage),
		mysqlImage: stringSetting(settings?.mysqlImage),
		nucleiImage: stringSetting(settings?.nucleiImage),
		zapImage: stringSetting(settings?.zapImage),
		schemathesisImage: stringSetting(settings?.schemathesisImage),
	};
}

function stringSetting(value: string | undefined): string {
	return typeof value === "string" ? value : "";
}
