import type { DastKind } from "./types";

export type DastProfileDefinition = {
	id:
		| "http-baseline"
		| "browser-smoke"
		| "authenticated-readonly"
		| "form-baseline";
	displayName: string;
	description: string;
	kind: DastKind;
	enabled: boolean;
	checks: string[];
	crawlerEnabled: false;
	requiresRoutes: boolean;
	requiresForms: boolean;
	requiresAuth: boolean;
};

export const DAST_PROFILES: DastProfileDefinition[] = [
	{
		id: "http-baseline",
		displayName: "HTTP Baseline",
		description: "Low-rate HTTP response and header checks for a saved target.",
		kind: "http",
		enabled: true,
		checks: [
			"reachability",
			"status-code-class",
			"security-headers",
			"cookie-flags",
			"cors-wildcard",
			"common-path-probes",
		],
		crawlerEnabled: false,
		requiresRoutes: false,
		requiresForms: false,
		requiresAuth: false,
	},
	{
		id: "browser-smoke",
		displayName: "Browser Smoke",
		description:
			"Load configured routes with a real browser and capture redacted console and network evidence.",
		kind: "browser",
		enabled: true,
		checks: [
			"configured-route-load",
			"console-errors",
			"failed-network-requests",
			"final-url-scope",
		],
		crawlerEnabled: false,
		requiresRoutes: true,
		requiresForms: false,
		requiresAuth: false,
	},
	{
		id: "authenticated-readonly",
		displayName: "Authenticated Read-only",
		description:
			"Use an encrypted test identity for read-only browser routes without storing response bodies or credentials.",
		kind: "browser",
		enabled: true,
		checks: [
			"declarative-login",
			"configured-route-load",
			"console-errors",
			"failed-network-requests",
			"final-url-scope",
			"single-session-refresh",
		],
		crawlerEnabled: false,
		requiresRoutes: true,
		requiresForms: false,
		requiresAuth: true,
	},
	{
		id: "form-baseline",
		displayName: "Form Baseline",
		description: "Non-destructive observations for configured forms only.",
		kind: "form",
		enabled: false,
		checks: [
			"configured-forms",
			"empty-submit-observation",
			"client-side-validation-observation",
		],
		crawlerEnabled: false,
		requiresRoutes: true,
		requiresForms: true,
		requiresAuth: false,
	},
];

export function listDastProfiles(): DastProfileDefinition[] {
	return [...DAST_PROFILES];
}

export function getDastProfile(
	profileId: string,
): DastProfileDefinition | null {
	return DAST_PROFILES.find((profile) => profile.id === profileId) ?? null;
}

export function assertDastProfileRunnable(params: {
	profileId: string;
	profileEnabled?: boolean;
	routePaths?: string[];
	formSelectors?: string[];
	authContextId?: string | null;
}): DastProfileDefinition {
	const profile = getDastProfile(params.profileId);
	if (!profile) {
		throw new Error(`DAST profile not found: ${params.profileId}`);
	}
	if (!profile.enabled || params.profileEnabled === false) {
		throw new Error(`DAST profile is disabled: ${params.profileId}`);
	}
	if (profile.requiresRoutes && (params.routePaths ?? []).length === 0) {
		throw new Error(
			`DAST profile requires configured route paths: ${profile.id}`,
		);
	}
	if (profile.requiresForms && (params.formSelectors ?? []).length === 0) {
		throw new Error(
			`DAST profile requires configured form selectors: ${profile.id}`,
		);
	}
	if (profile.requiresAuth && !params.authContextId) {
		throw new Error(`DAST profile requires an auth context: ${profile.id}`);
	}
	return profile;
}
